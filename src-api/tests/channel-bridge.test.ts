import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  buildChannelAgentPrompt,
  CHANNEL_MODEL_CONFIG_ERROR,
  collectChannelAgentReply,
  createChannelIntegrationService,
  getChannelDefinitions,
  resolveChannelAgentModelConfig,
} from '../src/shared/channels/service.js';
import { getProviderManager } from '../src/shared/provider/manager.js';
import type {
  ChannelAgentRunner,
  ChannelCommandRunner,
  ChannelOutboundSender,
} from '../src/shared/channels/types.js';
import { createWeixinLoginManager } from '../src/shared/channels/weixin-login.js';

async function eventually(
  assertion: () => void,
  timeoutMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  if (lastError) throw lastError;
}

test('channel definitions expose all approved workplace channels', () => {
  const definitions = getChannelDefinitions();

  assert.deepEqual(
    definitions.map((definition) => definition.id),
    ['feishu', 'weixin', 'dingtalk']
  );
  assert.equal(definitions[0].authMode, 'oauth');
  assert.equal(definitions[1].authMode, 'qr');
  assert.equal(definitions[2].authMode, 'oauth');
});

test('buildChannelAgentPrompt injects channel metadata and assistant scope', () => {
  const prompt = buildChannelAgentPrompt(
    {
      channel: 'feishu',
      conversationId: 'oc_123',
      senderName: 'Alice',
      text: '请帮我整理今天的会议纪要',
    },
    {
      assistantName: '项目助理',
      prompt: '你负责项目管理和会议纪要。',
      skillNames: ['lark-doc'],
      mcpServerNames: ['internal-docs'],
    }
  );

  assert.match(prompt, /channel="feishu"/);
  assert.match(prompt, /conversation="oc_123"/);
  assert.match(prompt, /sender="Alice"/);
  assert.match(prompt, /Active assistant: 项目助理/);
  assert.match(prompt, /Allowed Skills: lark-doc/);
  assert.match(prompt, /请帮我整理今天的会议纪要/);
});

test('collectChannelAgentReply prefers final result then accumulated text', () => {
  assert.equal(
    collectChannelAgentReply([
      { type: 'text', content: '中间过程' },
      { type: 'result', result: '最终回复' },
      { type: 'done' },
    ]),
    '最终回复'
  );

  assert.equal(
    collectChannelAgentReply([
      { type: 'text', content: '第一段' },
      { type: 'direct_answer', content: '第二段' },
      { type: 'done' },
    ]),
    '第一段\n第二段'
  );
});

test('channel service keeps one session per channel conversation and sends replies', async () => {
  const sent: Array<{ channel: string; conversationId: string; text: string }> =
    [];

  const agentRunner: ChannelAgentRunner = async function* (request) {
    yield { type: 'text', content: `回复: ${request.prompt.slice(0, 20)}` };
    yield { type: 'done' };
  };

  const outboundSender: ChannelOutboundSender = async ({ inbound, reply }) => {
    sent.push({
      channel: inbound.channel,
      conversationId: inbound.conversationId,
      text: reply.text,
    });
    return { ok: true };
  };

  const service = createChannelIntegrationService({
    agentRunner,
    outboundSender,
    storeFile: false,
  });

  const first = await service.handleInboundMessage({
    channel: 'weixin',
    conversationId: 'wx-user-1',
    senderName: 'Wei',
    text: '你好',
  });

  const second = await service.handleInboundMessage({
    channel: 'weixin',
    conversationId: 'wx-user-1',
    senderName: 'Wei',
    text: '继续',
  });

  assert.equal(first.session.id, second.session.id);
  assert.equal(second.session.history.length, 4);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].channel, 'weixin');
});

test('channel service returns setup guidance before running agent without model credentials', async () => {
  const manager = getProviderManager();
  const previousConfig = manager.getConfig();
  const sent: string[] = [];

  try {
    manager.setConfig({
      agent: {
        category: 'agent',
        type: 'codeany',
        config: {
          model: 'claude-sonnet-4-20250514',
        },
      },
    });

    const service = createChannelIntegrationService({
      storeFile: false,
      outboundSender: async ({ reply }) => {
        sent.push(reply.text);
        return { ok: true };
      },
    });

    const result = await service.handleInboundMessage({
      channel: 'weixin',
      conversationId: 'wx-no-model',
      senderName: 'Wei',
      text: '你好',
    });

    assert.equal(result.reply.text, `Agent 执行失败：${CHANNEL_MODEL_CONFIG_ERROR}`);
    assert.deepEqual(sent, [result.reply.text]);
  } finally {
    manager.setConfig(previousConfig);
  }
});

