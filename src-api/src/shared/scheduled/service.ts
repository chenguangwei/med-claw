import type { AgentMessage } from '@/core/agent';
import { createSession, runAgent } from '@/shared/services/agent';
import { createLogger } from '@/shared/utils/logger';

import {
  createScheduledTaskRun,
  finishScheduledTaskRun,
  getScheduledTask,
  listDueScheduledTasks,
} from './store.js';
import type {
  ScheduledTask,
  ScheduledTaskExecutionConfig,
  ScheduledTaskRun,
} from './types.js';

const logger = createLogger('ScheduledTasks');
const runningTaskIds = new Set<string>();
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function summarizeMessage(message: AgentMessage): string | null {
  if (message.type === 'result' || message.type === 'done') {
    return null;
  }
  if ('message' in message && typeof message.message === 'string') {
    return normalizeAgentErrorMessage(message.message);
  }
  if ('content' in message && typeof message.content === 'string') {
    return message.content;
  }
  if ('output' in message && typeof message.output === 'string') {
    return message.output;
  }
  return null;
}

interface ScheduledAgentRunDraft {
  messages: ScheduledTaskRun['messages'];
  summary: string | null;
  status: ScheduledTaskRun['status'];
  errorMessage: string | null;
}

function describeResultError(subtype: string | undefined): string {
  if (subtype === 'error_max_turns') {
    return 'Agent 执行达到最大轮次限制';
  }
  if (subtype === 'error') {
    return 'Agent 执行异常：SDK 只返回了 error 状态，未提供具体错误文本。请检查模型配置、网络连接或 API 服务日志。';
  }
  return subtype
    ? `Agent 返回错误状态：${subtype}`
    : 'Agent 执行失败，未返回可用结果';
}

function normalizeAgentErrorMessage(message: string): string {
  if (message === '__API_KEY_ERROR__') {
    return '模型配置缺少或使用了无效的 API Key';
  }
  if (message.startsWith('__CUSTOM_API_ERROR__|')) {
    const [, baseUrl] = message.split('|');
    return `自定义模型接口不可用或模型不兼容：${baseUrl || '未配置接口地址'}`;
  }
  if (message.startsWith('__INTERNAL_ERROR__|')) {
    const [, logPath] = message.split('|');
    return logPath
      ? `Agent 内部执行异常，日志位置：${logPath}`
      : 'Agent 内部执行异常';
  }
  return message;
}

function copyMessageField(
  source: AgentMessage,
  target: ScheduledTaskRun['messages'][number],
  field: keyof ScheduledTaskRun['messages'][number]
): void {
  const value = (source as unknown as Record<string, unknown>)[field];
  if (value !== undefined) {
    (target as Record<string, unknown>)[field] = value;
  }
}

export function applyScheduledAgentMessage(
  draft: ScheduledAgentRunDraft,
  message: AgentMessage
): void {
  const text = summarizeMessage(message);
  if (text) draft.summary = text;

  const storedMessage: ScheduledTaskRun['messages'][number] = {
    type: message.type,
  };
  copyMessageField(message, storedMessage, 'sessionId');
  copyMessageField(message, storedMessage, 'id');
  copyMessageField(message, storedMessage, 'name');
  copyMessageField(message, storedMessage, 'input');
  copyMessageField(message, storedMessage, 'message');
  copyMessageField(message, storedMessage, 'content');
  copyMessageField(message, storedMessage, 'toolUseId');
  copyMessageField(message, storedMessage, 'output');
  copyMessageField(message, storedMessage, 'isError');
  copyMessageField(message, storedMessage, 'subtype');
  copyMessageField(message, storedMessage, 'result');
  copyMessageField(message, storedMessage, 'stopReason');
  copyMessageField(message, storedMessage, 'numTurns');
  copyMessageField(message, storedMessage, 'errors');
  copyMessageField(message, storedMessage, 'cost');
  copyMessageField(message, storedMessage, 'duration');

  if (storedMessage.message) {
    storedMessage.message = normalizeAgentErrorMessage(storedMessage.message);
  }
  draft.messages.push(storedMessage);

  if (message.type === 'error') {
    draft.status = 'failed';
    draft.errorMessage = text || 'Scheduled task execution failed';
  }

  if (message.type === 'result') {
    const subtype = message.subtype || message.content;
    if (subtype && subtype !== 'success') {
      draft.status = 'failed';
      draft.errorMessage =
        draft.errorMessage || draft.summary || describeResultError(subtype);
    }
  }
}

