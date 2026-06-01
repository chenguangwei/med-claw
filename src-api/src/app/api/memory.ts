import { Hono } from 'hono';

import {
  buildMemoryContext,
  extractMemoryCandidates,
  rememberFromConversation,
  upsertShortTermMemory,
} from '@/shared/memory/service';
import {
  clearMemoryStore,
  clearShortTermMemoryStore,
  createMemory,
  deleteMemory,
  deleteShortTermMemory,
  getMemory,
  getMemoryStoreSnapshot,
  getShortTermMemory,
  listMemories,
  replaceMemoryStoreSnapshot,
  updateMemory,
} from '@/shared/memory/store';
import type {
  BuildMemoryContextRequest,
  CreateMemoryInput,
  ExtractMemoryRequest,
  ListMemoryFilter,
  RememberFromConversationRequest,
  UpdateMemoryInput,
  UpsertShortTermMemoryInput,
} from '@/shared/memory/types';

export const memoryRoutes = new Hono();

memoryRoutes.get('/', async (c) => {
  const filter: ListMemoryFilter = {
    status: c.req.query('status') as ListMemoryFilter['status'],
    kind: c.req.query('kind') as ListMemoryFilter['kind'],
    scopeType: c.req.query('scopeType') as ListMemoryFilter['scopeType'],
    scopeId: c.req.query('scopeId') || undefined,
    query: c.req.query('query') || undefined,
  };
  return c.json({ memories: await listMemories(filter) });
});

memoryRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<CreateMemoryInput>();
    const memory = await createMemory(body);
    return c.json({ memory }, 201);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});

memoryRoutes.delete('/', async (c) => {
  await clearMemoryStore();
  return c.json({ success: true });
});

memoryRoutes.get('/snapshot', async (c) => {
  return c.json({ memory: await getMemoryStoreSnapshot() });
});

memoryRoutes.put('/snapshot', async (c) => {
  try {
    const body = await c.req.json<{
      memory?: { memories: unknown[]; shortTerm: unknown[] };
    }>();
    const memory = await replaceMemoryStoreSnapshot(
      body.memory || { memories: [], shortTerm: [] }
    );
    return c.json({ memory });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});

memoryRoutes.delete('/short-term', async (c) => {
  await clearShortTermMemoryStore();
  return c.json({ success: true });
});

memoryRoutes.get('/short-term/:sessionId', async (c) => {
  const memory = await getShortTermMemory(c.req.param('sessionId'));
  if (!memory) return c.json({ error: 'Short-term memory not found' }, 404);
  return c.json({ memory });
});

memoryRoutes.put('/short-term/:sessionId', async (c) => {
  try {
    const body =
      await c.req.json<Omit<UpsertShortTermMemoryInput, 'sessionId'>>();
    const memory = await upsertShortTermMemory({
      ...body,
      sessionId: c.req.param('sessionId'),
    });
    return c.json({ memory });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});

memoryRoutes.delete('/short-term/:sessionId', async (c) => {
  const deleted = await deleteShortTermMemory(c.req.param('sessionId'));
  if (!deleted) return c.json({ error: 'Short-term memory not found' }, 404);
  return c.json({ success: true });
});

memoryRoutes.post('/extract', async (c) => {
  const body = await c.req.json<ExtractMemoryRequest>();
  return c.json({ memories: extractMemoryCandidates(body) });
});

memoryRoutes.post('/remember', async (c) => {
  try {
    const body = await c.req.json<RememberFromConversationRequest>();
    const memories = await rememberFromConversation(body);
    return c.json({ memories }, 201);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});

memoryRoutes.post('/context', async (c) => {
  const body = await c.req.json<
    BuildMemoryContextRequest & {
      memoryConfig?: RememberFromConversationRequest['memoryConfig'];
    }
  >();
  const context = await buildMemoryContext(body, body.memoryConfig);
  return c.json({ context });
});

memoryRoutes.get('/:id', async (c) => {
  const memory = await getMemory(c.req.param('id'));
  if (!memory) return c.json({ error: 'Memory not found' }, 404);
  return c.json({ memory });
});

memoryRoutes.patch('/:id', async (c) => {
  try {
    const body = await c.req.json<UpdateMemoryInput>();
    const memory = await updateMemory(c.req.param('id'), body);
    if (!memory) return c.json({ error: 'Memory not found' }, 404);
    return c.json({ memory });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400
    );
  }
});

memoryRoutes.delete('/:id', async (c) => {
  const deleted = await deleteMemory(c.req.param('id'));
  if (!deleted) return c.json({ error: 'Memory not found' }, 404);
  return c.json({ success: true });
});
