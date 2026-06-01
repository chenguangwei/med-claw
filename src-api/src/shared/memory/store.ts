import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nanoid } from 'nanoid';

import { getAppDataDir } from '@/shared/utils/paths';

import type {
  AgentMemory,
  CreateMemoryInput,
  ListMemoryFilter,
  MemoryKind,
  MemoryScope,
  MemoryScopeType,
  MemorySource,
  MemoryStatus,
  MemoryStoreState,
  ShortTermMemory,
  UpdateMemoryInput,
  UpsertShortTermMemoryInput,
} from './types.js';

const DEFAULT_STORE_FILE = path.join(getAppDataDir(), 'memory', 'memory.json');
const MEMORY_KINDS = new Set<MemoryKind>([
  'preference',
  'decision',
  'fact',
  'workflow',
  'constraint',
]);
const MEMORY_STATUSES = new Set<MemoryStatus>([
  'active',
  'pending',
  'archived',
]);
const MEMORY_SCOPE_TYPES = new Set<MemoryScopeType>([
  'global',
  'project',
  'session',
  'channel',
  'scheduled',
]);
const MEMORY_SOURCE_ORIGINS = new Set<NonNullable<MemorySource['origin']>>([
  'manual',
  'chat',
  'agent',
  'channel',
  'scheduled',
]);

function emptyState(): MemoryStoreState {
  return {
    memories: [],
    shortTerm: [],
  };
}

