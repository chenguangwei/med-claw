import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalChannelSessionIds,
  createChannelTaskSnapshot,
  syncChannelSessionsToLocalDb,
} from '../../src/shared/lib/channel-session-sync.ts';

test('buildLocalChannelSessionIds creates stable local task ids', () => {
  const first = buildLocalChannelSessionIds({
    channel: 'weixin',
    conversationId: 'wx-user-1@example.com',
  });
  const second = buildLocalChannelSessionIds({
    channel: 'weixin',
    conversationId: 'wx-user-1@example.com',
  });

  assert.deepEqual(first, second);
  assert.match(first.sessionId, /^channel-weixin-/);
  assert.equal(first.taskId, `${first.sessionId}-task`);
});

test('createChannelTaskSnapshot maps channel history to local messages', () => {
  const snapshot = createChannelTaskSnapshot({
    id: 'channel-weixin-runtime',
    channel: 'weixin',
    conversationId: 'wx-user-1',
    history: [
      { role: 'user', content: '你好', at: '2026-06-01T09:00:00.000Z' },
      { role: 'assistant', content: '您好', at: '2026-06-01T09:00:01.000Z' },
    ],
    lastActiveAt: '2026-06-01T09:00:01.000Z',
    status: 'idle',
  });

  assert.equal(snapshot.sessionInput.prompt, '微信会话：wx-user-1');
  assert.equal(snapshot.taskInput.prompt, '微信：你好');
  assert.equal(snapshot.taskStatus, 'completed');
  assert.deepEqual(
    snapshot.messages.map((message) => ({
      type: message.type,
      content: message.content,
      created_at: message.created_at,
    })),
    [
      {
        type: 'user',
        content: '你好',
        created_at: '2026-06-01T09:00:00.000Z',
      },
      {
        type: 'text',
        content: '您好',
        created_at: '2026-06-01T09:00:01.000Z',
      },
    ]
  );
});

test('createChannelTaskSnapshot preserves channel errors as local error messages', () => {
  const snapshot = createChannelTaskSnapshot({
    id: 'channel-weixin-runtime',
    channel: 'weixin',
    conversationId: 'wx-user-2',
    history: [
      { role: 'user', content: '在吗', at: '2026-06-01T09:00:00.000Z' },
    ],
    lastActiveAt: '2026-06-01T09:00:02.000Z',
    status: 'error',
    lastError: '模型配置缺失',
  });

  assert.equal(snapshot.taskStatus, 'error');
  assert.equal(snapshot.messages.at(-1)?.type, 'error');
  assert.equal(snapshot.messages.at(-1)?.error_message, '模型配置缺失');
});

test('syncChannelSessionsToLocalDb serializes concurrent local rebuilds', async () => {
  const channelSession = {
    id: 'channel-weixin-runtime',
    channel: 'weixin' as const,
    conversationId: 'wx-user-race',
    history: [
      {
        role: 'user' as const,
        content: '小额伤残赔付的规则库需要从那里获取',
        at: '2026-06-01T09:00:00.000Z',
      },
      {
        role: 'assistant' as const,
        content: '可以从规则库配置入口获取。',
        at: '2026-06-01T09:00:01.000Z',
      },
    ],
    lastActiveAt: '2026-06-01T09:00:01.000Z',
    status: 'idle' as const,
  };
  const { taskId } = buildLocalChannelSessionIds(channelSession);
  const storedMessages: Array<{ task_id: string; type: string; content?: string }> =
    [];
  let deleteCalls = 0;

  const store = {
    async createMessage(input: { task_id: string; type: string; content?: string }) {
      storedMessages.push({
        task_id: input.task_id,
        type: input.type,
        content: input.content,
      });
    },
    async createSession() {},
    async createTask() {},
    async deleteMessagesByTaskId(id: string) {
      assert.equal(id, taskId);
      deleteCalls += 1;
      storedMessages.length = 0;
      if (deleteCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async getSession() {
      return {
        id: 'channel-weixin-conversation',
        prompt: '微信会话：wx-user-race',
        task_count: 1,
        created_at: '2026-06-01T09:00:00.000Z',
        updated_at: '2026-06-01T09:00:00.000Z',
      };
    },
    async getTask() {
      return {
        id: taskId,
        session_id: 'channel-weixin-conversation',
        task_index: 1,
        prompt: '微信：小额伤残赔付的规则库需要从那里获取',
        status: 'completed' as const,
        cost: null,
        duration: null,
        created_at: '2026-06-01T09:00:00.000Z',
        updated_at: '2026-06-01T09:00:00.000Z',
      };
    },
    async updateTask() {},
  };

  await Promise.all([
    syncChannelSessionsToLocalDb([channelSession], store),
    syncChannelSessionsToLocalDb([channelSession], store),
  ]);

  assert.equal(deleteCalls, 2);
  assert.deepEqual(
    storedMessages.map((message) => ({
      type: message.type,
      content: message.content,
    })),
    [
      {
        type: 'user',
        content: '小额伤残赔付的规则库需要从那里获取',
      },
      {
        type: 'text',
        content: '可以从规则库配置入口获取。',
      },
    ]
  );
});
