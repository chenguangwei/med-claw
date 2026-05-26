import { Hono } from 'hono';

import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledTaskRuns,
  listScheduledTasks,
  updateScheduledTask,
} from '@/shared/scheduled/store';
import { runScheduledTaskNow } from '@/shared/scheduled/service';
import type {
  CreateScheduledTaskInput,
  ScheduledTaskExecutionConfig,
  UpdateScheduledTaskInput,
} from '@/shared/scheduled/types';

export const scheduledTasksRoutes = new Hono();

scheduledTasksRoutes.get('/', async (c) => {
  return c.json({ tasks: await listScheduledTasks() });
});

scheduledTasksRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<CreateScheduledTaskInput>();
    const task = await createScheduledTask(body);
    return c.json({ task }, 201);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});

scheduledTasksRoutes.get('/:id', async (c) => {
  const task = await getScheduledTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Scheduled task not found' }, 404);
  return c.json({ task });
});

scheduledTasksRoutes.put('/:id', async (c) => {
  try {
    const body = await c.req.json<UpdateScheduledTaskInput>();
    const task = await updateScheduledTask(c.req.param('id'), body);
    if (!task) return c.json({ error: 'Scheduled task not found' }, 404);
    return c.json({ task });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});

scheduledTasksRoutes.delete('/:id', async (c) => {
  const deleted = await deleteScheduledTask(c.req.param('id'));
  if (!deleted) return c.json({ error: 'Scheduled task not found' }, 404);
  return c.json({ success: true });
});

scheduledTasksRoutes.get('/:id/runs', async (c) => {
  const task = await getScheduledTask(c.req.param('id'));
  if (!task) return c.json({ error: 'Scheduled task not found' }, 404);
  return c.json({ runs: await listScheduledTaskRuns(task.id) });
});

scheduledTasksRoutes.post('/:id/run', async (c) => {
  try {
    const config =
      c.req.header('content-type')?.includes('application/json')
        ? await c.req.json<ScheduledTaskExecutionConfig>().catch(() => ({}))
        : {};
    const run = await runScheduledTaskNow(c.req.param('id'), config);
    return c.json({ run }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json(
      { error: message },
      message.includes('not found') ? 404 : 409
    );
  }
});
