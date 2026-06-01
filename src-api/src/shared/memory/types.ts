export type MemoryKind =
  | 'preference'
  | 'decision'
  | 'fact'
  | 'workflow'
  | 'constraint';

export type MemoryStatus = 'active' | 'pending' | 'archived';

export type MemoryScopeType =
  | 'global'
  | 'project'
  | 'session'
  | 'channel'
  | 'scheduled';

export interface MemoryScope {
  type: MemoryScopeType;
  id?: string;
}

export interface MemorySource {
  origin?: 'manual' | 'chat' | 'agent' | 'channel' | 'scheduled';
  sessionId?: string;
  taskId?: string;
  messageId?: string;
}

export interface AgentMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  tags: string[];
  scope: MemoryScope;
  confidence: number;
  importance: number;
  status: MemoryStatus;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  useCount: number;
}

export interface CreateMemoryInput {
  kind: MemoryKind;
  content: string;
  tags?: string[];
  scope?: MemoryScope;
  confidence?: number;
  importance?: number;
  status?: MemoryStatus;
  source?: MemorySource;
}

export interface UpdateMemoryInput {
  kind?: MemoryKind;
  content?: string;
  tags?: string[];
  scope?: MemoryScope;
  confidence?: number;
  importance?: number;
  status?: MemoryStatus;
  source?: MemorySource;
  lastUsedAt?: string | null;
  useCount?: number;
}

export interface ListMemoryFilter {
  status?: MemoryStatus;
  kind?: MemoryKind;
  scopeType?: MemoryScopeType;
  scopeId?: string;
  query?: string;
}

export interface ShortTermMemory {
  sessionId: string;
  summary: string;
  activeGoal?: string;
  openQuestions: string[];
  files: string[];
  sourceTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertShortTermMemoryInput {
  sessionId: string;
  summary: string;
  activeGoal?: string;
  openQuestions?: string[];
  files?: string[];
  sourceTaskId?: string;
}

export type MemoryAutoSaveMode = 'off' | 'explicit' | 'suggest';

export interface MemoryConfig {
  enabled: boolean;
  longTermEnabled: boolean;
  autoSaveMode: MemoryAutoSaveMode;
  maxContextTokens: number;
  maxLongTermItems: number;
}

export interface BuildMemoryContextRequest {
  query: string;
  sessionId?: string;
  taskId?: string;
  projectPath?: string;
  channelId?: string;
  scheduledTaskId?: string;
  maxTokens?: number;
  maxLongTermItems?: number;
  includeShortTerm?: boolean;
  includeLongTerm?: boolean;
}

export interface BuiltMemoryContext {
  prompt: string;
  memories: AgentMemory[];
  shortTerm: ShortTermMemory | null;
  estimatedTokens: number;
}

export interface ExtractMemoryRequest {
  userMessage: string;
  assistantText?: string;
  sessionId?: string;
  taskId?: string;
  projectPath?: string;
  origin?: MemorySource['origin'];
  autoSaveMode?: MemoryAutoSaveMode;
}

export interface RememberFromConversationRequest extends ExtractMemoryRequest {
  memoryConfig?: MemoryConfig;
}

export interface MemoryStoreState {
  memories: AgentMemory[];
  shortTerm: ShortTermMemory[];
}
