import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '@/config';
import {
  buildLocalChannelSessionIds,
  syncChannelSessionsToLocalDb,
} from '@/shared/lib/channel-session-sync';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  HelpCircle,
  LogOut,
  QrCode,
  RefreshCw,
  Send,
} from 'lucide-react';

import { Switch } from '@/components/settings/components/Switch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ChannelId = 'feishu' | 'weixin' | 'dingtalk';

interface ChannelDefinition {
  id: ChannelId;
  name: string;
  authMode: 'oauth' | 'qr' | 'webhook';
  inboundMode: 'event' | 'polling' | 'webhook';
  official: boolean;
  description: string;
  risks: string[];
  capabilities: string[];
  requiredCommands: string[];
}

interface ChannelBinding {
  channel: ChannelId;
  enabled: boolean;
  defaultAssistant?: {
    assistantId?: string;
    assistantName?: string;
    prompt?: string;
    skillNames?: string[];
    mcpServerNames?: string[];
  };
  config: Record<string, string | boolean | number | undefined>;
  updatedAt: string;
}

interface ChannelSession {
  id: string;
  channel: ChannelId;
  conversationId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string; at: string }>;
  lastActiveAt: string;
  status: 'idle' | 'running' | 'error';
  lastError?: string;
}

interface ChannelStatus {
  definitions: ChannelDefinition[];
  bindings: ChannelBinding[];
  sessions: ChannelSession[];
  connections?: ChannelConnectionStatus[];
}

interface AuthSessionResult {
  command: {
    command: string;
    args: string[];
    description: string;
  };
  nextSteps: string[];
  warning?: string;
}

interface ChannelConnectionStatus {
  channel: ChannelId;
  connected: boolean;
  status:
    | 'disconnected'
    | 'connecting'
    | 'waiting'
    | 'scanned'
    | 'connected'
    | 'expired'
    | 'failed';
  accountId?: string;
  message?: string;
  updatedAt: string;
}

interface WeixinLoginSession {
  sessionId: string;
  status:
    | 'waiting'
    | 'scanned'
    | 'confirmed'
    | 'expired'
    | 'failed'
    | 'cancelled';
  qrCodeSvg?: string;
  qrCodeUrl?: string;
  expiresAt: string;
  message: string;
  accountId?: string;
  error?: string;
  updatedAt: string;
}

const channelBrandLogos: Record<
  ChannelId,
  { src: string; alt: string; className?: string }
> = {
  feishu: {
    src: 'https://p1-hera.feishucdn.com/tos-cn-i-jbbdkfciu3/84a9f036fe2b44f99b899fff4beeb963~tplv-jbbdkfciu3-image:0:0.image',
    alt: 'Feishu / Lark',
    className: 'size-6',
  },
  weixin: {
    src: 'https://cdn.simpleicons.org/wechat/07C160',
    alt: 'WeChat',
    className: 'size-6',
  },
  dingtalk: {
    src: 'https://img.alicdn.com/imgextra/i3/O1CN017PqYP51OX3bSJGxQY_!!6000000001714-2-tps-200-200.png',
    alt: 'DingTalk',
    className: 'size-6',
  },
};

function ChannelBrandLogo({ channel }: { channel: ChannelId }) {
  const logo = channelBrandLogos[channel];

  return (
    <img
      src={logo.src}
      alt={logo.alt}
      draggable={false}
      className={cn('object-contain', logo.className)}
    />
  );
}

const channelCopy: Record<
  ChannelId,
  {
    subtitle: string;
    description: string;
    features: string[];
    setupHint: string;
    authText: string;
  }
> = {
  feishu: {
    subtitle: '企业授权',
    description: '接入飞书消息，让飞书里的客户咨询由本应用助手自动处理。',
    features: ['企业授权', '消息接收', '自动回复', '文档协作'],
    setupHint: '请按企业授权提示完成飞书连接。',
    authText: '飞书需要管理员在开放平台完成应用权限和消息回调配置。',
  },
  weixin: {
    subtitle: '扫码登录',
    description: '通过手机微信扫码连接账号，让微信消息进入本应用助手会话。',
    features: ['扫码登录', '消息接收', '自动回复', '文件消息'],
    setupHint: '请在弹窗中使用手机微信扫码。',
    authText: '点击“连接微信”后，本应用会自动显示二维码并完成连接。',
  },
  dingtalk: {
    subtitle: '企业授权',
    description: '接入钉钉企业应用和群机器人，让钉钉群消息可由助手处理。',
    features: ['企业授权', '群消息', '机器人回复', '协作工具'],
    setupHint: '请按企业授权提示完成钉钉连接。',
    authText: '如需群内自动回复，请先填写钉钉开放平台里的 Robot Code。',
  },
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value?: string[]): string {
  return Array.isArray(value) ? value.join(', ') : '';
}

