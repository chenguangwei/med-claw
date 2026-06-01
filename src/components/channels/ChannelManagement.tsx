import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '@/config';
import {
  ASSISTANT_PROFILES_CHANGED_EVENT,
  createPrimaryAssistantProfile,
  loadCustomAssistantProfiles,
  type AssistantProfile,
} from '@/shared/assistants/profiles';
import {
  buildLocalChannelSessionIds,
  syncChannelSessionsToLocalDb,
} from '@/shared/lib/channel-session-sync';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  HelpCircle,
  ListFilter,
  LogOut,
  MessageCircle,
  QrCode,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from 'lucide-react';

import { Switch } from '@/components/settings/components/Switch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

type ChannelConversationType = 'private' | 'group';
type ChannelRouteTemplate =
  | 'keywords'
  | 'conversation'
  | 'senderName'
  | 'advanced';

interface ChannelAssistantBinding {
  assistantId?: string;
  assistantName?: string;
  prompt?: string;
  skillNames?: string[];
  mcpServerNames?: string[];
}

interface ChannelAssistantRouteMatch {
  conversationType?: ChannelConversationType;
  conversationIds?: string[];
  senderIds?: string[];
  senderNames?: string[];
  keywords?: string[];
  regex?: string;
}

interface ChannelAssistantRoute {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match: ChannelAssistantRouteMatch;
  assistant: ChannelAssistantBinding;
  updatedAt: string;
}

interface ChannelBinding {
  channel: ChannelId;
  enabled: boolean;
  defaultAssistant?: ChannelAssistantBinding;
  assistantRoutes?: ChannelAssistantRoute[];
  config: Record<string, string | boolean | number | undefined>;
  updatedAt: string;
}

