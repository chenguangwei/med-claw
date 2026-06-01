import { Hono } from 'hono';

import {
  channelIntegrationService,
  getChannelDefinitions,
  weixinLoginManager,
} from '@/shared/channels/service';
import type {
  ChannelBinding,
  ChannelId,
  ChannelInboundMessage,
  ChannelOutboundMessage,
} from '@/shared/channels/types';

const channels = new Hono();

const CHANNEL_IDS = new Set<ChannelId>(['feishu', 'weixin', 'dingtalk']);

function parseChannelId(value: string): ChannelId | null {
  return CHANNEL_IDS.has(value as ChannelId) ? (value as ChannelId) : null;
}

function channelNotFound(channel: string) {
  return {
    error: `Unknown channel: ${channel}`,
    supportedChannels: getChannelDefinitions().map(
      (definition) => definition.id
    ),
  };
}

channels.get('/', (c) => {
  return c.json({
    ...channelIntegrationService.getStatus(),
    connections: [weixinLoginManager.getConnectionStatus()],
  });
});

channels.get('/definitions', (c) => {
  return c.json({ definitions: getChannelDefinitions() });
});

channels.post('/:channel/binding', async (c) => {
  const channel = parseChannelId(c.req.param('channel'));
  if (!channel) return c.json(channelNotFound(c.req.param('channel')), 404);

  const body =
    await c.req.json<Partial<Omit<ChannelBinding, 'channel' | 'updatedAt'>>>();
  const binding = channelIntegrationService.updateBinding(channel, body);

  return c.json({ binding });
});

channels.post('/:channel/auth', async (c) => {
  const channel = parseChannelId(c.req.param('channel'));
  if (!channel) return c.json(channelNotFound(c.req.param('channel')), 404);

  const body = (await c.req
    .json<{ execute?: boolean }>()
    .catch(() => ({}))) as { execute?: boolean };
  const session = await channelIntegrationService.createAuthSession(channel, {
    execute: body.execute === true,
  });

  return c.json(session);
});

channels.post('/weixin/login/start', async (c) => {
  const body = (await c.req
    .json<{ force?: boolean }>()
    .catch(() => ({}))) as { force?: boolean };
  const session = await weixinLoginManager.startLogin({
    force: body.force === true,
  });

  return c.json({ session });
});

channels.get('/weixin/login/:sessionId', (c) => {
  const session = weixinLoginManager.getLoginSession(c.req.param('sessionId'));
  if (!session) return c.json({ error: '微信连接会话不存在或已结束。' }, 404);

  return c.json({ session });
});

channels.post('/weixin/login/:sessionId/cancel', (c) => {
  const session = weixinLoginManager.cancelLogin(c.req.param('sessionId'));
  if (!session) return c.json({ error: '微信连接会话不存在或已结束。' }, 404);

  return c.json({ session });
});

channels.post('/weixin/disconnect', async (c) => {
  const connection = await weixinLoginManager.disconnect();

  return c.json({ connection });
});

channels.post('/:channel/inbound', async (c) => {
  const channel = parseChannelId(c.req.param('channel'));
  if (!channel) return c.json(channelNotFound(c.req.param('channel')), 404);

  const body = await c.req.json<Omit<ChannelInboundMessage, 'channel'>>();
  if (!body.conversationId || !body.text) {
    return c.json(
      { error: 'conversationId and text are required for inbound messages' },
      400
    );
  }

  const result = await channelIntegrationService.handleInboundMessage({
    ...body,
    channel,
  });

  return c.json(result);
});

channels.post('/:channel/send', async (c) => {
  const channel = parseChannelId(c.req.param('channel'));
  if (!channel) return c.json(channelNotFound(c.req.param('channel')), 404);

  const body = await c.req.json<{
    conversationId: string;
    reply: ChannelOutboundMessage;
  }>();
  if (!body.conversationId || !body.reply?.text) {
    return c.json(
      { error: 'conversationId and reply.text are required for send' },
      400
    );
  }

  const result = await channelIntegrationService.sendMessage(
    {
      channel,
      conversationId: body.conversationId,
      text: body.reply.text,
    },
    body.reply
  );

  return c.json(result);
});

export { channels as channelsRoutes };