test('channel model config preserves apiType from synced provider settings', () => {
  const manager = getProviderManager();
  const previousConfig = manager.getConfig();

  try {
    manager.setConfig({
      agent: {
        category: 'agent',
        type: 'codeany',
        config: {
          apiKey: 'test-api-key',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
          apiType: 'openai-completions',
        },
      },
    });

    assert.deepEqual(resolveChannelAgentModelConfig(), {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiType: 'openai-completions',
    });
  } finally {
    manager.setConfig(previousConfig);
  }
});

test('setup commands are generated without invoking external CLIs by default', async () => {
  const executed: string[][] = [];
  const commandRunner: ChannelCommandRunner = async (command, args) => {
    executed.push([command, ...args]);
    return { code: 0, stdout: 'ok', stderr: '' };
  };

  const service = createChannelIntegrationService({
    commandRunner,
    storeFile: false,
  });

  const feishu = await service.createAuthSession('feishu', { execute: false });
  const weixin = await service.createAuthSession('weixin', { execute: false });
  const dingtalk = await service.createAuthSession('dingtalk', {
    execute: false,
  });

  assert.equal(feishu.command.command, 'lark-cli');
  assert.deepEqual(feishu.command.args, ['auth', 'login', '--recommend']);
  assert.equal(
    weixin.command.command,
    'app'
  );
  assert.deepEqual(weixin.command.args, ['channels', 'weixin', 'connect']);
  assert.equal(dingtalk.command.command, 'dws');
  assert.deepEqual(dingtalk.command.args, ['auth', 'login']);
  assert.deepEqual(executed, []);
});

test('weixin login manager returns an in-app QR session and starts bot after confirmation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-weixin-'));
  let startedAccountId = '';

  try {
    const manager = createWeixinLoginManager({
      stateDir: tempDir,
      autoStartStoredConnection: false,
      fetchQRCode: async () => ({
        qrcode: 'qr-token-1',
        qrcode_img_content: 'https://example.com/weixin-qr',
      }),
      pollQRCodeStatus: async () => ({
        status: 'confirmed',
        bot_token: 'bot-token',
        ilink_bot_id: 'abc@im.bot',
        ilink_user_id: 'user-1',
        baseurl: 'https://ilinkai.weixin.qq.com',
      }),
      startBot: (_agent, options) => {
        startedAccountId = options?.accountId || '';
        return {
          wait: () => new Promise<void>(() => undefined),
        };
      },
      logout: () => undefined,
      inboundHandler: async () => ({
        session: {
          id: 's1',
          channel: 'weixin',
          conversationId: 'c1',
          history: [],
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          status: 'idle',
        },
        reply: { text: 'ok' },
        sent: { ok: true },
        messages: [],
      }),
    });

    const session = await manager.startLogin();
    assert.equal(session.status, 'waiting');
    assert.match(session.qrCodeSvg || '', /<svg/);
    assert.equal(session.qrCodeUrl, 'https://example.com/weixin-qr');

    await eventually(() => {
      const current = manager.getLoginSession(session.sessionId);
      assert.equal(current?.status, 'confirmed');
      assert.equal(startedAccountId, 'abc-im-bot');
      assert.equal(manager.getConnectionStatus().connected, true);
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('channel bindings persist to a local store file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniins-channel-'));
  const storeFile = path.join(tempDir, 'channels.json');

  try {
    const first = createChannelIntegrationService({ storeFile });
    first.updateBinding('dingtalk', {
      enabled: true,
      defaultAssistant: {
        assistantName: '客服助理',
        prompt: '只处理客户咨询。',
      },
      config: {
        robotCode: 'robot-1',
      },
    });

    const second = createChannelIntegrationService({ storeFile });
    const dingtalk = second
      .getStatus()
      .bindings.find((binding) => binding.channel === 'dingtalk');

    assert.equal(dingtalk?.enabled, true);
    assert.equal(dingtalk?.defaultAssistant?.assistantName, '客服助理');
    assert.equal(dingtalk?.config.robotCode, 'robot-1');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
