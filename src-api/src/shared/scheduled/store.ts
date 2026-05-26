import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { nanoid } from 'nanoid';

import { getAppDataDir } from '@/shared/utils/paths';

import { computeNextRunAt, normalizeSchedule } from './schedule.js';
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskRun,
  UpdateScheduledTaskInput,
} from './types.js';

interface ScheduledTaskState {
  tasks: ScheduledTask[];
  runs: ScheduledTaskRun[];
}

const DEFAULT_STORE_FILE = path.join(getAppDataDir(), 'scheduled-tasks.json');
const MAX_RUNS_PER_TASK = 100;

const emptyState = (): ScheduledTaskState => ({
  tasks: [],
  runs: [],
});

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function readState(): Promise<ScheduledTaskState> {
  try {
    const raw = await fs.readFile(getStoreFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ScheduledTaskState>;
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return emptyState();
    }
    throw error;
  }
}

async function writeState(state: ScheduledTaskState): Promise<void> {
  const storeFile = getStoreFile();
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getStoreFile(): string {
  return process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE || DEFAULT_STORE_FILE;
}

function sanitizeTaskInput(input: CreateScheduledTaskInput): CreateScheduledTaskInput {
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (!name) throw new Error('name is required');
  if (!prompt) throw new Error('prompt is required');
  return {
    name,
    prompt,
    status: input.status === 'paused' ? 'paused' : 'enabled',
    schedule: normalizeSchedule(input.schedule),
    skillNames: Array.isArray(input.skillNames)
      ? input.skillNames.map((skill) => skill.trim()).filter(Boolean)
      : [],
  };
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const state = await readState();
  return state.tasks.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  const state = await readState();
  return state.tasks.find((task) => task.id === id) || null;
}

export async function createScheduledTask(
  input: CreateScheduledTaskInput
): Promise<ScheduledTask> {
  const clean = sanitizeTaskInput(input);
  const now = new Date();
  const task: ScheduledTask = {
    id: nanoid(),
    name: clean.name,
    prompt: clean.prompt,
    status: clean.status || 'enabled',
    schedule: clean.schedule,
    skillNames: clean.skillNames || [],
    nextRunAt:
      clean.status === 'paused'
        ? null
        : computeNextRunAt(clean.schedule, now).toISOString(),
    lastRunAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const state = await readState();
  state.tasks.push(task);
  await writeState(state);
  return task;
}

export async function updateScheduledTask(
  id: string,
  input: UpdateScheduledTaskInput
): Promise<ScheduledTask | null> {
  const state = await readState();
  const index = state.tasks.findIndex((task) => task.id === id);
  if (index === -1) return null;

  const current = state.tasks[index];
  const nextSchedule = input.schedule
    ? normalizeSchedule(input.schedule)
    : current.schedule;
  const nextStatus = input.status || current.status;
  const updated: ScheduledTask = {
    ...current,
    name: input.name !== undefined ? input.name.trim() : current.name,
    prompt: input.prompt !== undefined ? input.prompt.trim() : current.prompt,
    status: nextStatus,
    schedule: nextSchedule,
    skillNames: Array.isArray(input.skillNames)
      ? input.skillNames.map((skill) => skill.trim()).filter(Boolean)
      : current.skillNames,
    nextRunAt:
      nextStatus === 'paused'
        ? null
        : computeNextRunAt(
            nextSchedule,
            new Date(),
            current.lastRunAt ? new Date(current.lastRunAt) : null
          ).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!updated.name) throw new Error('name is required');
  if (!updated.prompt) throw new Error('prompt is required');

  state.tasks[index] = updated;
  await writeState(state);
  return updated;
}

export async function deleteScheduledTask(id: string): Promise<boolean> {
  const state = await readState();
  const nextTasks = state.tasks.filter((task) => task.id !== id);
  if (nextTasks.length === state.tasks.length) return false;
  state.tasks = nextTasks;
  state.runs = state.runs.filter((run) => run.taskId !== id);
  await writeState(state);
  return true;
}

export async function listScheduledTaskRuns(
  taskId: string
): Promise<ScheduledTaskRun[]> {
  const state = await readState();
  return state.runs
    .filter((run) => run.taskId === taskId)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
}

export async function createScheduledTaskRun(
  taskId: string
): Promise<ScheduledTaskRun> {
  const run: ScheduledTaskRun = {
    id: nanoid(),
    taskId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
    error: null,
    messages: [],
  };
  const state = await readState();
  state.runs.push(run);
  await writeState(state);
  return run;
}

export async function finishScheduledTaskRun(
  taskId: string,
  runId: string,
  result: Pick<ScheduledTaskRun, 'status' | 'summary' | 'error' | 'messages'>
): Promise<void> {
  const state = await readState();
  const runIndex = state.runs.findIndex((run) => run.id === runId);
  if (runIndex !== -1) {
    state.runs[runIndex] = {
      ...state.runs[runIndex],
      ...result,
      finishedAt: new Date().toISOString(),
    };
  }

  const taskIndex = state.tasks.findIndex((task) => task.id === taskId);
  if (taskIndex !== -1) {
    const task = state.tasks[taskIndex];
    const now = new Date();
    state.tasks[taskIndex] = {
      ...task,
      lastRunAt: now.toISOString(),
      nextRunAt:
        task.status === 'enabled'
          ? computeNextRunAt(task.schedule, now, now).toISOString()
          : null,
      updatedAt: now.toISOString(),
    };
  }

  const keptRuns: ScheduledTaskRun[] = [];
  const runCounts = new Map<string, number>();
  for (const run of state.runs.sort((a, b) => {
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  })) {
    const count = runCounts.get(run.taskId) || 0;
    if (count < MAX_RUNS_PER_TASK) {
      keptRuns.push(run);
      runCounts.set(run.taskId, count + 1);
    }
  }
  state.runs = keptRuns;
  await writeState(state);
}

export async function listDueScheduledTasks(
  at = new Date()
): Promise<ScheduledTask[]> {
  const state = await readState();
  return state.tasks.filter((task) => {
    if (task.status !== 'enabled' || !task.nextRunAt) return false;
    return new Date(task.nextRunAt) <= at;
  });
}
