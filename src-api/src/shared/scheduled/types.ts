export type ScheduledTaskStatus = 'enabled' | 'paused';

export type ScheduledTaskRunStatus = 'queued' | 'running' | 'success' | 'failed';

export type ScheduledTaskSchedule =
  | {
      type: 'daily';
      time: string;
    }
  | {
      type: 'weekly';
      time: string;
      daysOfWeek: number[];
    }
  | {
      type: 'interval';
      intervalMinutes: number;
    };

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  status: ScheduledTaskStatus;
  schedule: ScheduledTaskSchedule;
  skillNames: string[];
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  status: ScheduledTaskRunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  messages: Array<{
    type: string;
    sessionId?: string;
    id?: string;
    name?: string;
    input?: unknown;
    message?: string;
    content?: string;
    toolUseId?: string;
    output?: string;
    isError?: boolean;
    subtype?: string;
    result?: string;
    stopReason?: string | null;
    numTurns?: number;
    errors?: string[];
    cost?: number;
    duration?: number;
  }>;
}

export interface ScheduledTaskExecutionConfig {
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    apiType?: 'anthropic-messages' | 'openai-completions';
  };
  sandboxConfig?: {
    enabled: boolean;
    provider?: string;
    apiEndpoint?: string;
  };
  skillsConfig?: {
    enabled: boolean;
    userDirEnabled: boolean;
    appDirEnabled: boolean;
    skillsPath?: string;
  };
  mcpConfig?: {
    enabled: boolean;
    userDirEnabled: boolean;
    appDirEnabled: boolean;
    mcpConfigPath?: string;
  };
  workDir?: string;
  language?: string;
}

export interface CreateScheduledTaskInput {
  name: string;
  prompt: string;
  status?: ScheduledTaskStatus;
  schedule: ScheduledTaskSchedule;
  skillNames?: string[];
}

export interface UpdateScheduledTaskInput {
  name?: string;
  prompt?: string;
  status?: ScheduledTaskStatus;
  schedule?: ScheduledTaskSchedule;
  skillNames?: string[];
}