interface ChannelSession {
  id: string;
  channel: ChannelId;
  conversationType?: ChannelConversationType;
  conversationId: string;
  assistant?: ChannelAssistantBinding;
  assistantRouteId?: string;
  assistantRouteName?: string;
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

interface ChannelInboundTestResult {
  reply?: {
    text?: string;
  };
  session?: ChannelSession;
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

interface GuideItem {
  label: string;
  description: string;
}

const commonGuideCopy: Record<'zh' | 'en', GuideItem[]> = {
  zh: [
    {
      label: '启用开关',
      description: '决定该渠道保存后是否接收并处理入站消息。',
    },
    {
      label: '渠道默认助手',
      description: '未命中任何路由规则时使用的兜底助手和系统提示词。',
    },
    {
      label: '高级设置',
      description:
        '只在需要限制默认助手可用 Skills 或 MCP servers 时填写，普通接入可先保持为空。',
    },
    {
      label: '助手路由规则',
      description:
        '按关键词、群/联系人、发送人或高级条件把同一渠道消息分配给不同助手。',
    },
    {
      label: '测试入站消息',
      description: '用模拟会话验证命中规则、使用助手和回复内容。',
    },
    {
      label: '活跃会话',
      description: '查看最近进入本应用的渠道会话，并打开对应本地助手会话。',
    },
  ],
  en: [
    {
      label: 'Enable switch',
      description:
        'Controls whether this channel handles inbound messages after saving.',
    },
    {
      label: 'Default assistant',
      description:
        'Fallback assistant and system prompt used when no routing rule matches.',
    },
    {
      label: 'Advanced settings',
      description:
        'Only fill these when the default assistant must be limited to specific Skills or MCP servers.',
    },
    {
      label: 'Assistant routing rules',
      description:
        'Route messages in the same channel to different assistants by keyword, chat/contact, sender, or advanced conditions.',
    },
    {
      label: 'Test inbound message',
      description:
        'Use a simulated chat to verify the matched rule, selected assistant, and reply.',
    },
    {
      label: 'Active sessions',
      description:
        'Review recent channel sessions and open the matching local assistant session.',
    },
  ],
};

const channelGuideCopy: Record<
  ChannelId,
  Record<'zh' | 'en', { title: string; items: GuideItem[] }>
> = {
  feishu: {
    zh: {
      title: '飞书配置项',
      items: [
        {
          label: '获取授权指引',
          description:
            '生成管理员配置提示，用于在飞书开放平台完成应用权限和消息回调。',
        },
        {
          label: '企业授权',
          description:
            '正式接入前需要管理员完成授权，确保消息事件能回调到本应用。',
        },
        {
          label: '消息接收 / 自动回复',
          description:
            '配置完成后，飞书消息会进入本地助手会话，并由命中的助手回复。',
        },
        {
          label: '刷新',
          description: '外部授权或回调配置完成后，用于同步最新渠道状态。',
        },
      ],
    },
    en: {
      title: 'Feishu settings',
      items: [
        {
          label: 'Get setup guide',
          description:
            'Generates admin setup instructions for Feishu app permissions and message callbacks.',
        },
        {
          label: 'Enterprise authorization',
          description:
            'An admin must authorize the app before message events can reach this app.',
        },
        {
          label: 'Message intake / auto reply',
          description:
            'After setup, Feishu messages enter local assistant sessions and are replied to by the matched assistant.',
        },
        {
          label: 'Refresh',
          description:
            'Sync the latest channel status after external authorization or callback setup.',
        },
      ],
    },
  },
  weixin: {
    zh: {
      title: '微信配置项',
      items: [
        {
          label: '微信连接状态',
          description:
            '展示当前微信是否已连接；连接后会显示账号信息，便于确认使用的是哪个账号。',
        },
        {
          label: '连接微信 / 重新连接微信',
          description:
            '打开扫码弹窗。使用手机微信扫码并确认后，微信消息会进入本应用助手会话。',
        },
        {
          label: '二维码弹窗',
          description:
            '二维码有有效期；过期、失败或取消后，可在弹窗里重新生成二维码。',
        },
        {
          label: '断开连接',
          description:
            '停止当前微信账号连接；需要更换账号或暂停微信接入时使用。',
        },
        {
          label: '保存配置',
          description:
            '保存启用状态、默认助手、路由规则和高级设置；扫码连接和配置保存是两个动作。',
        },
      ],
    },
    en: {
      title: 'WeChat settings',
      items: [
        {
          label: 'WeChat connection',
          description:
            'Shows whether WeChat is connected and displays the account after login.',
        },
        {
          label: 'Connect / reconnect WeChat',
          description:
            'Opens the QR login dialog. After phone confirmation, WeChat messages enter assistant sessions.',
        },
        {
          label: 'QR dialog',
          description:
            'QR codes expire. If login expires, fails, or is cancelled, generate a new QR code in the dialog.',
        },
        {
          label: 'Disconnect',
          description:
            'Stops the current WeChat account connection when changing accounts or pausing WeChat intake.',
        },
        {
          label: 'Save',
          description:
            'Saves enabled state, default assistant, routing rules, and advanced settings. QR login and saving settings are separate actions.',
        },
      ],
    },
  },
  dingtalk: {
    zh: {
      title: '钉钉配置项',
      items: [
        {
          label: 'Robot Code',
          description:
            '用于钉钉群机器人回复。需要群内自动回复时，先在钉钉开放平台获取并填写。',
        },
        {
          label: '获取授权指引',
          description:
            '生成管理员配置提示，用于完成钉钉应用授权、消息回调和机器人配置。',
        },
        {
          label: '群消息 / 机器人回复',
          description:
            '配置完成后，钉钉群消息可进入助手路由，并通过机器人发送回复。',
        },
        {
          label: '刷新',
          description: '管理员完成外部配置后，用于同步钉钉连接和可用能力状态。',
        },
      ],
    },
    en: {
      title: 'DingTalk settings',
      items: [
        {
          label: 'Robot Code',
          description:
            'Required for DingTalk group bot replies. Get it from the DingTalk developer platform before enabling group replies.',
        },
        {
          label: 'Get setup guide',
          description:
            'Generates admin setup instructions for app authorization, message callbacks, and bot configuration.',
        },
        {
          label: 'Group messages / bot replies',
          description:
            'After setup, DingTalk group messages can be routed to assistants and replied to through the bot.',
        },
        {
          label: 'Refresh',
          description:
            'Sync DingTalk connection and capability status after the admin finishes external setup.',
        },
      ],
    },
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

function firstListValue(value?: string[]): string {
  return Array.isArray(value) && value.length > 0 ? value[0] : '';
}

function formatRouteList(value?: string[], fallback = ''): string {
  if (!value?.length) return fallback;
  return value.slice(0, 3).join(', ');
}

function hasRouteAdvancedFields(route: ChannelAssistantRoute): boolean {
  return Boolean(
    route.match.senderIds?.length ||
    route.match.regex ||
    route.assistant.skillNames?.length ||
    route.assistant.mcpServerNames?.length ||
    route.assistant.prompt
  );
}

function createRouteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `route-${crypto.randomUUID()}`;
  }
  return `route-${Date.now()}`;
}

function assistantProfileToBinding(
  assistant: AssistantProfile
): ChannelAssistantBinding {
  return {
    assistantId: assistant.id,
    assistantName: assistant.name,
    prompt: assistant.prompt,
    skillNames: assistant.skillNames || [],
    mcpServerNames: assistant.mcpServerNames || [],
  };
}

function createEmptyAssistantRoute(
  priority: number,
  assistant?: AssistantProfile
): ChannelAssistantRoute {
  const binding = assistant
    ? assistantProfileToBinding(assistant)
    : {
        assistantName: '',
        prompt: '',
        skillNames: [],
        mcpServerNames: [],
      };

  return {
    id: createRouteId(),
    name: '',
    enabled: true,
    priority,
    match: {
      conversationIds: [],
      senderIds: [],
      senderNames: [],
      keywords: [],
    },
    assistant: binding,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeRouteOrder(
  routes: ChannelAssistantRoute[],
  touchUpdatedAt = true
): ChannelAssistantRoute[] {
  const timestamp = new Date().toISOString();
  return routes.map((route, index) => ({
    ...route,
    priority: index + 1,
    updatedAt: touchUpdatedAt ? timestamp : route.updatedAt,
  }));
}

function sortAssistantRoutes(
  routes: ChannelAssistantRoute[]
): ChannelAssistantRoute[] {
  return [...routes].sort((left, right) => left.priority - right.priority);
}

function commandToString(command: AuthSessionResult['command']): string {
  const quote = (value: string) =>
    /\s|["']/.test(value) ? JSON.stringify(value) : value;
  return [command.command, ...command.args.map(quote)].join(' ');
}

export function ChannelManagement() {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const isZh = language === 'zh-CN';
  const [assistantProfiles, setAssistantProfiles] = useState<
    AssistantProfile[]
  >(() => [
    createPrimaryAssistantProfile(t.nav.primaryAssistant),
    ...loadCustomAssistantProfiles(),
  ]);
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelId>('feishu');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authResult, setAuthResult] = useState<AuthSessionResult | null>(null);
  const [testConversationType, setTestConversationType] =
    useState<ChannelConversationType>('private');
  const [testSenderName, setTestSenderName] = useState('');
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<ChannelInboundTestResult | null>(
    null
  );
  const [expandedAdvancedRouteIds, setExpandedAdvancedRouteIds] = useState<
    string[]
  >([]);
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
  const guideLocale = isZh ? 'zh' : 'en';
  const selectedGuideCopy = channelGuideCopy[selectedChannel][guideLocale];
  const commonGuideItems = commonGuideCopy[guideLocale];
  const weixinConnection = useMemo(
    () => status?.connections?.find((item) => item.channel === 'weixin'),
    [status?.connections]
  );
  const weixinConnected = weixinConnection?.connected === true;
  const selectedChannelSessions = useMemo(
    () =>
      status?.sessions
        .filter((session) => session.channel === selectedChannel)
        .slice()
        .sort(
          (left, right) =>
            new Date(right.lastActiveAt).getTime() -
            new Date(left.lastActiveAt).getTime()
        ) || [],
    [selectedChannel, status?.sessions]
  );

  const [form, setForm] = useState({
    enabled: false,
    assistantId: '',
    assistantName: '',
    assistantPrompt: '',
    skillNames: '',
    mcpServerNames: '',
    assistantRoutes: [] as ChannelAssistantRoute[],
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
    const loadAssistantProfiles = () => {
      setAssistantProfiles([
        createPrimaryAssistantProfile(t.nav.primaryAssistant),
        ...loadCustomAssistantProfiles(),
      ]);
    };

    loadAssistantProfiles();
    window.addEventListener(
      ASSISTANT_PROFILES_CHANGED_EVENT,
      loadAssistantProfiles
    );
    return () => {
      window.removeEventListener(
        ASSISTANT_PROFILES_CHANGED_EVENT,
        loadAssistantProfiles
      );
    };
  }, [t.nav.primaryAssistant]);

  useEffect(() => {
    if (!selectedBinding) return;
    setForm({
      enabled: selectedBinding.enabled,
      assistantId: selectedBinding.defaultAssistant?.assistantId || '',
      assistantName: selectedBinding.defaultAssistant?.assistantName || '',
      assistantPrompt: selectedBinding.defaultAssistant?.prompt || '',
      skillNames: joinList(selectedBinding.defaultAssistant?.skillNames),
      mcpServerNames: joinList(
        selectedBinding.defaultAssistant?.mcpServerNames
      ),
      assistantRoutes: normalizeRouteOrder(
        sortAssistantRoutes(selectedBinding.assistantRoutes || []),
        false
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
              assistantId: form.assistantId.trim() || undefined,
              assistantName: form.assistantName.trim() || undefined,
              prompt: form.assistantPrompt.trim() || undefined,
              skillNames: splitList(form.skillNames),
              mcpServerNames: splitList(form.mcpServerNames),
            },
            assistantRoutes: normalizeRouteOrder(form.assistantRoutes),
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

  const applyDefaultAssistantProfile = (assistantId: string) => {
    const assistant = assistantProfiles.find((item) => item.id === assistantId);
    if (!assistant) {
      setForm((current) => ({
        ...current,
        assistantId: '',
      }));
      return;
    }

    const binding = assistantProfileToBinding(assistant);
    setForm((current) => ({
      ...current,
      assistantId: binding.assistantId || '',
      assistantName: binding.assistantName || '',
      assistantPrompt: binding.prompt || '',
      skillNames: joinList(binding.skillNames),
      mcpServerNames: joinList(binding.mcpServerNames),
    }));
  };

  const createAssistantRouteFromTemplate = (
    template: ChannelRouteTemplate,
    priority: number
  ): ChannelAssistantRoute => {
    const route = createEmptyAssistantRoute(priority, assistantProfiles[0]);
    const timestamp = new Date().toISOString();

    if (template === 'conversation') {
      return {
        ...route,
        name: isZh ? '指定群或联系人' : 'Specific chat or contact',
        match: {
          ...route.match,
          conversationType: 'group',
        },
        updatedAt: timestamp,
      };
    }

    if (template === 'senderName') {
      return {
        ...route,
        name: isZh ? '指定发送人' : 'Specific sender',
        match: {
          ...route.match,
          senderNames: [isZh ? '张三' : 'Alice'],
        },
        updatedAt: timestamp,
      };
    }

    if (template === 'advanced') {
      return {
        ...route,
        name: isZh ? '高级精确匹配' : 'Advanced exact match',
        match: {
          ...route.match,
          conversationIds: [''],
        },
        updatedAt: timestamp,
      };
    }

    return {
      ...route,
      name: isZh ? '售后关键词' : 'Support keywords',
      match: {
        ...route.match,
        keywords: [isZh ? '退款' : 'refund', isZh ? '售后' : 'support'],
      },
      updatedAt: timestamp,
    };
  };

  const addAssistantRoute = (template: ChannelRouteTemplate = 'keywords') => {
    const nextRoute = createAssistantRouteFromTemplate(
      template,
      form.assistantRoutes.length + 1
    );
    setForm((current) => ({
      ...current,
      assistantRoutes: normalizeRouteOrder([
        ...current.assistantRoutes,
        nextRoute,
      ]),
    }));
    if (template === 'advanced') {
      setExpandedAdvancedRouteIds((current) =>
        current.includes(nextRoute.id) ? current : [...current, nextRoute.id]
      );
    }
  };

  const updateAssistantRoute = (
    routeId: string,
    update: (route: ChannelAssistantRoute) => ChannelAssistantRoute
  ) => {
    setForm((current) => ({
      ...current,
      assistantRoutes: current.assistantRoutes.map((route) =>
        route.id === routeId ? update(route) : route
      ),
    }));
  };

  const applyRouteAssistantProfile = (routeId: string, assistantId: string) => {
    const assistant = assistantProfiles.find((item) => item.id === assistantId);
    if (!assistant) {
      setExpandedAdvancedRouteIds((current) =>
        current.includes(routeId) ? current : [...current, routeId]
      );
    }
    updateAssistantRoute(routeId, (route) => ({
      ...route,
      assistant: assistant
        ? assistantProfileToBinding(assistant)
        : { ...route.assistant, assistantId: '' },
      updatedAt: new Date().toISOString(),
    }));
  };

  const removeAssistantRoute = (routeId: string) => {
    setForm((current) => ({
      ...current,
      assistantRoutes: normalizeRouteOrder(
        current.assistantRoutes.filter((route) => route.id !== routeId)
      ),
    }));
    setExpandedAdvancedRouteIds((current) =>
      current.filter((id) => id !== routeId)
    );
  };

  const moveAssistantRoute = (routeId: string, direction: -1 | 1) => {
    setForm((current) => {
      const routes = [...current.assistantRoutes];
      const index = routes.findIndex((route) => route.id === routeId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= routes.length) {
        return current;
      }
      [routes[index], routes[nextIndex]] = [routes[nextIndex], routes[index]];
      return {
        ...current,
        assistantRoutes: normalizeRouteOrder(routes),
      };
    });
  };

  const toggleRouteAdvanced = (routeId: string) => {
    setExpandedAdvancedRouteIds((current) =>
      current.includes(routeId)
        ? current.filter((id) => id !== routeId)
        : [...current, routeId]
    );
  };

  const runTestInbound = async () => {
    const text = testText.trim();
    if (!text) return;

    setTestResult(null);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/channels/${selectedChannel}/inbound`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationType: testConversationType,
            conversationId: `desktop-test-${selectedChannel}`,
            senderName:
              testSenderName.trim() || (isZh ? '测试用户' : 'Desktop Test'),
            text,
          }),
        }
      );
      const result = (await response.json()) as ChannelInboundTestResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      setTestResult(result);
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
                setTestResult(null);
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
                {isZh ? '渠道默认助手' : 'Default assistant'}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs">
                    {isZh ? '选择已有助手' : 'Existing assistant'}
                  </span>
                  <select
                    value={form.assistantId || 'custom'}
                    onChange={(event) =>
                      event.target.value === 'custom'
                        ? setForm((current) => ({
                            ...current,
                            assistantId: '',
                          }))
                        : applyDefaultAssistantProfile(event.target.value)
                    }
                    className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                  >
                    <option value="custom">
                      {isZh ? '手动填写' : 'Manual'}
                    </option>
                    {assistantProfiles.map((assistant) => (
                      <option key={assistant.id} value={assistant.id}>
                        {assistant.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs">
                    {isZh ? '角色名称' : 'Profile name'}
                  </span>
                  <input
                    value={form.assistantName}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        assistantId: '',
                        assistantName: event.target.value,
                      }))
                    }
                    placeholder={isZh ? '例如：客服助理' : 'Support assistant'}
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
                      assistantId: '',
                      assistantPrompt: event.target.value,
                    }))
                  }
                  placeholder={
                    isZh
                      ? '描述未命中路由规则时使用的 Agent 角色、边界和回复风格。'
                      : 'Describe the fallback role, boundaries, and reply style.'
                  }
                  className="border-input bg-background text-foreground focus:ring-ring/50 min-h-20 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
                />
              </label>
              <details className="border-border bg-muted/20 rounded-lg border px-3 py-2">
                <summary className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <SlidersHorizontal className="size-3.5" />
                  {isZh ? '高级设置' : 'Advanced settings'}
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-muted-foreground text-xs">
                      {isZh ? '可用 Skills' : 'Skills'}
                    </span>
                    <input
                      value={form.skillNames}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          assistantId: '',
                          skillNames: event.target.value,
                        }))
                      }
                      placeholder="lark-im, dingtalk-chat"
                      className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
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
                          assistantId: '',
                          mcpServerNames: event.target.value,
                        }))
                      }
                      placeholder="internal-docs, crm"
                      className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                    />
                  </label>
                </div>
              </details>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-foreground flex items-center gap-2 text-sm font-medium">
                  <ListFilter className="size-4" />
                  {isZh ? '助手路由规则' : 'Assistant routing rules'}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addAssistantRoute('keywords')}
                  >
                    <MessageCircle className="size-4" />
                    {isZh ? '按关键词' : 'Keywords'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addAssistantRoute('conversation')}
                  >
                    <ListFilter className="size-4" />
                    {isZh ? '按群/联系人' : 'Chat or contact'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addAssistantRoute('senderName')}
                  >
                    <UserRound className="size-4" />
                    {isZh ? '按发送人' : 'Sender'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => addAssistantRoute('advanced')}
                  >
                    <SlidersHorizontal className="size-4" />
                    {isZh ? '高级条件' : 'Advanced'}
                  </Button>
                </div>
              </div>

              <details className="border-border bg-muted/20 rounded-lg border px-3 py-2">
                <summary className="text-muted-foreground cursor-pointer text-xs font-medium">
                  {isZh ? '查看规则例子' : 'View examples'}
                </summary>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <div className="bg-background rounded-md border p-2">
                    <div className="text-foreground font-medium">
                      {isZh ? '售后问题' : 'Support issues'}
                    </div>
                    <p className="text-muted-foreground mt-1 leading-5">
                      {isZh
                        ? '消息包含“退款、售后、发票”时交给售后助手。'
                        : 'Route refund, support, and invoice messages.'}
                    </p>
                  </div>
                  <div className="bg-background rounded-md border p-2">
                    <div className="text-foreground font-medium">
                      {isZh ? 'VIP 群' : 'VIP group'}
                    </div>
                    <p className="text-muted-foreground mt-1 leading-5">
                      {isZh
                        ? '从最近会话选择 VIP 群，交给销售助手。'
                        : 'Pick a recent VIP chat and route it to sales.'}
                    </p>
                  </div>
                  <div className="bg-background rounded-md border p-2">
                    <div className="text-foreground font-medium">
                      {isZh ? '负责人消息' : 'Owner messages'}
                    </div>
                    <p className="text-muted-foreground mt-1 leading-5">
                      {isZh
                        ? '填写发送人名称，例如“王总”，交给优先助手。'
                        : 'Route messages from named senders first.'}
                    </p>
                  </div>
                </div>
              </details>

              {form.assistantRoutes.length === 0 ? (
                <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-3 py-3 text-xs">
                  {isZh
                    ? '暂无路由规则。大多数场景只需要渠道默认助手；需要分流时从上方模板添加。'
                    : 'No routing rules. Most setups only need the default assistant; add a template when you need routing.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {form.assistantRoutes.map((route, index) => {
                    const selectedConversationId = firstListValue(
                      route.match.conversationIds
                    );
                    const selectedConversationExists =
                      !!selectedConversationId &&
                      selectedChannelSessions.some(
                        (session) =>
                          session.conversationId === selectedConversationId
                      );
                    const advancedOpen = expandedAdvancedRouteIds.includes(
                      route.id
                    );
                    const advancedConfigured = hasRouteAdvancedFields(route);
                    const matchSummary = [
                      route.match.conversationType
                        ? route.match.conversationType === 'group'
                          ? isZh
                            ? '群聊'
                            : 'Group'
                          : isZh
                            ? '私聊'
                            : 'Private'
                        : undefined,
                      route.match.keywords?.length
                        ? `${isZh ? '关键词' : 'Keywords'}: ${formatRouteList(route.match.keywords)}`
                        : undefined,
                      route.match.senderNames?.length
                        ? `${isZh ? '发送人' : 'Sender'}: ${formatRouteList(route.match.senderNames)}`
                        : undefined,
                      selectedConversationId
                        ? `${isZh ? '会话' : 'Chat'}: ${selectedConversationId}`
                        : undefined,
                      route.match.senderIds?.length
                        ? `${isZh ? '发送人 ID' : 'Sender ID'}: ${formatRouteList(route.match.senderIds)}`
                        : undefined,
                      route.match.regex
                        ? isZh
                          ? '正则匹配'
                          : 'Regex match'
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ');

                    return (
                      <div
                        key={route.id}
                        className="border-border bg-background rounded-lg border p-3"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_180px]">
                            <label className="space-y-1.5">
                              <span className="text-muted-foreground text-xs">
                                {isZh ? '规则名称' : 'Rule name'}
                              </span>
                              <input
                                value={route.name}
                                onChange={(event) =>
                                  updateAssistantRoute(route.id, (current) => ({
                                    ...current,
                                    name: event.target.value,
                                    updatedAt: new Date().toISOString(),
                                  }))
                                }
                                placeholder={
                                  isZh
                                    ? '例如：售后关键词'
                                    : 'After-sales keywords'
                                }
                                className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-muted-foreground text-xs">
                                {isZh ? '使用助手' : 'Use assistant'}
                              </span>
                              <select
                                value={route.assistant.assistantId || 'custom'}
                                onChange={(event) =>
                                  event.target.value === 'custom'
                                    ? applyRouteAssistantProfile(
                                        route.id,
                                        'custom'
                                      )
                                    : applyRouteAssistantProfile(
                                        route.id,
                                        event.target.value
                                      )
                                }
                                className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                              >
                                <option value="custom">
                                  {isZh ? '手动填写' : 'Manual'}
                                </option>
                                {assistantProfiles.map((assistant) => (
                                  <option
                                    key={assistant.id}
                                    value={assistant.id}
                                  >
                                    {assistant.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="flex items-center gap-1 pt-6">
                            <Switch
                              checked={route.enabled}
                              onChange={(checked) =>
                                updateAssistantRoute(route.id, (current) => ({
                                  ...current,
                                  enabled: checked,
                                  updatedAt: new Date().toISOString(),
                                }))
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => moveAssistantRoute(route.id, -1)}
                              disabled={index === 0}
                              aria-label={isZh ? '上移规则' : 'Move rule up'}
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => moveAssistantRoute(route.id, 1)}
                              disabled={
                                index === form.assistantRoutes.length - 1
                              }
                              aria-label={isZh ? '下移规则' : 'Move rule down'}
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeAssistantRoute(route.id)}
                              aria-label={isZh ? '删除规则' : 'Delete rule'}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>

                        <p className="text-muted-foreground mb-3 text-xs">
                          {matchSummary ||
                            (isZh
                              ? '还没有设置触发条件。未设置条件的规则不会生效。'
                              : 'No trigger condition yet. Rules without conditions do not run.')}
                        </p>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1.5">
                            <span className="text-muted-foreground text-xs">
                              {isZh ? '消息来自' : 'Message from'}
                            </span>
                            <select
                              value={route.match.conversationType || 'any'}
                              onChange={(event) =>
                                updateAssistantRoute(route.id, (current) => ({
                                  ...current,
                                  match: {
                                    ...current.match,
                                    conversationType:
                                      event.target.value === 'any'
                                        ? undefined
                                        : (event.target
                                            .value as ChannelConversationType),
                                  },
                                  updatedAt: new Date().toISOString(),
                                }))
                              }
                              className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                            >
                              <option value="any">
                                {isZh ? '不限' : 'Any'}
                              </option>
                              <option value="private">
                                {isZh ? '私聊' : 'Private'}
                              </option>
                              <option value="group">
                                {isZh ? '群聊' : 'Group'}
                              </option>
                            </select>
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-muted-foreground text-xs">
                              {isZh ? '指定最近会话' : 'Recent chat'}
                            </span>
                            <select
                              value={selectedConversationId}
                              disabled={
                                selectedChannelSessions.length === 0 &&
                                !selectedConversationId
                              }
                              onChange={(event) =>
                                updateAssistantRoute(route.id, (current) => ({
                                  ...current,
                                  match: {
                                    ...current.match,
                                    conversationIds: event.target.value
                                      ? [event.target.value]
                                      : [],
                                  },
                                  updatedAt: new Date().toISOString(),
                                }))
                              }
                              className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 disabled:opacity-60"
                            >
                              <option value="">
                                {selectedChannelSessions.length > 0
                                  ? isZh
                                    ? '不限会话'
                                    : 'Any chat'
                                  : isZh
                                    ? '暂无最近会话'
                                    : 'No recent chats'}
                              </option>
                              {selectedConversationId &&
                                !selectedConversationExists && (
                                  <option value={selectedConversationId}>
                                    {isZh ? '已保存会话：' : 'Saved chat: '}
                                    {selectedConversationId}
                                  </option>
                                )}
                              {selectedChannelSessions.map((session) => (
                                <option
                                  key={session.id}
                                  value={session.conversationId}
                                >
                                  {session.conversationType === 'group'
                                    ? isZh
                                      ? '群聊'
                                      : 'Group'
                                    : isZh
                                      ? '私聊'
                                      : 'Private'}
                                  {' · '}
                                  {session.conversationId}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-muted-foreground text-xs">
                              {isZh ? '发送人名称' : 'Sender names'}
                            </span>
                            <input
                              value={joinList(route.match.senderNames)}
                              onChange={(event) =>
                                updateAssistantRoute(route.id, (current) => ({
                                  ...current,
                                  match: {
                                    ...current.match,
                                    senderNames: splitList(event.target.value),
                                  },
                                  updatedAt: new Date().toISOString(),
                                }))
                              }
                              placeholder={isZh ? '张三, 李四' : 'Alice, Bob'}
                              className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-muted-foreground text-xs">
                              {isZh ? '消息关键词' : 'Message keywords'}
                            </span>
                            <input
                              value={joinList(route.match.keywords)}
                              onChange={(event) =>
                                updateAssistantRoute(route.id, (current) => ({
                                  ...current,
                                  match: {
                                    ...current.match,
                                    keywords: splitList(event.target.value),
                                  },
                                  updatedAt: new Date().toISOString(),
                                }))
                              }
                              placeholder={
                                isZh ? '退款, 售后' : 'refund, support'
                              }
                              className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                            />
                          </label>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRouteAdvanced(route.id)}
                          >
                            <SlidersHorizontal className="size-4" />
                            {advancedOpen
                              ? isZh
                                ? '收起高级设置'
                                : 'Hide advanced'
                              : isZh
                                ? '高级设置'
                                : 'Advanced settings'}
                          </Button>
                          {advancedConfigured && !advancedOpen && (
                            <span className="bg-muted text-muted-foreground rounded px-2 py-1 text-xs">
                              {isZh ? '已设置高级项' : 'Advanced fields set'}
                            </span>
                          )}
                        </div>

                        {advancedOpen && (
                          <div className="border-border bg-muted/20 mt-3 rounded-lg border p-3">
                            <p className="text-muted-foreground mb-3 text-xs leading-5">
                              {isZh
                                ? '通常不用填写这些字段。只有需要精确匹配真实渠道 ID、正则表达式或工具范围时再使用。'
                                : 'Most users can skip these fields. Use them for exact IDs, regex, or tool scope.'}
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1.5">
                                <span className="text-muted-foreground text-xs">
                                  {isZh
                                    ? '自定义角色名称'
                                    : 'Custom profile name'}
                                </span>
                                <input
                                  value={route.assistant.assistantName || ''}
                                  onChange={(event) =>
                                    updateAssistantRoute(
                                      route.id,
                                      (current) => ({
                                        ...current,
                                        assistant: {
                                          ...current.assistant,
                                          assistantId: '',
                                          assistantName: event.target.value,
                                        },
                                        updatedAt: new Date().toISOString(),
                                      })
                                    )
                                  }
                                  placeholder={
                                    isZh
                                      ? '例如：售后助手'
                                      : 'After-sales assistant'
                                  }
                                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                                />
                              </label>
                              <label className="space-y-1.5">
                                <span className="text-muted-foreground text-xs">
                                  Conversation IDs
                                </span>
                                <input
                                  value={joinList(route.match.conversationIds)}
                                  onChange={(event) =>
                                    updateAssistantRoute(
                                      route.id,
                                      (current) => ({
                                        ...current,
                                        match: {
                                          ...current.match,
                                          conversationIds: splitList(
                                            event.target.value
                                          ),
                                        },
                                        updatedAt: new Date().toISOString(),
                                      })
                                    )
                                  }
                                  placeholder="vip-room, customer-001"
                                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                                />
                              </label>
                              <label className="space-y-1.5">
                                <span className="text-muted-foreground text-xs">
                                  Sender IDs
                                </span>
                                <input
                                  value={joinList(route.match.senderIds)}
                                  onChange={(event) =>
                                    updateAssistantRoute(
                                      route.id,
                                      (current) => ({
                                        ...current,
                                        match: {
                                          ...current.match,
                                          senderIds: splitList(
                                            event.target.value
                                          ),
                                        },
                                        updatedAt: new Date().toISOString(),
                                      })
                                    )
                                  }
                                  placeholder="user-001, user-002"
                                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                                />
                              </label>
                              <label className="space-y-1.5">
                                <span className="text-muted-foreground text-xs">
                                  Regex
                                </span>
                                <input
                                  value={route.match.regex || ''}
                                  onChange={(event) =>
                                    updateAssistantRoute(
                                      route.id,
                                      (current) => ({
                                        ...current,
                                        match: {
                                          ...current.match,
                                          regex: event.target.value,
                                        },
                                        updatedAt: new Date().toISOString(),
                                      })
                                    )
                                  }
                                  placeholder="退款|售后|发票"
                                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                                />
                              </label>
                              <label className="space-y-1.5 sm:col-span-2">
                                <span className="text-muted-foreground text-xs">
                                  {isZh ? '系统提示词' : 'System prompt'}
                                </span>
                                <textarea
                                  value={route.assistant.prompt || ''}
                                  onChange={(event) =>
                                    updateAssistantRoute(
                                      route.id,
                                      (current) => ({
                                        ...current,
                                        assistant: {
                                          ...current.assistant,
                                          assistantId: '',
                                          prompt: event.target.value,
                                        },
                                        updatedAt: new Date().toISOString(),
                                      })
                                    )
                                  }
                                  placeholder={
                                    isZh
                                      ? '描述该规则命中时助手的回复边界和风格。'
                                      : 'Describe the role used when this rule matches.'
                                  }
                                  className="border-input bg-background text-foreground focus:ring-ring/50 min-h-16 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
                                />
                              </label>
                              <label className="space-y-1.5">
                                <span className="text-muted-foreground text-xs">
                                  Skills
                                </span>
                                <input
                                  value={joinList(route.assistant.skillNames)}
                                  onChange={(event) =>
                                    updateAssistantRoute(
                                      route.id,
                                      (current) => ({
                                        ...current,
                                        assistant: {
                                          ...current.assistant,
                                          assistantId: '',
                                          skillNames: splitList(
                                            event.target.value
                                          ),
                                        },
                                        updatedAt: new Date().toISOString(),
                                      })
                                    )
                                  }
                                  placeholder="crm, docs"
                                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                                />
                              </label>
                              <label className="space-y-1.5">
                                <span className="text-muted-foreground text-xs">
                                  MCP servers
                                </span>
                                <input
                                  value={joinList(
                                    route.assistant.mcpServerNames
                                  )}
                                  onChange={(event) =>
                                    updateAssistantRoute(
                                      route.id,
                                      (current) => ({
                                        ...current,
                                        assistant: {
                                          ...current.assistant,
                                          assistantId: '',
                                          mcpServerNames: splitList(
                                            event.target.value
                                          ),
                                        },
                                        updatedAt: new Date().toISOString(),
                                      })
                                    )
                                  }
                                  placeholder="internal-docs, crm"
                                  className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                                />
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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
              <p className="text-muted-foreground mb-3 text-xs leading-5">
                {isZh
                  ? '直接填写一条消息即可。系统会自动使用模拟会话，不需要填写 Conversation ID 或 Sender ID。'
                  : 'Enter a message only. The app uses a simulated chat, so Conversation ID and Sender ID are not required.'}
              </p>
              <div className="mb-2 grid gap-2">
                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs">
                    {isZh ? '会话类型' : 'Conversation type'}
                  </span>
                  <select
                    value={testConversationType}
                    onChange={(event) =>
                      setTestConversationType(
                        event.target.value as ChannelConversationType
                      )
                    }
                    className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                  >
                    <option value="private">{isZh ? '私聊' : 'Private'}</option>
                    <option value="group">{isZh ? '群聊' : 'Group'}</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-muted-foreground text-xs">
                    {isZh ? '发送人名称' : 'Sender name'}
                  </span>
                  <input
                    value={testSenderName}
                    onChange={(event) => setTestSenderName(event.target.value)}
                    placeholder={isZh ? '发送人名称' : 'Sender name'}
                    className="border-input bg-background text-foreground focus:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
                  />
                </label>
              </div>
              <label className="space-y-1.5">
                <span className="text-muted-foreground text-xs">
                  {isZh ? '测试消息' : 'Test message'}
                </span>
                <textarea
                  value={testText}
                  onChange={(event) => setTestText(event.target.value)}
                  placeholder={
                    isZh ? '发送一条测试消息' : 'Send a test message'
                  }
                  className="border-input bg-background text-foreground focus:ring-ring/50 min-h-20 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
                />
              </label>
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
              {testResult && (
                <div className="bg-muted text-muted-foreground mt-3 space-y-2 rounded p-2 text-xs">
                  <div>
                    <span className="text-foreground">
                      {isZh ? '命中规则：' : 'Matched rule: '}
                    </span>
                    {testResult.session?.assistantRouteName ||
                      (isZh ? '默认助手' : 'Default assistant')}
                  </div>
                  <div>
                    <span className="text-foreground">
                      {isZh ? '使用助手：' : 'Assistant: '}
                    </span>
                    {testResult.session?.assistant?.assistantName ||
                      (isZh ? '未配置' : 'Not configured')}
                  </div>
                  {testResult.reply?.text && (
                    <p className="border-border border-t pt-2 leading-5">
                      {testResult.reply.text}
                    </p>
                  )}
                </div>
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
                        {session.assistant?.assistantName && (
                          <div className="text-muted-foreground mt-1 truncate text-xs">
                            {session.assistantRouteName ||
                              (isZh ? '默认助手' : 'Default')}
                            {' · '}
                            {session.assistant.assistantName}
                          </div>
                        )}
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
        <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isZh ? '渠道管理操作指南' : 'Channel management guide'}
            </DialogTitle>
            <DialogDescription>
              {isZh
                ? '按当前渠道管理页面的配置流程说明接入、路由、测试和会话验证步骤。'
                : 'Explains the current channel setup, routing, testing, and session verification flow.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">
                {isZh ? '这是什么' : 'What this does'}
              </h3>
              <p className="text-muted-foreground leading-6">
                {isZh
                  ? '渠道管理用于把飞书、微信、钉钉接到本应用。接好后，客户在这些渠道里发来的消息会进入本地助手会话，并由你配置的默认助手或路由助手处理。'
                  : 'Channel management connects Feishu, WeChat, and DingTalk to this app. Incoming messages become local assistant sessions and are handled by the default assistant or routing assistant you configure.'}
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">
                {isZh ? '当前渠道配置说明' : 'Current channel settings'}
              </h3>
              <p className="text-muted-foreground leading-6">
                {isZh
                  ? '这里会根据当前选中的渠道展示对应配置项。需要查看微信、飞书或钉钉的说明时，先切换上方渠道卡片再打开指南。'
                  : 'This section follows the currently selected channel. To see WeChat, Feishu, or DingTalk-specific notes, switch the channel card first and then open the guide.'}
              </p>
              <div className="rounded-lg border p-3">
                <div className="text-foreground font-medium">
                  {selectedGuideCopy.title}
                </div>
                <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  {[...commonGuideItems, ...selectedGuideCopy.items].map(
                    (item) => (
                      <div key={item.label} className="space-y-1">
                        <dt className="text-foreground text-xs font-medium">
                          {item.label}
                        </dt>
                        <dd className="text-muted-foreground text-xs leading-5">
                          {item.description}
                        </dd>
                      </div>
                    )
                  )}
                </dl>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">
                {isZh ? '推荐配置流程' : 'Recommended setup flow'}
              </h3>
              <ol className="text-muted-foreground list-decimal space-y-2 pl-5 leading-6">
                <li>
                  {isZh
                    ? '先从上方卡片选择要接入的渠道，例如微信、飞书或钉钉。'
                    : 'Choose the channel card you want to connect, such as WeChat, Feishu, or DingTalk.'}
                </li>
                <li>
                  {isZh
                    ? '在渠道详情里打开启用开关，并在“渠道默认助手”选择已有助手，或手动填写兜底角色和系统提示词。'
                    : 'Enable the channel in its detail panel, then choose an existing default assistant or manually enter the fallback role and system prompt.'}
                </li>
                <li>
                  {isZh
                    ? '高级设置只在需要限定 Skills 或 MCP servers 时填写；普通接入可以先保持为空。'
                    : 'Use advanced settings only when the assistant must be limited to specific Skills or MCP servers; most setups can leave them empty.'}
                </li>
                <li>
                  {isZh
                    ? '如果同一渠道需要多个助手，使用“助手路由规则”按关键词、群/联系人、发送人或高级条件添加规则。规则按列表顺序优先匹配，没有触发条件的规则不会生效。'
                    : 'If one channel needs multiple assistants, add routing rules by keyword, chat/contact, sender, or advanced conditions. Rules match in list order, and rules without trigger conditions do not run.'}
                </li>
                <li>
                  {isZh
                    ? '点击“保存配置”，再连接渠道：微信使用“连接微信”扫码，飞书和钉钉使用“获取授权指引”完成管理员配置；钉钉群机器人还需要填写 Robot Code。'
                    : 'Click Save, then connect the channel: use Connect WeChat for QR login, or Get setup guide for Feishu and DingTalk admin setup. DingTalk group bots also require a Robot Code.'}
                </li>
                <li>
                  {isZh
                    ? '用右侧“测试入站消息”验证命中规则、使用助手和回复结果；产生真实或模拟会话后，可在“活跃会话”里打开对应会话。'
                    : 'Use Test inbound message to verify the matched rule, selected assistant, and reply. After a real or simulated session exists, open it from Active sessions.'}
                </li>
              </ol>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">
                {isZh ? '各渠道当前支持情况' : 'Current channel support'}
              </h3>
              <div className="grid gap-2">
                <div className="rounded-lg border p-3">
                  <div className="text-foreground font-medium">
                    {isZh ? '微信' : 'WeChat'}
                  </div>
                  <p className="text-muted-foreground mt-1 leading-6">
                    {isZh
                      ? '已支持应用内扫码连接、连接状态展示、重新连接和断开连接。完成扫码确认后，微信消息会进入本应用助手会话。'
                      : 'Supports in-app QR login, connection status, reconnect, and disconnect. After QR confirmation, WeChat messages enter assistant sessions in this app.'}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-foreground font-medium">
                    {isZh ? '飞书' : 'Feishu'}
                  </div>
                  <p className="text-muted-foreground mt-1 leading-6">
                    {isZh
                      ? '已支持授权接入、消息接收和自动回复能力。正式使用前，需要管理员在飞书开放平台配置应用权限和消息回调。'
                      : 'Supports authorization, message intake, and automatic replies. Before production use, an admin must configure app permissions and message callbacks in the Feishu developer platform.'}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-foreground font-medium">
                    {isZh ? '钉钉' : 'DingTalk'}
                  </div>
                  <p className="text-muted-foreground mt-1 leading-6">
                    {isZh
                      ? '已支持企业授权、群消息和机器人回复配置。正式使用前，需要管理员配置钉钉应用、消息回调和 Robot Code。'
                      : 'Supports enterprise authorization, group messages, and bot reply setup. Before production use, an admin must configure the DingTalk app, message callback, and Robot Code.'}
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-foreground font-semibold">
                {isZh ? '怎么确认已经接好' : 'How to confirm it works'}
              </h3>
              <p className="text-muted-foreground leading-6">
                {isZh
                  ? '可以在右侧“测试入站消息”里选择私聊或群聊，填写发送人名称和测试消息后点击“运行测试”。测试结果会展示命中规则、使用助手和回复内容；如果外部渠道刚完成配置，可先点击“刷新”同步最新状态。'
                  : 'In Test inbound message, choose private or group chat, enter a sender name and test message, then click Run test. The result shows the matched rule, assistant, and reply. If an external channel was just configured, click Refresh to sync the latest status first.'}
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