function buildPrompt(task: ScheduledTask): string {
  if (task.skillNames.length === 0) return task.prompt;
  return [
    task.prompt,
    '',
    `可引用的已安装 Skills: ${task.skillNames.join(', ')}。`,
    '仅在这些 Skills 与任务相关时使用它们。',
  ].join('\n');
}

async function executeTaskRun(
  task: ScheduledTask,
  run: ScheduledTaskRun,
  config: ScheduledTaskExecutionConfig = {}
): Promise<ScheduledTaskRun> {
  const draft: ScheduledAgentRunDraft = {
    messages: [],
    summary: null,
    status: 'success',
    errorMessage: null,
  };

  try {
    const session = createSession();
    const skillsConfig = config.skillsConfig ?? {
      enabled: true,
      userDirEnabled: true,
      appDirEnabled: true,
    };
    const scopedSkillsConfig =
      task.skillNames.length > 0
        ? { ...skillsConfig, includeSkills: task.skillNames }
        : skillsConfig;

    for await (const message of runAgent(
      buildPrompt(task),
      session,
      undefined,
      config.workDir,
      `scheduled-${task.id}-${run.id}`,
      config.modelConfig,
      config.sandboxConfig,
      undefined,
      scopedSkillsConfig,
      config.mcpConfig,
      config.language || 'zh'
    )) {
      applyScheduledAgentMessage(draft, message);
    }
  } catch (error) {
    draft.status = 'failed';
    draft.errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[ScheduledTasks] Run failed: ${task.id}`, error);
  } finally {
    runningTaskIds.delete(task.id);
  }

  await finishScheduledTaskRun(task.id, run.id, {
    status: draft.status,
    summary: draft.summary,
    error: draft.errorMessage,
    messages: draft.messages.slice(-60),
  });

  return {
    ...run,
    status: draft.status,
    summary: draft.summary,
    error: draft.errorMessage,
    messages: draft.messages.slice(-60),
    finishedAt: new Date().toISOString(),
  };
}

async function queueTaskRun(
  task: ScheduledTask,
  config: ScheduledTaskExecutionConfig = {}
): Promise<ScheduledTaskRun> {
  if (runningTaskIds.has(task.id)) {
    throw new Error('Task is already running');
  }

  runningTaskIds.add(task.id);
  const run = await createScheduledTaskRun(task.id);
  void executeTaskRun(task, run, config).catch((error) => {
    logger.error(`[ScheduledTasks] Queued run failed: ${task.id}`, error);
  });
  return run;
}

export async function runScheduledTaskNow(
  taskId: string,
  config: ScheduledTaskExecutionConfig = {}
): Promise<ScheduledTaskRun> {
  const task = await getScheduledTask(taskId);
  if (!task) throw new Error('Scheduled task not found');
  return queueTaskRun(task, config);
}

async function tickScheduledTasks(): Promise<void> {
  const dueTasks = await listDueScheduledTasks();
  for (const task of dueTasks) {
    if (runningTaskIds.has(task.id)) continue;
    void queueTaskRun(task).catch((error) => {
      logger.error(`[ScheduledTasks] Background run failed: ${task.id}`, error);
    });
  }
}

export function startScheduledTaskRunner(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void tickScheduledTasks().catch((error) => {
      logger.error('[ScheduledTasks] Tick failed', error);
    });
  }, 30_000);
  schedulerTimer.unref?.();
  void tickScheduledTasks();
}

export function stopScheduledTaskRunner(): void {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}