function commandToString(command: AuthSessionResult['command']): string {
  const quote = (value: string) =>
    /\s|["']/.test(value) ? JSON.stringify(value) : value;
  return [command.command, ...command.args.map(quote)].join(' ');
}

export function ChannelManagement() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isZh = language === 'zh-CN';
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelId>('feishu');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authResult, setAuthResult] = useState<AuthSessionResult | null>(null);
  const [testText, setTestText] = useState('');
  const [testReply, setTestReply] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [weixinDialogOpen, setWeixinDialogOpen] = useState(false);
  const [weixinLogin, setWeixinLogin] = useState<WeixinLoginSession | null>(
    null
  );
  const [weixinConnecting, setWeixinConnecting] = useState(false);

  const selectedDefinition = useMemo(
    () =>
      status?.definitions.find(
        (definition) => definition.id === selectedChannel
      ),
    [selectedChannel, status?.definitions]
  );
  const selectedBinding = useMemo(
    () =>
      status?.bindings.find((binding) => binding.channel === selectedChannel),
    [selectedChannel, status?.bindings]
  );
  const selectedCopy = channelCopy[selectedChannel];
  const weixinConnection = useMemo(
    () => status?.connections?.find((item) => item.channel === 'weixin'),
    [status?.connections]
  );
  const weixinConnected = weixinConnection?.connected === true;

  const [form, setForm] = useState({
    enabled: false,
    assistantName: '',
    assistantPrompt: '',
    skillNames: '',
    mcpServerNames: '',
    robotCode: '',
  });

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/channels`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextStatus = (await response.json()) as ChannelStatus;
      await syncChannelSessionsToLocalDb(nextStatus.sessions);
      setStatus(nextStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!selectedBinding) return;
    setForm({
      enabled: selectedBinding.enabled,
      assistantName: selectedBinding.defaultAssistant?.assistantName || '',
      assistantPrompt: selectedBinding.defaultAssistant?.prompt || '',
      skillNames: joinList(selectedBinding.defaultAssistant?.skillNames),
      mcpServerNames: joinList(
        selectedBinding.defaultAssistant?.mcpServerNames
      ),
      robotCode: String(selectedBinding.config.robotCode || ''),
    });
  }, [selectedBinding]);

  const saveBinding = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/channels/${selectedChannel}/binding`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: form.enabled,
            defaultAssistant: {
              assistantName: form.assistantName.trim() || undefined,
              prompt: form.assistantPrompt.trim() || undefined,
              skillNames: splitList(form.skillNames),
              mcpServerNames: splitList(form.mcpServerNames),
            },
            config: {
              robotCode: form.robotCode.trim() || undefined,
            },
          }),
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const createAuthSession = async () => {
    setAuthResult(null);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/channels/${selectedChannel}/auth`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ execute: false }),
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setAuthResult((await response.json()) as AuthSessionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startWeixinLogin = async (force = false) => {
    setWeixinConnecting(true);
    setAuthResult(null);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/channels/weixin/login/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        }
      );
      const result = (await response.json()) as {
        session?: WeixinLoginSession;
        error?: string;
      };
      if (!response.ok || !result.session) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      setWeixinLogin(result.session);
      setWeixinDialogOpen(true);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWeixinConnecting(false);
    }
  };

  const disconnectWeixin = async () => {
    setWeixinConnecting(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/channels/weixin/disconnect`,
        {
          method: 'POST',
        }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      setWeixinLogin(null);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWeixinConnecting(false);
    }
  };

  useEffect(() => {
    if (
      !weixinDialogOpen ||
      !weixinLogin?.sessionId ||
      !['waiting', 'scanned'].includes(weixinLogin.status)
    ) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/channels/weixin/login/${weixinLogin.sessionId}`
        );
        const result = (await response.json()) as {
          session?: WeixinLoginSession;
          error?: string;
        };
        if (!response.ok || !result.session) {
          throw new Error(result.error || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        setWeixinLogin(result.session);
        if (
          ['confirmed', 'expired', 'failed', 'cancelled'].includes(
            result.session.status
          )
        ) {
          await loadStatus();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    loadStatus,
    weixinDialogOpen,
    weixinLogin?.sessionId,
    weixinLogin?.status,
  ]);

  const runTestInbound = async () => {
    const text = testText.trim();
    if (!text) return;

    setTestReply(null);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/channels/${selectedChannel}/inbound`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: `desktop-test-${selectedChannel}`,
            senderName: 'Desktop Test',
            text,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      setTestReply(result.reply?.text || '');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyCommand = async () => {
    if (!authResult) return;
    await navigator.clipboard.writeText(commandToString(authResult.command));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">
            {isZh
              ? '把飞书、微信、钉钉接到本应用。客户从这些渠道发来消息后，系统会交给你配置的助手处理并回复。'
              : 'Map Feishu, WeChat, and DingTalk messages into local agent sessions with a selected assistant profile.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setGuideOpen(true)}>
            <HelpCircle className="size-4" />
            {isZh ? '操作指南' : 'Guide'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadStatus}
            disabled={loading}
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            {isZh ? '刷新' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {status?.definitions.map((definition) => {
          const binding = status.bindings.find(
            (item) => item.channel === definition.id
          );
          const active = selectedChannel === definition.id;

          return (
            <button
              key={definition.id}
              onClick={() => {
                setSelectedChannel(definition.id);
                setAuthResult(null);
                setTestReply(null);
              }}
              className={cn(
                'border-border bg-background hover:border-foreground/20 rounded-lg border p-3 text-left transition-colors',
                active && 'border-primary ring-primary/20 ring-2'
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="bg-background flex size-10 items-center justify-center rounded-xl border shadow-sm">
                  <ChannelBrandLogo channel={definition.id} />
                </div>
                {definition.id === 'weixin' && weixinConnected ? (
                  <span className="text-primary text-xs">
                    {isZh ? '已连接' : 'Connected'}
                  </span>
                ) : binding?.enabled ? (
                  <CheckCircle2 className="text-primary size-4" />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {isZh ? '未启用' : 'Off'}
                  </span>
                )}
              </div>
              <div className="text-foreground text-sm font-medium">
                {definition.name}
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {channelCopy[definition.id].subtitle}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDefinition && (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-foreground text-sm font-medium">
                    {selectedDefinition.name}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {selectedCopy.description}
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onChange={(checked) =>
                    setForm((current) => ({ ...current, enabled: checked }))
                  }
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedCopy.features.map((capability) => (
                  <span
                    key={capability}
                    className="bg-muted text-muted-foreground rounded px-2 py-1 text-xs"
                  >
                    {capability}
                  </span>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-foreground flex items-center gap-2 text-sm font-medium">
                <Bot className="size-4" />
                {isZh ? '默认助手角色' : 'Default Assistant Profile'}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs">
                    {isZh ? '角色名称' : 'Profile name'}
                  </span>
                  <input
                    value={form.assistantName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        assistantName: event.target.value,
                      }))
                    }
                    placeholder={isZh ? '例如：客服助理' : 'Support assistant'}
                    className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs">
                    {isZh ? 'Skills' : 'Skills'}
                  </span>
                  <input
                    value={form.skillNames}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        skillNames: event.target.value,
                      }))
                    }
                    placeholder="lark-im, dingtalk-chat"
                    className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                  />
                </label>
              </div>
              <label className="space-y-1.5">
                <span className="text-muted-foreground text-xs">
                  {isZh ? '系统提示词' : 'System prompt'}
                </span>
                <textarea
                  value={form.assistantPrompt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      assistantPrompt: event.target.value,
                    }))
                  }
                  placeholder={
                    isZh
                      ? '描述该渠道消息进入后要使用的 Agent 角色、边界和回复风格。'
                      : 'Describe the role, boundaries, and reply style for messages from this channel.'
                  }
                  className="border-input bg-background text-foreground focus:ring-ring/50 min-h-20 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-muted-foreground text-xs">
                  MCP servers
                </span>
                <input
                  value={form.mcpServerNames}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      mcpServerNames: event.target.value,
                    }))
                  }
                  placeholder="internal-docs, crm"
                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                />
              </label>
            </section>

            {selectedChannel === 'dingtalk' && (
              <label className="block space-y-1.5">
                <span className="text-muted-foreground text-xs">
                  Robot Code
                </span>
                <input
                  value={form.robotCode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      robotCode: event.target.value,
                    }))
                  }
                  placeholder="dingxxxx"
                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                />
              </label>
            )}

            {selectedChannel === 'weixin' && (
              <div className="border-border bg-muted/40 rounded-lg border px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      {isZh ? '微信连接状态' : 'WeChat connection'}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {weixinConnection?.message || selectedCopy.authText}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-1 text-xs',
                      weixinConnected
                        ? 'bg-primary/10 text-primary'
                        : 'bg-background text-muted-foreground'
                    )}
                  >
                    {weixinConnected
                      ? isZh
                        ? '已连接'
                        : 'Connected'
                      : isZh
                        ? '未连接'
                        : 'Disconnected'}
                  </span>
                </div>
                {weixinConnection?.accountId && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {isZh ? '账号：' : 'Account: '}
                    {weixinConnection.accountId}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={saveBinding} disabled={saving}>
                {saving ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {isZh ? '保存配置' : 'Save'}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  selectedChannel === 'weixin'
                    ? startWeixinLogin(false)
                    : createAuthSession()
                }
                disabled={saving || weixinConnecting}
              >
                {selectedChannel === 'weixin' ? (
                  <QrCode className="size-4" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                {selectedChannel === 'weixin'
                  ? weixinConnected
                    ? isZh
                      ? '重新连接微信'
                      : 'Reconnect WeChat'
                    : isZh
                      ? '连接微信'
                      : 'Connect WeChat'
                  : isZh
                    ? '获取授权指引'
                    : 'Get setup guide'}
              </Button>
              {selectedChannel === 'weixin' && weixinConnected && (
                <Button
                  variant="outline"
                  onClick={disconnectWeixin}
                  disabled={weixinConnecting}
                >
                  <LogOut className="size-4" />
                  {isZh ? '断开连接' : 'Disconnect'}
                </Button>
              )}
            </div>

            {authResult && selectedChannel !== 'weixin' && (
              <div className="border-border bg-muted/40 rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-foreground text-sm font-medium">
                    {selectedCopy.setupHint}
                  </p>
                  <Button variant="ghost" size="icon-sm" onClick={copyCommand}>
                    <Copy className="size-4" />
                  </Button>
                </div>
                <code className="bg-background text-foreground block overflow-x-auto rounded border px-3 py-2 text-xs">
                  {commandToString(authResult.command)}
                </code>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="border-border rounded-lg border p-3">
              <h3 className="text-foreground mb-2 text-sm font-medium">
                {isZh ? '测试入站消息' : 'Test inbound message'}
              </h3>
              <textarea
                value={testText}
                onChange={(event) => setTestText(event.target.value)}
                placeholder={isZh ? '发送一条测试消息' : 'Send a test message'}
                className="border-input bg-background text-foreground focus:ring-ring/50 min-h-20 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={runTestInbound}
                disabled={!testText.trim()}
              >
                <Send className="size-4" />
                {isZh ? '运行测试' : 'Run test'}
              </Button>
              {testReply && (
                <p className="bg-muted text-muted-foreground mt-3 rounded p-2 text-xs">
                  {testReply}
                </p>
              )}
            </div>

            <div className="border-border rounded-lg border p-3">
              <h3 className="text-foreground mb-2 text-sm font-medium">
                {isZh ? '活跃会话' : 'Active sessions'}
              </h3>
              <div className="space-y-2">
                {status?.sessions
                  .filter((session) => session.channel === selectedChannel)
                  .slice(0, 5)
                  .map((session) => {
                    const { taskId } = buildLocalChannelSessionIds(session);
                    return (
                      <div key={session.id} className="bg-muted rounded p-2">
                        <div className="text-foreground truncate text-xs font-medium">
                          {session.conversationId}
                        </div>
                        <div className="text-muted-foreground mt-1 text-xs">
                          {session.history.length} messages · {session.status}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 w-full text-xs"
                          onClick={() => navigate(`/task/${taskId}`)}
                        >
                          {isZh ? '打开会话' : 'Open conversation'}
                        </Button>
                      </div>
                    );
                  })}
                {!status?.sessions.some(
                  (session) => session.channel === selectedChannel
                ) && (
                  <p className="text-muted-foreground text-xs">
                    {isZh ? '暂无会话' : 'No sessions yet'}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      <Dialog open={weixinDialogOpen} onOpenChange={setWeixinDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isZh ? '连接微信' : 'Connect WeChat'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {weixinLogin?.qrCodeSvg &&
              ['waiting', 'scanned'].includes(weixinLogin.status) && (
                <div className="flex justify-center">
                  <div
                    className="bg-background rounded-lg border p-3"
                    dangerouslySetInnerHTML={{
                      __html: weixinLogin.qrCodeSvg,
                    }}
                  />
                </div>
              )}

            <div className="text-center">
              <p className="text-foreground text-sm font-medium">
                {weixinLogin?.message ||
                  (isZh
                    ? '请使用手机微信扫描二维码。'
                    : 'Scan the QR code with WeChat.')}
              </p>
              {weixinLogin?.error && (
                <p className="text-destructive mt-2 text-xs">
                  {weixinLogin.error}
                </p>
              )}
              {weixinLogin?.expiresAt &&
                ['waiting', 'scanned'].includes(weixinLogin.status) && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {isZh ? '二维码有效期至：' : 'QR expires at: '}
                    {new Date(weixinLogin.expiresAt).toLocaleTimeString()}
                  </p>
                )}
            </div>

            {weixinLogin?.status === 'confirmed' && (
              <div className="bg-primary/10 text-primary rounded-lg px-3 py-2 text-center text-sm">
                {isZh
                  ? '微信已连接，后续消息会自动进入助手会话。'
                  : 'WeChat is connected.'}
              </div>
            )}

            {weixinLogin &&
              ['expired', 'failed', 'cancelled'].includes(
                weixinLogin.status
              ) && (
                <Button
                  className="w-full"
                  onClick={() => startWeixinLogin(true)}
                  disabled={weixinConnecting}
                >
                  <QrCode className="size-4" />
                  {isZh ? '重新生成二维码' : 'Generate New QR'}
                </Button>
              )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>渠道管理操作指南</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">这是什么</h3>
              <p className="text-muted-foreground leading-6">
                渠道管理用于把飞书、微信、钉钉接到本应用。接好后，客户在这些渠道里发来的消息，会进入你配置的助手角色，由助手自动处理并回复。
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">第一次怎么用</h3>
              <ol className="text-muted-foreground list-decimal space-y-2 pl-5 leading-6">
                <li>先选择要接入的渠道，例如微信、飞书或钉钉。</li>
                <li>打开右侧开关，表示这个渠道启用。</li>
                <li>
                  在“默认助手角色”里填写角色名称，例如“客服助理”，再写清楚它应该怎么回复客户。
                </li>
                <li>点击“保存配置”。</li>
                <li>
                  微信点击“连接微信”并在弹窗中扫码；飞书和钉钉按企业授权提示完成管理员配置。
                </li>
              </ol>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">
                各渠道当前支持情况
              </h3>
              <div className="grid gap-2">
                <div className="rounded-lg border p-3">
                  <div className="text-foreground font-medium">微信</div>
                  <p className="text-muted-foreground mt-1 leading-6">
                    已支持应用内扫码连接。完成扫码确认后，微信消息会进入本应用助手会话。
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-foreground font-medium">飞书</div>
                  <p className="text-muted-foreground mt-1 leading-6">
                    已支持授权接入和消息回复能力。正式使用前，需要在飞书开放平台配置应用权限和消息回调。
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-foreground font-medium">钉钉</div>
                  <p className="text-muted-foreground mt-1 leading-6">
                    已支持企业授权和机器人回复配置。正式使用前，需要管理员配置钉钉应用、消息回调和
                    Robot Code。
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">
                怎么确认已经接好
              </h3>
              <p className="text-muted-foreground leading-6">
                可以在右侧“测试入站消息”里输入一句话并点击“运行测试”。如果下方出现助手回复，说明本应用里的渠道会话和助手角色已经可以正常工作。
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
