import {
  createMemory,
  getShortTermMemory,
  listMemories,
  markMemoriesUsed,
  upsertShortTermMemory,
} from './store.js';
import type {
  AgentMemory,
  BuildMemoryContextRequest,
  BuiltMemoryContext,
  CreateMemoryInput,
  ExtractMemoryRequest,
  MemoryAutoSaveMode,
  MemoryConfig,
  MemoryKind,
  MemoryScope,
  MemoryStatus,
  RememberFromConversationRequest,
  ShortTermMemory,
  UpsertShortTermMemoryInput,
} from './types.js';

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  longTermEnabled: true,
  autoSaveMode: 'explicit',
  maxContextTokens: 900,
  maxLongTermItems: 6,
};

const MEMORY_AUTO_SAVE_MODES = new Set<MemoryAutoSaveMode>([
  'off',
  'explicit',
  'suggest',
]);

const EXPLICIT_MEMORY_PATTERNS = [
  /(?:请)?记住[:：]?\s*([\s\S]+)/i,
  /以后(?:都|请|默认|不要|别)?[\s\S]*/i,
  /从现在开始[\s\S]*/i,
  /默认(?:用|使用|采用)?[\s\S]*/i,
  /不要再[\s\S]*/i,
  /别再[\s\S]*/i,
  /remember(?: that)?[:：]?\s*([\s\S]+)/i,
  /from now on[\s\S]*/i,
  /always[\s\S]*/i,
  /never[\s\S]*/i,
  /default to[\s\S]*/i,
  /i prefer[\s\S]*/i,
];

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'will',
  'your',
  'you',
  'are',
  'about',
  'into',
  '继续',
  '实现',
  '这个',
  '一个',
  '我们',
  '需要',
]);

function normalizeConfig(config?: Partial<MemoryConfig>): MemoryConfig {
  const autoSaveMode = MEMORY_AUTO_SAVE_MODES.has(
    config?.autoSaveMode as MemoryAutoSaveMode
  )
    ? (config?.autoSaveMode as MemoryAutoSaveMode)
    : DEFAULT_MEMORY_CONFIG.autoSaveMode;

  return {
    enabled: config?.enabled !== false,
    longTermEnabled: config?.longTermEnabled !== false,
    autoSaveMode,
    maxContextTokens:
      typeof config?.maxContextTokens === 'number'
        ? Math.max(0, Math.min(4000, config.maxContextTokens))
        : DEFAULT_MEMORY_CONFIG.maxContextTokens,
    maxLongTermItems:
      typeof config?.maxLongTermItems === 'number'
        ? Math.max(0, Math.min(20, config.maxLongTermItems))
        : DEFAULT_MEMORY_CONFIG.maxLongTermItems,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 5);
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function trimToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function inferKind(content: string): MemoryKind {
  const lower = content.toLowerCase();
  if (/prefer|喜欢|偏好|默认|always|以后|from now on/.test(lower)) {
    return 'preference';
  }
  if (/不要|别再|never|must not|don't|do not|constraint|限制/.test(lower)) {
    return 'constraint';
  }
  if (/决定|decision|approved|选择|采用/.test(lower)) {
    return 'decision';
  }
  if (/workflow|流程|步骤|run |执行|验证|test|qa/.test(lower)) {
    return 'workflow';
  }
  return 'fact';
}

function inferTags(content: string): string[] {
  return tokenize(content).slice(0, 8);
}

function explicitMemoryContent(userMessage: string): string | null {
  const text = normalizeText(userMessage);
  if (!text) return null;

  for (const pattern of EXPLICIT_MEMORY_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const captured = normalizeText(match[1] || match[0]);
    return captured.replace(/^[:：]\s*/, '');
  }

  return null;
}

function resolveScope(request: ExtractMemoryRequest): MemoryScope {
  if (request.projectPath) {
    return { type: 'project', id: request.projectPath };
  }
  return { type: 'global' };
}

function scoreMemory(
  memory: AgentMemory,
  queryTokens: Set<string>,
  request: BuildMemoryContextRequest
): number {
  let score = memory.importance * 2 + memory.confidence;

  const memoryTokens = new Set(
    tokenize([memory.content, ...memory.tags].join(' '))
  );
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) score += 1;
  }

  if (memory.scope.type === 'global') score += 0.15;
  if (
    memory.scope.type === 'project' &&
    memory.scope.id === request.projectPath
  ) {
    score += 1.5;
  }
  if (
    memory.scope.type === 'session' &&
    memory.scope.id === request.sessionId
  ) {
    score += 1.2;
  }
  if (
    memory.scope.type === 'channel' &&
    memory.scope.id === request.channelId
  ) {
    score += 1.2;
  }
  if (
    memory.scope.type === 'scheduled' &&
    memory.scope.id === request.scheduledTaskId
  ) {
    score += 1.2;
  }

  if (memory.lastUsedAt) {
    score += 0.1;
  }

  return score;
}

