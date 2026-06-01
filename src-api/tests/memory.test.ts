import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  buildMemoryContext,
  extractMemoryCandidates,
  rememberFromConversation,
  upsertShortTermMemory,
} from '../src/shared/memory/service.js';
import {
  createMemory,
  deleteMemory,
  getMemoryStoreSnapshot,
  listMemories,
  replaceMemoryStoreSnapshot,
  updateMemory,
} from '../src/shared/memory/store.js';

async function withMemoryStore(
  fn: (storeFile: string) => Promise<void>
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-memory-'));
  const storeFile = path.join(tempDir, 'memory.json');
  const previousStoreFile = process.env.UNIINS_CLAW_MEMORY_STORE_FILE;
  process.env.UNIINS_CLAW_MEMORY_STORE_FILE = storeFile;

  try {
    await fn(storeFile);
  } finally {
    if (previousStoreFile === undefined) {
      delete process.env.UNIINS_CLAW_MEMORY_STORE_FILE;
    } else {
      process.env.UNIINS_CLAW_MEMORY_STORE_FILE = previousStoreFile;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('extractMemoryCandidates only promotes explicit durable memory requests', () => {
  const explicit = extractMemoryCandidates({
    userMessage: '请记住：以后默认用中文回答，并且不要自动推送代码。',
    assistantText: '好的，我会记住。',
    sessionId: 'session-1',
    taskId: 'task-1',
  });

  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].kind, 'preference');
  assert.equal(explicit[0].status, 'active');
  assert.match(explicit[0].content, /默认用中文回答/);

  const ordinary = extractMemoryCandidates({
    userMessage: '帮我解释一下这个函数。',
    assistantText: '这个函数会读取文件。',
    sessionId: 'session-1',
    taskId: 'task-2',
  });

  assert.equal(ordinary.length, 0);
});

test('rememberFromConversation persists explicit long-term memory with source metadata', async () => {
  await withMemoryStore(async () => {
    const saved = await rememberFromConversation({
      userMessage:
        'Remember: I prefer surgical changes and no speculative refactors.',
      assistantText: 'Understood.',
      sessionId: 'session-a',
      taskId: 'task-a',
      memoryConfig: {
        enabled: true,
        longTermEnabled: true,
        autoSaveMode: 'explicit',
        maxContextTokens: 600,
        maxLongTermItems: 5,
      },
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].source.sessionId, 'session-a');
    assert.equal(saved[0].source.taskId, 'task-a');

    const memories = await listMemories({ status: 'active' });
    assert.equal(memories.length, 1);
    assert.match(memories[0].content, /surgical changes/);
  });
});

test('buildMemoryContext combines short-term and relevant long-term memory within budget', async () => {
  await withMemoryStore(async () => {
    await createMemory({
      kind: 'preference',
      content: 'User prefers concise Chinese final answers.',
      tags: ['language', 'answer-style'],
      scope: { type: 'global' },
      confidence: 0.95,
      importance: 0.9,
      status: 'active',
      source: { origin: 'manual' },
    });
    await createMemory({
      kind: 'workflow',
      content:
        'For frontend changes, run browser QA after starting the dev server.',
      tags: ['frontend', 'qa'],
      scope: { type: 'project', id: '/repo/app' },
      confidence: 0.8,
      importance: 0.7,
      status: 'active',
      source: { origin: 'manual' },
    });
    await upsertShortTermMemory({
      sessionId: 'session-ctx',
      summary: 'Current session is implementing the Agent memory system.',
      activeGoal: 'Wire memory context into agent requests.',
      openQuestions: ['Whether vector search is needed now'],
      files: ['src-api/src/shared/memory/service.ts'],
      sourceTaskId: 'task-ctx',
    });

    const context = await buildMemoryContext({
      query: '继续实现 memory context frontend QA',
      sessionId: 'session-ctx',
      projectPath: '/repo/app',
      maxTokens: 120,
      maxLongTermItems: 3,
    });

    assert.match(context.prompt, /Agent Memory/);
    assert.match(context.prompt, /implementing the Agent memory system/);
    assert.match(context.prompt, /concise Chinese/);
    assert.match(context.prompt, /browser QA/);
    assert.ok(context.estimatedTokens <= 120);
  });
});

test('inactive or deleted memories are not included in memory context', async () => {
  await withMemoryStore(async () => {
    const active = await createMemory({
      kind: 'fact',
      content: 'Project uses Hono for backend APIs.',
      tags: ['backend'],
      scope: { type: 'global' },
      confidence: 0.9,
      importance: 0.6,
      status: 'active',
      source: { origin: 'manual' },
    });
    const archived = await createMemory({
      kind: 'fact',
      content: 'This archived memory must not be recalled.',
      tags: ['backend'],
      scope: { type: 'global' },
      confidence: 0.9,
      importance: 1,
      status: 'active',
      source: { origin: 'manual' },
    });

    await updateMemory(archived.id, { status: 'archived' });
    await deleteMemory(active.id);

    const context = await buildMemoryContext({
      query: 'backend API',
      sessionId: 'session-clean',
      maxTokens: 300,
    });

    assert.equal(context.memories.length, 0);
    assert.equal(context.prompt, '');
  });
});

test('memory snapshots round-trip and reject invalid enum values', async () => {
  await withMemoryStore(async () => {
    await createMemory({
      kind: 'decision',
      content: 'Use the local JSON memory store for the first release.',
      tags: ['memory'],
      scope: { type: 'project', id: '/repo/app' },
      confidence: 0.9,
      importance: 0.8,
      status: 'active',
      source: { origin: 'manual' },
    });

    const snapshot = await getMemoryStoreSnapshot();
    assert.equal(snapshot.memories.length, 1);

    await replaceMemoryStoreSnapshot({ memories: [], shortTerm: [] });
    assert.equal((await listMemories()).length, 0);

    await replaceMemoryStoreSnapshot(snapshot);
    assert.equal((await listMemories()).length, 1);

    await assert.rejects(
      () =>
        replaceMemoryStoreSnapshot({
          memories: [
            {
              ...snapshot.memories[0],
              kind: 'invalid-kind',
            },
          ],
          shortTerm: [],
        }),
      /kind is invalid/
    );
  });
});
