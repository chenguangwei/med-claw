import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalChannelSessionIds,
  createChannelTaskSnapshot,
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