function scopeMatches(
  memory: AgentMemory,
  request: BuildMemoryContextRequest
): boolean {
  if (memory.scope.type === 'global') return true;
  if (memory.scope.type === 'project') {
    return !!request.projectPath && memory.scope.id === request.projectPath;
  }
  if (memory.scope.type === 'session') {
    return !!request.sessionId && memory.scope.id === request.sessionId;
  }
  if (memory.scope.type === 'channel') {
    return !!request.channelId && memory.scope.id === request.channelId;
  }
  if (memory.scope.type === 'scheduled') {
    return (
      !!request.scheduledTaskId && memory.scope.id === request.scheduledTaskId
    );
  }
  return false;
}

function formatShortTermMemory(shortTerm: ShortTermMemory): string[] {
  const lines = [`- Summary: ${shortTerm.summary}`];
  if (shortTerm.activeGoal) {
    lines.push(`- Active goal: ${shortTerm.activeGoal}`);
  }
  if (shortTerm.openQuestions.length > 0) {
    lines.push(`- Open questions: ${shortTerm.openQuestions.join('; ')}`);
  }
  if (shortTerm.files.length > 0) {
    lines.push(`- Relevant files: ${shortTerm.files.join(', ')}`);
  }
  return lines;
}

function memoryLine(memory: AgentMemory): string {
  const scope =
    memory.scope.type === 'global'
      ? 'global'
      : `${memory.scope.type}:${memory.scope.id || 'unknown'}`;
  return `- [${memory.kind}; ${scope}] ${memory.content}`;
}

export function extractMemoryCandidates(
  request: ExtractMemoryRequest
): CreateMemoryInput[] {
  const mode = request.autoSaveMode || 'explicit';
  if (mode === 'off') return [];

  const explicitContent = explicitMemoryContent(request.userMessage);
  if (!explicitContent) return [];

  const kind = inferKind(explicitContent);
  const status: MemoryStatus = mode === 'suggest' ? 'pending' : 'active';

  return [
    {
      kind,
      content: explicitContent,
      tags: inferTags(explicitContent),
      scope: resolveScope(request),
      confidence: 0.95,
      importance: kind === 'constraint' || kind === 'decision' ? 0.9 : 0.8,
      status,
      source: {
        origin: request.origin || 'chat',
        sessionId: request.sessionId,
        taskId: request.taskId,
      },
    },
  ];
}

export async function rememberFromConversation(
  request: RememberFromConversationRequest
): Promise<AgentMemory[]> {
  const config = normalizeConfig(request.memoryConfig);
  if (!config.enabled || !config.longTermEnabled) return [];

  const candidates = extractMemoryCandidates({
    ...request,
    autoSaveMode: config.autoSaveMode,
  });

  const saved: AgentMemory[] = [];
  for (const candidate of candidates) {
    saved.push(await createMemory(candidate));
  }
  return saved;
}

export async function updateShortTermFromConversation(input: {
  sessionId?: string;
  userMessage: string;
  assistantText?: string;
  taskId?: string;
  files?: string[];
  memoryConfig?: Partial<MemoryConfig>;
}): Promise<ShortTermMemory | null> {
  const config = normalizeConfig(input.memoryConfig);
  if (!config.enabled || !input.sessionId) return null;

  const previous = await getShortTermMemory(input.sessionId);
  const parts = [
    previous?.summary,
    `User: ${trimToChars(input.userMessage, 500)}`,
    input.assistantText
      ? `Assistant: ${trimToChars(input.assistantText, 700)}`
      : undefined,
  ].filter(Boolean);
  const summary = trimToChars(parts.join('\n'), 2600);

  const next: UpsertShortTermMemoryInput = {
    sessionId: input.sessionId,
    summary,
    activeGoal: trimToChars(input.userMessage, 220),
    files: input.files || previous?.files || [],
    openQuestions: previous?.openQuestions || [],
    sourceTaskId: input.taskId || previous?.sourceTaskId,
  };

  return upsertShortTermMemory(next);
}