function getStoreFile(): string {
  return process.env.UNIINS_CLAW_MEMORY_STORE_FILE || DEFAULT_STORE_FILE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeKind(kind: unknown): MemoryKind {
  if (typeof kind !== 'string' || !MEMORY_KINDS.has(kind as MemoryKind)) {
    throw new Error('kind is invalid');
  }
  return kind as MemoryKind;
}

function normalizeStatus(
  status: unknown,
  fallback: MemoryStatus
): MemoryStatus {
  if (status === undefined) return fallback;
  if (
    typeof status !== 'string' ||
    !MEMORY_STATUSES.has(status as MemoryStatus)
  ) {
    throw new Error('status is invalid');
  }
  return status as MemoryStatus;
}

function normalizeScope(scope?: MemoryScope): MemoryScope {
  if (!scope) return { type: 'global' };
  if (!MEMORY_SCOPE_TYPES.has(scope.type)) {
    throw new Error('scope.type is invalid');
  }
  if (scope.type === 'global') return { type: 'global' };
  const id = scope.id?.trim();
  if (!id) {
    throw new Error('scope.id is required for scoped memories');
  }
  return {
    type: scope.type,
    id,
  };
}

function normalizeSource(source?: MemorySource): MemorySource {
  const origin = source?.origin || 'manual';
  if (!MEMORY_SOURCE_ORIGINS.has(origin)) {
    throw new Error('source.origin is invalid');
  }
  return {
    origin,
    sessionId: source?.sessionId,
    taskId: source?.taskId,
    messageId: source?.messageId,
  };
}

function clamp01(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ');
}

function normalizeOptionalDate(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizeDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function normalizeUseCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function memoryKey(
  input: Pick<AgentMemory, 'content' | 'kind' | 'scope'>
): string {
  return [
    input.kind,
    input.scope.type,
    input.scope.id || '',
    normalizeContent(input.content).toLowerCase(),
  ].join('|');
}

async function readState(): Promise<MemoryStoreState> {
  try {
    const raw = await fs.readFile(getStoreFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<MemoryStoreState>;
    return {
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      shortTerm: Array.isArray(parsed.shortTerm) ? parsed.shortTerm : [],
    };
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(state: MemoryStoreState): Promise<void> {
  const storeFile = getStoreFile();
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function matchesFilter(memory: AgentMemory, filter: ListMemoryFilter): boolean {
  if (filter.status && memory.status !== filter.status) return false;
  if (filter.kind && memory.kind !== filter.kind) return false;
  if (filter.scopeType && memory.scope.type !== filter.scopeType) return false;
  if (filter.scopeId && memory.scope.id !== filter.scopeId) return false;
  if (filter.query) {
    const needle = filter.query.toLowerCase();
    const haystack = [memory.content, ...memory.tags].join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export async function listMemories(
  filter: ListMemoryFilter = {}
): Promise<AgentMemory[]> {
  const state = await readState();
  return state.memories
    .filter((memory) => matchesFilter(memory, filter))
    .sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

export async function getMemory(id: string): Promise<AgentMemory | null> {
  const state = await readState();
  return state.memories.find((memory) => memory.id === id) || null;
}

export async function createMemory(
  input: CreateMemoryInput
): Promise<AgentMemory> {
  const content = normalizeContent(input.content);
  if (!content) throw new Error('content is required');

  const state = await readState();
  const now = new Date().toISOString();
  const scope = normalizeScope(input.scope);
  const next: AgentMemory = {
    id: nanoid(),
    kind: normalizeKind(input.kind),
    content,
    tags: normalizeTags(input.tags),
    scope,
    confidence: clamp01(input.confidence, 0.7),
    importance: clamp01(input.importance, 0.5),
    status: normalizeStatus(input.status, 'active'),
    source: normalizeSource(input.source),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
  };

  const existingIndex = state.memories.findIndex(
    (memory) => memoryKey(memory) === memoryKey(next)
  );
  if (existingIndex !== -1) {
    const existing = state.memories[existingIndex];
    const updated: AgentMemory = {
      ...existing,
      confidence: Math.max(existing.confidence, next.confidence),
      importance: Math.max(existing.importance, next.importance),
      status: next.status === 'active' ? 'active' : existing.status,
      source: {
        ...existing.source,
        ...next.source,
      },
      updatedAt: now,
    };
    state.memories[existingIndex] = updated;
    await writeState(state);
    return updated;
  }

  state.memories.push(next);
  await writeState(state);
  return next;
}

export async function updateMemory(
  id: string,
  input: UpdateMemoryInput
): Promise<AgentMemory | null> {
  const state = await readState();
  const index = state.memories.findIndex((memory) => memory.id === id);
  if (index === -1) return null;

  const current = state.memories[index];
  const updated: AgentMemory = {
    ...current,
    ...input,
    kind: input.kind !== undefined ? normalizeKind(input.kind) : current.kind,
    content:
      input.content !== undefined
        ? normalizeContent(input.content)
        : current.content,
    tags: input.tags !== undefined ? normalizeTags(input.tags) : current.tags,
    scope:
      input.scope !== undefined ? normalizeScope(input.scope) : current.scope,
    source:
      input.source !== undefined
        ? normalizeSource(input.source)
        : current.source,
    confidence:
      input.confidence !== undefined
        ? clamp01(input.confidence, current.confidence)
        : current.confidence,
    importance:
      input.importance !== undefined
        ? clamp01(input.importance, current.importance)
        : current.importance,
    status:
      input.status !== undefined
        ? normalizeStatus(input.status, current.status)
        : current.status,
    updatedAt: new Date().toISOString(),
  };

  if (!updated.content) throw new Error('content is required');
  state.memories[index] = updated;
  await writeState(state);
  return updated;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const state = await readState();
  const nextMemories = state.memories.filter((memory) => memory.id !== id);
  if (nextMemories.length === state.memories.length) return false;
  state.memories = nextMemories;
  await writeState(state);
  return true;
}

function normalizeMemorySnapshotItem(input: unknown): AgentMemory {
  if (!isRecord(input)) {
    throw new Error('memory item must be an object');
  }
  if (typeof input.content !== 'string') {
    throw new Error('memory.content is required');
  }

  const now = new Date().toISOString();
  const content = normalizeContent(input.content);
  if (!content) throw new Error('memory.content is required');

  return {
    id: typeof input.id === 'string' && input.id ? input.id : nanoid(),
    kind: normalizeKind(input.kind),
    content,
    tags: normalizeStringArray(input.tags, 'memory.tags'),
    scope: normalizeScope(input.scope as MemoryScope | undefined),
    confidence: clamp01(input.confidence as number | undefined, 0.7),
    importance: clamp01(input.importance as number | undefined, 0.5),
    status: normalizeStatus(input.status, 'active'),
    source: normalizeSource(input.source as MemorySource | undefined),
    createdAt: normalizeDate(input.createdAt, now),
    updatedAt: normalizeDate(input.updatedAt, now),
    lastUsedAt: normalizeOptionalDate(input.lastUsedAt),
    useCount: normalizeUseCount(input.useCount),
  };
}

function normalizeShortTermSnapshotItem(input: unknown): ShortTermMemory {
  if (!isRecord(input)) {
    throw new Error('short-term memory item must be an object');
  }
  if (typeof input.sessionId !== 'string' || !input.sessionId.trim()) {
    throw new Error('short-term memory sessionId is required');
  }
  if (typeof input.summary !== 'string') {
    throw new Error('short-term memory summary is required');
  }

  const now = new Date().toISOString();
  return {
    sessionId: input.sessionId.trim(),
    summary: normalizeContent(input.summary),
    activeGoal:
      typeof input.activeGoal === 'string' && input.activeGoal.trim()
        ? normalizeContent(input.activeGoal)
        : undefined,
    openQuestions: normalizeStringArray(
      input.openQuestions,
      'shortTerm.openQuestions'
    ),
    files: normalizeStringArray(input.files, 'shortTerm.files'),
    sourceTaskId:
      typeof input.sourceTaskId === 'string' && input.sourceTaskId.trim()
        ? input.sourceTaskId.trim()
        : undefined,
    createdAt: normalizeDate(input.createdAt, now),
    updatedAt: normalizeDate(input.updatedAt, now),
  };
}

function normalizeStoreState(input: unknown): MemoryStoreState {
  if (!isRecord(input)) {
    throw new Error('memory snapshot must be an object');
  }
  if (!Array.isArray(input.memories)) {
    throw new Error('memory snapshot memories must be an array');
  }
  if (!Array.isArray(input.shortTerm)) {
    throw new Error('memory snapshot shortTerm must be an array');
  }

  return {
    memories: input.memories.map(normalizeMemorySnapshotItem),
    shortTerm: input.shortTerm.map(normalizeShortTermSnapshotItem),
  };
}

export async function getMemoryStoreSnapshot(): Promise<MemoryStoreState> {
  const state = await readState();
  return {
    memories: state.memories.map((memory) => ({ ...memory })),
    shortTerm: state.shortTerm.map((memory) => ({ ...memory })),
  };
}

export async function replaceMemoryStoreSnapshot(
  input: unknown
): Promise<MemoryStoreState> {
  const state = normalizeStoreState(input);
  await writeState(state);
  return state;
}

export async function clearMemoryStore(): Promise<void> {
  await writeState(emptyState());
}

export async function clearShortTermMemoryStore(): Promise<void> {
  const state = await readState();
  state.shortTerm = [];
  await writeState(state);
}

export async function markMemoriesUsed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const state = await readState();
  const now = new Date().toISOString();
  let changed = false;

  state.memories = state.memories.map((memory) => {
    if (!idSet.has(memory.id)) return memory;
    changed = true;
    return {
      ...memory,
      lastUsedAt: now,
      useCount: memory.useCount + 1,
      updatedAt: now,
    };
  });

  if (changed) {
    await writeState(state);
  }
}

export async function upsertShortTermMemory(
  input: UpsertShortTermMemoryInput
): Promise<ShortTermMemory> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) throw new Error('sessionId is required');

  const state = await readState();
  const now = new Date().toISOString();
  const index = state.shortTerm.findIndex(
    (memory) => memory.sessionId === sessionId
  );
  const current = index === -1 ? null : state.shortTerm[index];
  const next: ShortTermMemory = {
    sessionId,
    summary: normalizeContent(input.summary),
    activeGoal: input.activeGoal?.trim() || current?.activeGoal,
    openQuestions: normalizeTags(input.openQuestions || current?.openQuestions),
    files: normalizeTags(input.files || current?.files),
    sourceTaskId: input.sourceTaskId || current?.sourceTaskId,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };

  if (index === -1) {
    state.shortTerm.push(next);
  } else {
    state.shortTerm[index] = next;
  }

  await writeState(state);
  return next;
}

export async function getShortTermMemory(
  sessionId: string
): Promise<ShortTermMemory | null> {
  const state = await readState();
  return (
    state.shortTerm.find((memory) => memory.sessionId === sessionId) || null
  );
}

export async function deleteShortTermMemory(
  sessionId: string
): Promise<boolean> {
  const state = await readState();
  const nextShortTerm = state.shortTerm.filter(
    (memory) => memory.sessionId !== sessionId
  );
  if (nextShortTerm.length === state.shortTerm.length) return false;
  state.shortTerm = nextShortTerm;
  await writeState(state);
  return true;
}
