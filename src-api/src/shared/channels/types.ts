import type { AgentMessage } from '@/core/agent';

export type ChannelId = 'feishu' | 'weixin' | 'dingtalk';

export type ChannelAuthMode = 'oauth' | 'qr' | 'webhook';

export interface ChannelDefinition {
  id: ChannelId;
  name: string;
  authMode: ChannelAuthMode;
  inboundMode: 'event' | 'polling' | 'webhook';
  official: boolean;
  description: string;
  risks: string[];
  capabilities: string[];
  requiredCommands: string[];
}

export interface ChannelAssistantBinding {
  assistantId?: string;
  assistantName?: string;
  prompt?: string;
  skillNames?: string[];
  mcpServerNames?: string[];
}

export type ChannelConversationType = 'private' | 'group';

export interface ChannelAssistantRouteMatch {
  conversationType?: ChannelConversationType;
  conversationIds?: string[];
  senderIds?: string[];
  senderNames?: string[];
  keywords?: string[];
  regex?: string;
}

export interface ChannelAssistantRoute {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match: ChannelAssistantRouteMatch;
  assistant: ChannelAssistantBinding;
  updatedAt: string;
}

export interface ChannelBinding {
  channel: ChannelId;
  enabled: boolean;
  defaultAssistant?: ChannelAssistantBinding;
  assistantRoutes?: ChannelAssistantRoute[];
  config: Record<string, string | boolean | number | undefined>;
  updatedAt: string;
}

export interface ChannelMediaAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  filePath?: string;
  url?: string;
  mimeType?: string;
  fileName?: string;
}

export interface ChannelInboundMessage {
  channel: ChannelId;
  conversationType?: ChannelConversationType;
  conversationId: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  text: string;
  media?: ChannelMediaAttachment[];
  assistant?: ChannelAssistantBinding;
  raw?: unknown;
}

export interface ChannelOutboundMessage {
  text: string;
  media?: ChannelMediaAttachment[];
}

export interface ChannelConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface ChannelConversationSession {
  id: string;
  channel: ChannelId;
  conversationType?: ChannelConversationType;
  conversationId: string;
  assistant?: ChannelAssistantBinding;
  assistantRouteId?: string;
  assistantRouteName?: string;
  history: ChannelConversationMessage[];
  createdAt: string;
  lastActiveAt: string;
  status: 'idle' | 'running' | 'error';
  lastError?: string;
}

export interface ChannelAgentRunRequest {
  prompt: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  channel: ChannelId;
  session: ChannelConversationSession;
  inbound: ChannelInboundMessage;
  assistant?: ChannelAssistantBinding;
}

export type ChannelAgentRunner = (
  request: ChannelAgentRunRequest
) => AsyncGenerator<AgentMessage>;

export interface ChannelSendRequest {
  inbound: ChannelInboundMessage;
  reply: ChannelOutboundMessage;
  session: ChannelConversationSession;
  binding?: ChannelBinding;
}

export interface ChannelSendResult {
  ok: boolean;
  command?: ChannelCommandSpec;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export type ChannelOutboundSender = (
  request: ChannelSendRequest
) => Promise<ChannelSendResult>;

export interface ChannelCommandSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  description: string;
}

export interface ChannelCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ChannelCommandRunner = (
  command: string,
  args: string[],
  options?: {
    env?: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
  }
) => Promise<ChannelCommandResult>;

export interface ChannelAuthSession {
  channel: ChannelId;
  command: ChannelCommandSpec;
  executed: boolean;
  result?: ChannelCommandResult;
  nextSteps: string[];
  warning?: string;
}

export interface ChannelInboundResult {
  session: ChannelConversationSession;
  reply: ChannelOutboundMessage;
  sent: ChannelSendResult;
  messages: AgentMessage[];
}

export interface ChannelIntegrationStatus {
  definitions: ChannelDefinition[];
  bindings: ChannelBinding[];
  sessions: ChannelConversationSession[];
  connections?: ChannelConnectionStatus[];
}

export interface ChannelConnectionStatus {
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

export type WeixinLoginStatus =
  | 'waiting'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  | 'failed'
  | 'cancelled';

export interface WeixinLoginSession {
  sessionId: string;
  status: WeixinLoginStatus;
  qrCodeSvg?: string;
  qrCodeUrl?: string;
  expiresAt: string;
  message: string;
  accountId?: string;
  error?: string;
  updatedAt: string;
}
