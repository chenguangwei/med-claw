import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { nanoid } from 'nanoid';

import type {
  AgentMessage,
  ConversationMessage,
  McpConfig,
  SkillsConfig,
} from '@/core/agent';
import type { AgentConfig } from '@/core/agent/types';
import { getAppDir } from '@/config/constants';
import { getProviderManager } from '@/shared/provider/manager';
import { createSession, runAgent } from '@/shared/services/agent';

import type {
  ChannelAgentRunner,
  ChannelAssistantBinding,
  ChannelAssistantRoute,
  ChannelAuthSession,
  ChannelBinding,
  ChannelCommandResult,
  ChannelCommandRunner,
  ChannelCommandSpec,
  ChannelConversationSession,
  ChannelDefinition,
  ChannelId,
  ChannelInboundMessage,
  ChannelInboundResult,
  ChannelIntegrationStatus,
  ChannelOutboundMessage,
  ChannelOutboundSender,
  ChannelSendResult,
} from './types';
import { createWeixinLoginManager } from './weixin-login';

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_CHANNEL_HISTORY_MESSAGES = 20;
export const CHANNEL_MODEL_CONFIG_ERROR =
  '微信消息已收到，但当前应用没有可用模型配置。请先在应用设置里配置模型供应商、API Key 和默认模型后再试。';
const CHANNEL_STORE_FILE =
  process.env.UNIINS_CLAW_CHANNEL_STORE_FILE ||
  join(getAppDir(), 'channels.json');

export const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
  {
    id: 'feishu',
    name: '飞书 / Lark',
    authMode: 'oauth',
    inboundMode: 'event',
    official: true,
    description: '接入飞书消息，让飞书里的咨询由本应用助手自动处理。',
    risks: ['请确认飞书应用已获得必要的消息权限。'],
    capabilities: ['企业授权', '消息接收', '自动回复', '文档协作'],
    requiredCommands: ['飞书登录工具'],
  },
  {
    id: 'weixin',
    name: '微信',
    authMode: 'qr',
    inboundMode: 'polling',
    official: true,
    description: '通过手机微信扫码连接账号，让微信消息进入本应用助手会话。',
    risks: ['请在可信电脑上完成扫码登录，并保持登录窗口开启。'],
    capabilities: ['扫码登录', '消息接收', '自动回复', '文件消息'],
    requiredCommands: ['微信登录工具'],
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    authMode: 'oauth',
    inboundMode: 'webhook',
    official: true,
    description: '接入钉钉企业应用和群机器人，让钉钉群消息可由助手处理。',
    risks: ['需要企业管理员完成应用授权和消息回调配置。'],
    capabilities: ['企业授权', '群消息', '机器人回复', '协作工具'],
    requiredCommands: ['钉钉登录工具'],
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function createDefaultBindings(): Map<ChannelId, ChannelBinding> {
  return new Map(
    CHANNEL_DEFINITIONS.map((definition) => [
      definition.id,
      {
        channel: definition.id,
        enabled: false,
        config: {},
        updatedAt: nowIso(),
      },
    ])
  );
}

function loadStoredBindings(storeFile: string): Map<ChannelId, ChannelBinding> {
  const bindings = createDefaultBindings();

  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8')) as {
      bindings?: ChannelBinding[];
    };
    if (!Array.isArray(parsed.bindings)) return bindings;

    for (const binding of parsed.bindings) {
      if (!binding || !bindings.has(binding.channel)) continue;
      const current = bindings.get(binding.channel)!;
      bindings.set(binding.channel, {
        ...current,
        enabled: Boolean(binding.enabled),
        defaultAssistant: normalizeAssistantBinding(binding.defaultAssistant),
        assistantRoutes: normalizeAssistantRoutes(binding.assistantRoutes),
        config:
          binding.config && typeof binding.config === 'object'
            ? binding.config
            : {},
        updatedAt: binding.updatedAt || nowIso(),
      });
    }
  } catch {
    return bindings;
  }

  return bindings;
}

