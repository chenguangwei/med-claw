import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { getWorkanySkillsDir } from '../src/config/constants.js';
import {
  createScheduledTask,
  createScheduledTaskRun,
  deleteScheduledTask,
  listScheduledTaskRuns,
  listScheduledTasks,
  updateScheduledTask,
} from '../src/shared/scheduled/store.js';
import {
  computeNextRunAt,
  normalizeSchedule,
} from '../src/shared/scheduled/schedule.js';
import { applyScheduledAgentMessage } from '../src/shared/scheduled/service.js';
import {
  createSkill,
  deleteSkill,
  readSkill,
  updateSkill,
} from '../src/shared/skills/manager.js';
import { validateHubSkills } from '../src/shared/skills/hub-validation.js';

function localStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

test('computeNextRunAt handles daily schedules after the current time', () => {
  const schedule = normalizeSchedule({
    type: 'daily',
    time: '10:00',
  });

  assert.equal(
    localStamp(computeNextRunAt(schedule, new Date(2026, 4, 26, 9, 0, 0))),
    '2026-05-26 10:00'
  );
  assert.equal(
    localStamp(computeNextRunAt(schedule, new Date(2026, 4, 26, 10, 0, 0))),
    '2026-05-27 10:00'
  );
});

test('computeNextRunAt handles weekly schedules with selected weekdays', () => {
  const schedule = normalizeSchedule({
    type: 'weekly',
    time: '08:30',
    daysOfWeek: [1, 3],
  });

  assert.equal(
    localStamp(computeNextRunAt(schedule, new Date(2026, 4, 26, 9, 0, 0))),
    '2026-05-27 08:30'
  );
});

test('computeNextRunAt handles interval schedules from last run time', () => {
  const schedule = normalizeSchedule({
    type: 'interval',
    intervalMinutes: 45,
  });

  assert.equal(
    computeNextRunAt(
      schedule,
      new Date('2026-05-26T09:00:00.000Z'),
      new Date('2026-05-26T08:30:00.000Z')
    ).toISOString(),
    '2026-05-26T09:15:00.000Z'
  );
});

test('validateHubSkills only keeps importable GitHub skill entries', () => {
  const result = validateHubSkills({
    skills: [
      {
        slug: 'pdf',
        name: 'PDF Skill',
        source_url: 'https://github.com/owner/repo/tree/main/skills/pdf',
      },
      {
        slug: 'bad',
        name: 'Bad Skill',
        source_url: 'https://example.com/not-github',
      },
      {
        slug: '',
        name: 'Missing Slug',
        source_url: 'https://github.com/owner/repo/tree/main/skills/missing',
      },
    ],
  });

  assert.equal(result.validSkills.length, 1);
  assert.equal(result.rejectedCount, 2);
  assert.equal(result.validSkills[0].name, 'PDF Skill');
  assert.equal(result.trustState, 'partial');
});

