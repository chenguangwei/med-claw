import {
  createMessage,
  createSession,
  createTask,
  deleteMessagesByTaskId,
  getSession,
  getTask,
  updateTask,
} from '../db/database';
import type {
  CreateMessageInput,
  CreateSessionInput,
  CreateTaskInput,
  TaskStatus,
} from '../db/types';

export type ChannelId = 'feishu' | 'weixin' | 'dingtalk';

export interface ChannelSessionSnapshot {
  id: string;
  channel: ChannelId;
  conversationId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string; at: string }>;
  lastActiveAt: string;
  status: 'idle' | 'running' | 'error';
  lastError?: string;
}

export interface LocalChannelSessionIds {
  sessionId: string;
  taskId: string;
}

export interface LocalChannelTaskSnapshot {
  ids: LocalChannelSessionIds;
  sessionInput: CreateSessionInput;
  taskInput: CreateTaskInput;
  taskStatus: TaskStatus;
  messages: CreateMessageInput[];
}

const CHANNEL_LABELS: Record<ChannelId, string> = {
  feishu: '飞书',
  weixin: '微信',
  dingtalk: '钉钉',
};

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  return slug || 'conversation';
}

function channelTitle(channel: ChannelId, conversationId: string): string {
  return `${CHANNEL_LABELS[channel]}会话：${conversationId}`;
}

function taskPrompt(
  channel: ChannelId,
  conversationId: string,
  history: ChannelSessionSnapshot['history']
): string {
  const firstUserMessage = history.find((message) => message.role === 'user');
  const summary = firstUserMessage?.content.trim() || conversationId;
  return `${CHANNEL_LABELS[channel]}：${summary}`;
}

function mapChannelStatus(
  status: ChannelSessionSnapshot['status']
): TaskStatus {
  if (status === 'running') return 'running';
  if (status === 'error') return 'error';
  return 'completed';
}

export function buildLocalChannelSessionIds(input: {
  channel: ChannelId;
  conversationId: string;
}): LocalChannelSessionIds {
  const stableKey = `${input.channel}:${input.conversationId}`;
  const sessionId = [
    'channel',
    input.channel,
    slugify(input.conversationId),
    hashString(stableKey),
  ].join('-');

  return {
    sessionId,
    taskId: `${sessionId}-task`,
  };
}

export function createChannelTaskSnapshot(
  session: ChannelSessionSnapshot
): LocalChannelTaskSnapshot {
  const ids = buildLocalChannelSessionIds(session);
  const messages: CreateMessageInput[] = session.history.map((message) => ({
    task_id: ids.taskId,
    type: message.role === 'user' ? 'user' : 'text',
    content: message.content,
    created_at: message.at,
  }));

  if (session.status === 'error' && session.lastError) {
    messages.push({
      task_id: ids.taskId,
      type: 'error',
      error_message: session.lastError,
      created_at: session.lastActiveAt,
    });
  }

  return {
    ids,
    sessionInput: {
      id: ids.sessionId,
      prompt: channelTitle(session.channel, session.conversationId),
    },
    taskInput: {
      id: ids.taskId,
      session_id: ids.sessionId,
      task_index: 1,
      prompt: taskPrompt(
        session.channel,
        session.conversationId,
        session.history
      ),
    },
    taskStatus: mapChannelStatus(session.status),
    messages,
  };
}

export async function syncChannelSessionsToLocalDb(
  sessions: ChannelSessionSnapshot[]
): Promise<void> {
  for (const channelSession of sessions) {
    if (channelSession.history.length === 0) continue;

    const snapshot = createChannelTaskSnapshot(channelSession);
    const existingSession = await getSession(snapshot.ids.sessionId);
    if (!existingSession) {
      await createSession(snapshot.sessionInput);
    }

    const existingTask = await getTask(snapshot.ids.taskId);
    if (!existingTask) {
      await createTask(snapshot.taskInput);
    } else if (existingTask.prompt !== snapshot.taskInput.prompt) {
      await updateTask(snapshot.ids.taskId, {
        prompt: snapshot.taskInput.prompt,
      });
    }

    await deleteMessagesByTaskId(snapshot.ids.taskId);
    for (const message of snapshot.messages) {
      await createMessage(message);
    }
    await updateTask(snapshot.ids.taskId, { status: snapshot.taskStatus });
  }
}