function saveStoredBindings(
  storeFile: string,
  bindings: Map<ChannelId, ChannelBinding>
): void {
  fs.mkdirSync(dirname(storeFile), { recursive: true });
  const tempFile = `${storeFile}.tmp`;
  fs.writeFileSync(
    tempFile,
    `${JSON.stringify({ bindings: [...bindings.values()] }, null, 2)}\n`,
    'utf8'
  );
  fs.renameSync(tempFile, storeFile);
}

function createSessionKey(channel: ChannelId, conversationId: string): string {
  return `${channel}:${conversationId}`;
}

function normalizeAssistantBinding(
  binding?: ChannelAssistantBinding
): ChannelAssistantBinding | undefined {
  if (!binding) return undefined;

  const next: ChannelAssistantBinding = {};
  const assistantId =
    typeof binding.assistantId === 'string' ? binding.assistantId.trim() : '';
  const assistantName =
    typeof binding.assistantName === 'string'
      ? binding.assistantName.trim()
      : '';
  const prompt =
    typeof binding.prompt === 'string' ? binding.prompt.trim() : '';
  const skillNames = normalizeStringList(binding.skillNames);
  const mcpServerNames = normalizeStringList(binding.mcpServerNames);

  if (assistantId) next.assistantId = assistantId;
  if (assistantName) next.assistantName = assistantName;
  if (prompt) next.prompt = prompt;
  if (skillNames.length > 0) next.skillNames = skillNames;
  if (mcpServerNames.length > 0) {
    next.mcpServerNames = mcpServerNames;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizeRouteMatch(match: unknown): ChannelAssistantRoute['match'] {
  if (!match || typeof match !== 'object') return {};
  const value = match as ChannelAssistantRoute['match'];
  const next: ChannelAssistantRoute['match'] = {};

  if (
    value.conversationType === 'private' ||
    value.conversationType === 'group'
  ) {
    next.conversationType = value.conversationType;
  }
  next.conversationIds = normalizeStringList(value.conversationIds);
  next.senderIds = normalizeStringList(value.senderIds);
  next.senderNames = normalizeStringList(value.senderNames);
  next.keywords = normalizeStringList(value.keywords);
  if (typeof value.regex === 'string' && value.regex.trim()) {
    next.regex = value.regex.trim();
  }

  return next;
}

function normalizeAssistantRoute(
  route: unknown,
  fallbackPriority: number
): ChannelAssistantRoute | undefined {
  if (!route || typeof route !== 'object') return undefined;
  const value = route as Partial<ChannelAssistantRoute>;
  const assistant = normalizeAssistantBinding(value.assistant);
  if (!assistant) return undefined;

  return {
    id:
      typeof value.id === 'string' && value.id.trim()
        ? value.id.trim()
        : `route-${nanoid(8)}`,
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : assistant.assistantName || '助手路由',
    enabled: value.enabled !== false,
    priority:
      typeof value.priority === 'number' && Number.isFinite(value.priority)
        ? value.priority
        : fallbackPriority,
    match: normalizeRouteMatch(value.match),
    assistant,
    updatedAt: value.updatedAt || nowIso(),
  };
}

function normalizeAssistantRoutes(value: unknown): ChannelAssistantRoute[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((route, index) => normalizeAssistantRoute(route, index + 1))
    .filter((route): route is ChannelAssistantRoute => Boolean(route))
    .sort((left, right) => left.priority - right.priority);
}

function buildSkillsConfig(
  assistant?: ChannelAssistantBinding
): SkillsConfig | undefined {
  if (!assistant?.skillNames) return undefined;
  return {
    enabled: true,
    userDirEnabled: true,
    appDirEnabled: true,
    includeSkills: assistant.skillNames,
  };
}

function buildMcpConfig(
  assistant?: ChannelAssistantBinding
): McpConfig | undefined {
  if (!assistant?.mcpServerNames) return undefined;
  return {
    enabled: true,
    userDirEnabled: true,
    appDirEnabled: true,
    includeServers: assistant.mcpServerNames,
  };
}

function messagesToConversation(
  history: ChannelConversationSession['history']
): ConversationMessage[] {
  return history.slice(-MAX_CHANNEL_HISTORY_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function createCommandSpec(
  channel: ChannelId,
  _binding?: ChannelBinding
): ChannelCommandSpec {
  if (channel === 'feishu') {
    return {
      command: 'lark-cli',
      args: ['auth', 'login', '--recommend'],
      description: '启动飞书授权流程。按提示完成授权。',
    };
  }

  if (channel === 'weixin') {
    return {
      command: 'app',
      args: ['channels', 'weixin', 'connect'],
      description: '请在页面点击“连接微信”，并用手机微信扫码完成连接。',
    };
  }

  return {
    command: 'dws',
    args: ['auth', 'login'],
    description: '启动钉钉授权流程。企业管理员授权后才能访问企业数据。',
  };
}

function createSendCommandSpec(
  inbound: ChannelInboundMessage,
  reply: ChannelOutboundMessage,
  binding?: ChannelBinding
): ChannelCommandSpec | undefined {
  if (inbound.channel === 'feishu') {
    return {
      command: 'lark-cli',
      args: [
        'im',
        '+messages-send',
        '--chat-id',
        inbound.conversationId,
        '--text',
        reply.text,
      ],
      description: '通过 lark-cli 发送飞书 IM 回复。',
    };
  }

  if (inbound.channel === 'dingtalk') {
    const robotCode = String(binding?.config.robotCode || '');
    if (!robotCode) return undefined;

    return {
      command: 'dws',
      args: [
        'chat',
        'message',
        'send-by-bot',
        '--robot-code',
        robotCode,
        '--group',
        inbound.conversationId,
        '--title',
        'Agent 回复',
        '--text',
        reply.text,
      ],
      description: '通过 dws 钉钉机器人发送群聊回复。',
    };
  }

  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizeApiType(value: unknown): AgentConfig['apiType'] | undefined {
  if (value === 'anthropic-messages' || value === 'openai-completions') {
    return value;
  }
  return undefined;
}

function lower(value: string): string {
  return value.trim().toLowerCase();
}

function matchesList(values: string[] | undefined, actual?: string): boolean {
  if (!values?.length) return true;
  if (!actual) return false;
  const normalizedActual = lower(actual);
  return values.some((value) => lower(value) === normalizedActual);
}

function matchesKeywords(
  keywords: string[] | undefined,
  text: string
): boolean {
  if (!keywords?.length) return true;
  const normalizedText = lower(text);
  return keywords.some((keyword) => normalizedText.includes(lower(keyword)));
}

function matchesRegex(regex: string | undefined, text: string): boolean {
  if (!regex) return true;
  try {
    return new RegExp(regex, 'i').test(text);
  } catch {
    return false;
  }
}

function hasRouteCondition(route: ChannelAssistantRoute): boolean {
  const match = route.match;
  return Boolean(
    match.conversationType ||
    match.conversationIds?.length ||
    match.senderIds?.length ||
    match.senderNames?.length ||
    match.keywords?.length ||
    match.regex
  );
}

export function channelAssistantRouteMatches(
  route: ChannelAssistantRoute,
  inbound: ChannelInboundMessage
): boolean {
  if (!route.enabled || !hasRouteCondition(route)) return false;
  const match = route.match;

  if (
    match.conversationType &&
    match.conversationType !== inbound.conversationType
  ) {
    return false;
  }

  return (
    matchesList(match.conversationIds, inbound.conversationId) &&
    matchesList(match.senderIds, inbound.senderId) &&
    matchesList(match.senderNames, inbound.senderName) &&
    matchesKeywords(match.keywords, inbound.text) &&
    matchesRegex(match.regex, inbound.text)
  );
}

export function resolveChannelAssistantBinding(
  inbound: ChannelInboundMessage,
  binding?: ChannelBinding
): {
  assistant?: ChannelAssistantBinding;
  route?: ChannelAssistantRoute;
} {
  const inboundAssistant = normalizeAssistantBinding(inbound.assistant);
  if (inboundAssistant) return { assistant: inboundAssistant };

  const route = normalizeAssistantRoutes(binding?.assistantRoutes).find(
    (candidate) => channelAssistantRouteMatches(candidate, inbound)
  );
  if (route) return { assistant: route.assistant, route };

  return { assistant: normalizeAssistantBinding(binding?.defaultAssistant) };
}

export function resolveChannelAgentModelConfig():
  | Pick<AgentConfig, 'apiKey' | 'baseUrl' | 'model' | 'apiType'>
  | undefined {
  const providerConfig = (getProviderManager().getConfig().agent?.config ||
    {}) as Partial<AgentConfig>;
  const apiKey = firstNonEmptyString(
    providerConfig.apiKey,
    process.env.CODEANY_API_KEY,
    process.env.CODEANY_AUTH_TOKEN
  );

  if (!apiKey) return undefined;

  const modelConfig: Pick<
    AgentConfig,
    'apiKey' | 'baseUrl' | 'model' | 'apiType'
  > = { apiKey };
  const baseUrl = firstNonEmptyString(
    providerConfig.baseUrl,
    process.env.CODEANY_BASE_URL
  );
  const model = firstNonEmptyString(
    providerConfig.model,
    process.env.CODEANY_MODEL
  );
  const apiType = normalizeApiType(
    firstNonEmptyString(providerConfig.apiType, process.env.CODEANY_API_TYPE)
  );

  if (baseUrl) modelConfig.baseUrl = baseUrl;
  if (model) modelConfig.model = model;
  if (apiType) modelConfig.apiType = apiType;

  return modelConfig;
}

export function getChannelDefinitions(): ChannelDefinition[] {
  return CHANNEL_DEFINITIONS.map((definition) => ({
    ...definition,
    risks: [...definition.risks],
    capabilities: [...definition.capabilities],
    requiredCommands: [...definition.requiredCommands],
  }));
}

export function buildChannelAgentPrompt(
  inbound: ChannelInboundMessage,
  assistant?: ChannelAssistantBinding
): string {
  const assistantLines = assistant
    ? [
        `<assistant-profile name="${assistant.assistantName || 'Channel Agent'}">`,
        `[Active assistant: ${assistant.assistantName || 'Channel Agent'}]`,
        assistant.prompt || '',
        `Allowed Skills: ${
          assistant.skillNames?.length
            ? assistant.skillNames.join(', ')
            : 'none'
        }`,
        `Allowed MCP servers: ${
          assistant.mcpServerNames?.length
            ? assistant.mcpServerNames.join(', ')
            : 'none'
        }`,
        '严格按该助手的 Skills 与 MCP 范围执行；未列出的 Skills 或 MCP 服务不可用于本次请求。',
        '</assistant-profile>',
      ]
    : [];

  const mediaLines =
    inbound.media && inbound.media.length > 0
      ? [
          'Attachments:',
          ...inbound.media.map((media) =>
            [
              `- type=${media.type}`,
              media.fileName ? `name=${media.fileName}` : undefined,
              media.filePath ? `path=${media.filePath}` : undefined,
              media.url ? `url=${media.url}` : undefined,
            ]
              .filter(Boolean)
              .join(' ')
          ),
        ]
      : [];

  return [
    `<channel-message channel="${inbound.channel}" conversation="${inbound.conversationId}" sender="${inbound.senderName || inbound.senderId || 'unknown'}">`,
    ...assistantLines,
    ...mediaLines,
    inbound.text,
    '</channel-message>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function collectChannelAgentReply(messages: AgentMessage[]): string {
  const finalResult = [...messages]
    .reverse()
    .find((message) => message.type === 'result' && message.result);
  if (finalResult?.result) return finalResult.result;

  const directAnswer = messages.find(
    (message) => message.type === 'direct_answer' && message.content
  );
  if (directAnswer?.content && messages.length === 1) {
    return directAnswer.content;
  }

  const text = messages
    .filter(
      (message) =>
        (message.type === 'text' || message.type === 'direct_answer') &&
        message.content
    )
    .map((message) => message.content)
    .join('\n')
    .trim();
  if (text) return text;

  const error = [...messages]
    .reverse()
    .find((message) => message.type === 'error' && message.message);
  if (error?.message) return `Agent 执行失败：${error.message}`;

  return 'Agent 已完成，但没有生成可发送的文本回复。';
}

export const defaultChannelCommandRunner: ChannelCommandRunner = (
  command,
  args,
  options
) => {
  return new Promise<ChannelCommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: {
        ...process.env,
        ...(options?.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options?.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
};

export interface ChannelIntegrationServiceOptions {
  agentRunner?: ChannelAgentRunner;
  outboundSender?: ChannelOutboundSender;
  commandRunner?: ChannelCommandRunner;
  storeFile?: string | false;
}

export function createChannelIntegrationService(
  options: ChannelIntegrationServiceOptions = {}
) {
  const storeFile =
    options.storeFile === undefined ? CHANNEL_STORE_FILE : options.storeFile;
  const bindings =
    storeFile === false
      ? createDefaultBindings()
      : loadStoredBindings(storeFile);
  const sessions = new Map<string, ChannelConversationSession>();
  const commandRunner = options.commandRunner || defaultChannelCommandRunner;

  const agentRunner: ChannelAgentRunner =
    options.agentRunner ||
    async function* defaultAgentRunner(request) {
      const agentSession = createSession('execute');
      const assistant = request.assistant;
      const modelConfig = resolveChannelAgentModelConfig();

      if (!modelConfig) {
        yield { type: 'error', message: CHANNEL_MODEL_CONFIG_ERROR };
        yield { type: 'done' };
        return;
      }

      yield* runAgent(
        request.prompt,
        agentSession,
        request.conversation,
        undefined,
        request.session.id,
        modelConfig,
        undefined,
        undefined,
        buildSkillsConfig(assistant),
        buildMcpConfig(assistant),
        'zh-CN'
      );
    };

  const outboundSender: ChannelOutboundSender =
    options.outboundSender ||
    (async ({ inbound, reply, binding }) => {
      if (inbound.channel === 'weixin') {
        return {
          ok: true,
          stdout: '微信回复已交给当前登录会话发送。',
        };
      }

      const command = createSendCommandSpec(inbound, reply, binding);
      if (!command) {
        return {
          ok: false,
          error: `缺少 ${inbound.channel} 发送配置。`,
        };
      }

      const result = await commandRunner(command.command, command.args, {
        env: command.env,
        cwd: command.cwd,
      });
      return {
        ok: result.code === 0,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.code === 0 ? undefined : result.stderr || result.stdout,
      };
    });

  function getOrCreateSession(
    inbound: ChannelInboundMessage,
    assistant?: ChannelAssistantBinding,
    route?: ChannelAssistantRoute
  ): ChannelConversationSession {
    const key = createSessionKey(inbound.channel, inbound.conversationId);
    const existing = sessions.get(key);
    if (existing) {
      existing.assistant = assistant || existing.assistant;
      existing.assistantRouteId = route?.id;
      existing.assistantRouteName = route?.name;
      existing.conversationType =
        inbound.conversationType || existing.conversationType;
      return existing;
    }

    const timestamp = nowIso();
    const session: ChannelConversationSession = {
      id: `channel-${inbound.channel}-${nanoid(10)}`,
      channel: inbound.channel,
      conversationType: inbound.conversationType,
      conversationId: inbound.conversationId,
      assistant,
      assistantRouteId: route?.id,
      assistantRouteName: route?.name,
      history: [],
      createdAt: timestamp,
      lastActiveAt: timestamp,
      status: 'idle',
    };
    sessions.set(key, session);
    return session;
  }

  return {
    getStatus(): ChannelIntegrationStatus {
      return {
        definitions: getChannelDefinitions(),
        bindings: [...bindings.values()],
        sessions: [...sessions.values()],
      };
    },

    updateBinding(
      channel: ChannelId,
      patch: Partial<Omit<ChannelBinding, 'channel' | 'updatedAt'>>
    ): ChannelBinding {
      const current = bindings.get(channel);
      if (!current) {
        throw new Error(`Unknown channel: ${channel}`);
      }

      const next: ChannelBinding = {
        ...current,
        ...patch,
        config: {
          ...current.config,
          ...(patch.config || {}),
        },
        defaultAssistant:
          patch.defaultAssistant === undefined
            ? current.defaultAssistant
            : normalizeAssistantBinding(patch.defaultAssistant),
        assistantRoutes:
          patch.assistantRoutes === undefined
            ? current.assistantRoutes
            : normalizeAssistantRoutes(patch.assistantRoutes),
        updatedAt: nowIso(),
      };
      bindings.set(channel, next);
      if (storeFile !== false) {
        saveStoredBindings(storeFile, bindings);
      }
      return next;
    },

    async createAuthSession(
      channel: ChannelId,
      options?: { execute?: boolean }
    ): Promise<ChannelAuthSession> {
      const binding = bindings.get(channel);
      const command = createCommandSpec(channel, binding);
      const shouldExecute = options?.execute === true;
      const result = shouldExecute
        ? await commandRunner(command.command, command.args, {
            env: command.env,
            cwd: command.cwd,
            timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
          })
        : undefined;

      return {
        channel,
        command,
        executed: shouldExecute,
        result,
        nextSteps:
          channel === 'weixin'
            ? [
                '点击页面上的“连接微信”。',
                '在弹出的二维码窗口中使用手机微信扫码。',
                '手机确认后，本应用会自动完成连接。',
              ]
            : [
                '根据页面提示完成授权。',
                '授权完成后在渠道设置里启用该渠道。',
                '请管理员完成平台消息回调配置。',
              ],
        warning:
          channel === 'weixin' ? '请在可信电脑上完成扫码登录。' : undefined,
      };
    },

    async sendMessage(
      inbound: ChannelInboundMessage,
      reply: ChannelOutboundMessage
    ): Promise<ChannelSendResult> {
      const binding = bindings.get(inbound.channel);
      const resolution = resolveChannelAssistantBinding(inbound, binding);
      const session = getOrCreateSession(
        inbound,
        resolution.assistant,
        resolution.route
      );
      return outboundSender({ inbound, reply, session, binding });
    },

    async handleInboundMessage(
      inbound: ChannelInboundMessage
    ): Promise<ChannelInboundResult> {
      const binding = bindings.get(inbound.channel);
      const resolution = resolveChannelAssistantBinding(inbound, binding);
      const assistant = resolution.assistant;
      const session = getOrCreateSession(inbound, assistant, resolution.route);
      const timestamp = nowIso();

      session.status = 'running';
      session.lastActiveAt = timestamp;
      session.history.push({
        role: 'user',
        content: inbound.text,
        at: timestamp,
      });

      const prompt = buildChannelAgentPrompt(inbound, assistant);
      const conversation = messagesToConversation(session.history);
      const messages: AgentMessage[] = [];

      try {
        for await (const message of agentRunner({
          prompt,
          conversation,
          channel: inbound.channel,
          session,
          inbound,
          assistant,
        })) {
          messages.push(message);
        }

        const reply: ChannelOutboundMessage = {
          text: collectChannelAgentReply(messages),
        };
        const sent = await outboundSender({
          inbound,
          reply,
          session,
          binding,
        });
        const finishedAt = nowIso();

        session.history.push({
          role: 'assistant',
          content: reply.text,
          at: finishedAt,
        });
        session.status = sent.ok ? 'idle' : 'error';
        session.lastActiveAt = finishedAt;
        session.lastError = sent.error;

        return { session, reply, sent, messages };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        session.status = 'error';
        session.lastError = message;
        session.lastActiveAt = nowIso();
        throw error;
      }
    },
  };
}

export const channelIntegrationService = createChannelIntegrationService();

export const weixinLoginManager = createWeixinLoginManager({
  inboundHandler: (message) =>
    channelIntegrationService.handleInboundMessage(message),
  autoStartStoredConnection:
    process.env.UNIINS_CLAW_DISABLE_WEIXIN_AUTO_START === '1'
      ? false
      : undefined,
});