test('deleteScheduledTask removes persisted task and runs', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-scheduled-'));
  const storeFile = path.join(tempDir, 'scheduled-tasks.json');
  const previousStoreFile = process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE;
  process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE = storeFile;

  try {
    await fs.writeFile(storeFile, '{"tasks":[],"runs":[]}\n', 'utf8');

    const task = await createScheduledTask({
      name: 'Delete me',
      prompt: 'This task should be deleted',
      schedule: { type: 'interval', intervalMinutes: 30 },
    });
    await createScheduledTaskRun(task.id);

    assert.equal(await deleteScheduledTask(task.id), true);
    assert.equal(await deleteScheduledTask(task.id), false);
    assert.equal((await listScheduledTasks()).length, 0);
    assert.equal((await listScheduledTaskRuns(task.id)).length, 0);
  } finally {
    if (previousStoreFile === undefined) {
      delete process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE;
    } else {
      process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE = previousStoreFile;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('updateScheduledTask toggles enabled and paused scheduling state', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-scheduled-'));
  const storeFile = path.join(tempDir, 'scheduled-tasks.json');
  const previousStoreFile = process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE;
  process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE = storeFile;

  try {
    await fs.writeFile(storeFile, '{"tasks":[],"runs":[]}\n', 'utf8');

    const task = await createScheduledTask({
      name: 'Toggle me',
      prompt: 'This task should toggle',
      schedule: { type: 'interval', intervalMinutes: 30 },
    });

    const paused = await updateScheduledTask(task.id, { status: 'paused' });
    assert.equal(paused?.status, 'paused');
    assert.equal(paused?.nextRunAt, null);

    const enabled = await updateScheduledTask(task.id, { status: 'enabled' });
    assert.equal(enabled?.status, 'enabled');
    assert.ok(enabled?.nextRunAt);
  } finally {
    if (previousStoreFile === undefined) {
      delete process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE;
    } else {
      process.env.UNIINS_CLAW_SCHEDULED_STORE_FILE = previousStoreFile;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('scheduled agent records detailed messages for run inspection', () => {
  const draft = {
    messages: [],
    summary: null,
    status: 'success' as const,
    errorMessage: null,
  };

  applyScheduledAgentMessage(draft, {
    type: 'tool_result',
    toolUseId: 'tool-1',
    output: 'Generated report contents',
    isError: false,
  });

  assert.deepEqual(draft.messages, [
    {
      type: 'tool_result',
      toolUseId: 'tool-1',
      output: 'Generated report contents',
      isError: false,
    },
  ]);
});

test('scheduled agent result errors keep the last useful message', () => {
  const draft = {
    messages: [],
    summary: null,
    status: 'success' as const,
    errorMessage: null,
  };

  applyScheduledAgentMessage(draft, {
    type: 'error',
    message: '模型配置缺少 API Key',
  });

  applyScheduledAgentMessage(draft, {
    type: 'result',
    content: 'error',
    subtype: 'error',
  });

  assert.equal(draft.status, 'failed');
  assert.equal(draft.summary, '模型配置缺少 API Key');
  assert.equal(draft.errorMessage, '模型配置缺少 API Key');
  assert.deepEqual(draft.messages, [
    {
      type: 'error',
      message: '模型配置缺少 API Key',
    },
    {
      type: 'result',
      content: 'error',
      subtype: 'error',
    },
  ]);
});

test('scheduled agent result errors use an actionable fallback without details', () => {
  const draft = {
    messages: [],
    summary: null,
    status: 'success' as const,
    errorMessage: null,
  };

  applyScheduledAgentMessage(draft, {
    type: 'result',
    content: 'error',
    subtype: 'error',
    sessionId: 'session-1',
    isError: true,
  });

  assert.equal(draft.status, 'failed');
  assert.match(draft.errorMessage || '', /SDK 只返回了 error 状态/);
  assert.deepEqual(draft.messages, [
    {
      type: 'result',
      content: 'error',
      subtype: 'error',
      sessionId: 'session-1',
      isError: true,
    },
  ]);
});

test('local skill manager creates, updates, reads, and deletes SKILL.md', async () => {
  const targetDir = getWorkanySkillsDir();
  const folderName = `codex-test-${Date.now()}`;
  let skillPath = '';

  try {
    const created = await createSkill({
      targetDir,
      folderName,
      name: 'Codex Test Skill',
      description: 'Created by an automated test',
    });
    skillPath = created.skillPath;

    assert.equal(created.folderName, folderName);
    assert.match(created.content, /name: "Codex Test Skill"/);

    const updated = await updateSkill({
      skillPath,
      name: 'Codex Updated Skill',
      description: 'Updated by an automated test',
      content: created.content,
    });

    assert.match(updated.content, /name: "Codex Updated Skill"/);
    assert.match(updated.content, /description: "Updated by an automated test"/);

    const readBack = await readSkill(skillPath);
    assert.equal(readBack.name, 'Codex Updated Skill');

    await deleteSkill(skillPath);
    await assert.rejects(() => readSkill(skillPath));
  } finally {
    if (skillPath) {
      await fs.rm(skillPath, { recursive: true, force: true });
    }
  }
});