export async function buildMemoryContext(
  request: BuildMemoryContextRequest,
  configInput?: Partial<MemoryConfig>
): Promise<BuiltMemoryContext> {
  const config = normalizeConfig(configInput);
  if (!config.enabled) {
    return { prompt: '', memories: [], shortTerm: null, estimatedTokens: 0 };
  }

  const maxTokens = Math.max(
    0,
    Math.min(
      request.maxTokens ?? config.maxContextTokens,
      config.maxContextTokens
    )
  );
  if (maxTokens === 0) {
    return { prompt: '', memories: [], shortTerm: null, estimatedTokens: 0 };
  }

  const sections: string[] = [];
  let estimatedTokens = 0;
  let shortTerm: ShortTermMemory | null = null;

  const header = [
    '## Agent Memory',
    'Helpful context only. Current files, tool output, and explicit user instructions override memory.',
  ].join('\n');
  sections.push(header);
  estimatedTokens += estimateTokens(header);

  if (request.includeShortTerm !== false && request.sessionId) {
    shortTerm = await getShortTermMemory(request.sessionId);
    if (shortTerm) {
      const shortLines = [
        '### Short-term Session Memory',
        ...formatShortTermMemory(shortTerm),
      ];
      const shortSection = shortLines.join('\n');
      const shortTokens = estimateTokens(shortSection);
      if (estimatedTokens + shortTokens <= maxTokens) {
        sections.push(shortSection);
        estimatedTokens += shortTokens;
      }
    }
  }

  let selectedMemories: AgentMemory[] = [];
  if (config.longTermEnabled && request.includeLongTerm !== false) {
    const queryTokens = new Set(tokenize(request.query));
    const candidates = (await listMemories({ status: 'active' }))
      .filter((memory) => scopeMatches(memory, request))
      .map((memory) => ({
        memory,
        score: scoreMemory(memory, queryTokens, request),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, request.maxLongTermItems ?? config.maxLongTermItems);

    const longLines: string[] = ['### Long-term Memory'];
    for (const candidate of candidates) {
      const line = memoryLine(candidate.memory);
      const nextSection = [...longLines, line].join('\n');
      const nextTokens = estimateTokens(nextSection);
      if (estimatedTokens + nextTokens > maxTokens) break;
      longLines.push(line);
      selectedMemories.push(candidate.memory);
    }

    if (longLines.length > 1) {
      const longSection = longLines.join('\n');
      sections.push(longSection);
      estimatedTokens += estimateTokens(longSection);
    }
  }

  if (sections.length === 1) {
    return { prompt: '', memories: [], shortTerm, estimatedTokens: 0 };
  }

  await markMemoriesUsed(selectedMemories.map((memory) => memory.id));

  return {
    prompt: `${sections.join('\n\n')}\n\n---`,
    memories: selectedMemories,
    shortTerm,
    estimatedTokens,
  };
}

export async function buildMemoryAugmentedPrompt(input: {
  prompt: string;
  sessionId?: string;
  taskId?: string;
  projectPath?: string;
  channelId?: string;
  scheduledTaskId?: string;
  memoryConfig?: Partial<MemoryConfig>;
}): Promise<{ prompt: string; context: BuiltMemoryContext }> {
  const context = await buildMemoryContext(
    {
      query: input.prompt,
      sessionId: input.sessionId,
      taskId: input.taskId,
      projectPath: input.projectPath,
      channelId: input.channelId,
      scheduledTaskId: input.scheduledTaskId,
      maxTokens: input.memoryConfig?.maxContextTokens,
      maxLongTermItems: input.memoryConfig?.maxLongTermItems,
    },
    input.memoryConfig
  );

  if (!context.prompt) {
    return { prompt: input.prompt, context };
  }

  return {
    prompt: `${context.prompt}\n\n${input.prompt}`,
    context,
  };
}

export function normalizeMemoryConfig(
  config?: Partial<MemoryConfig>
): MemoryConfig {
  return normalizeConfig(config);
}

export { upsertShortTermMemory };
