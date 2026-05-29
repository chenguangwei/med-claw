import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIProvider, QueryEngine } from '@codeany/open-agent-sdk';

test('agent loop continues after tool use even when provider reports end_turn', async () => {
  let providerCalls = 0;
  let toolCalls = 0;

  const provider = {
    apiType: 'openai-completions' as const,
    async createMessage() {
      providerCalls++;
      if (providerCalls === 1) {
        return {
          content: [
            {
              type: 'tool_use' as const,
              id: 'tool-1',
              name: 'MockRead',
              input: { file_path: '/tmp/example.txt' },
            },
          ],
          stopReason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: 'continued after tool result',
          },
        ],
        stopReason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };

  const tool = {
    name: 'MockRead',
    description: 'Mock read tool',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    isReadOnly: () => true,
    isEnabled: () => true,
    async call() {
      toolCalls++;
      return {
        type: 'tool_result' as const,
        tool_use_id: '',
        content: 'mock file result',
      };
    },
  };

  const engine = new QueryEngine({
    cwd: process.cwd(),
    model: 'mock-model',
    provider,
    tools: [tool],
    maxTurns: 5,
    permissionMode: 'bypassPermissions',
  });

  const messages = [];
  for await (const message of engine.submitMessage('read a file')) {
    messages.push(message);
  }

  assert.equal(toolCalls, 1);
  assert.equal(providerCalls, 2);
  assert.equal(
    messages.filter((message) => message.type === 'assistant').length,
    2
  );
  assert.equal(messages.at(-1)?.type, 'result');
  assert.equal(messages.at(-1)?.subtype, 'success');
});

test('agent loop streams tool error markers to adapters', async () => {
  let providerCalls = 0;

  const provider = {
    apiType: 'openai-completions' as const,
    async createMessage() {
      providerCalls++;
      if (providerCalls === 1) {
        return {
          content: [
            {
              type: 'tool_use' as const,
              id: 'tool-err',
              name: 'MockRead',
              input: { file_path: '/tmp/missing.txt' },
            },
          ],
          stopReason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }

      return {
        content: [{ type: 'text' as const, text: 'handled missing file' }],
        stopReason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };

  const tool = {
    name: 'MockRead',
    description: 'Mock read tool',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    isReadOnly: () => true,
    isEnabled: () => true,
    async call() {
      return {
        type: 'tool_result' as const,
        tool_use_id: 'tool-err',
        content: 'Error: File not found',
        is_error: true,
      };
    },
  };

  const engine = new QueryEngine({
    cwd: process.cwd(),
    model: 'mock-model',
    provider,
    tools: [tool],
    maxTurns: 5,
    permissionMode: 'bypassPermissions',
  });

  const messages = [];
  for await (const message of engine.submitMessage('read a missing file')) {
    messages.push(message);
  }

  const toolResult = messages.find((message) => message.type === 'tool_result');
  assert.equal(toolResult?.result?.is_error, true);
});

test('openai provider round-trips DeepSeek reasoning content across tool turns', () => {
  const provider = new OpenAIProvider({ baseURL: 'https://api.deepseek.com' });
  const providerInternals = provider as unknown as {
    convertResponse(data: unknown): { content: Array<Record<string, unknown>> };
    supportsReasoningContent(model?: string): boolean;
    convertMessages(
      system: string,
      messages: unknown[],
      includeReasoningContent?: boolean
    ): Array<Record<string, unknown>>;
  };

  const response = providerInternals.convertResponse({
    choices: [
      {
        message: {
          role: 'assistant',
          reasoning_content: 'private reasoning trace',
          content: 'checking environment',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'Bash',
                arguments: '{"command":"pwd"}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  assert.deepEqual(response.content[0], {
    type: 'thinking',
    thinking: 'private reasoning trace',
  });

  const messages = providerInternals.convertMessages(
    '',
    [
      {
        role: 'assistant',
        content: response.content,
      },
    ],
    providerInternals.supportsReasoningContent('deepseek-v4-flash')
  );

  assert.equal(messages[0].reasoning_content, 'private reasoning trace');
  assert.equal(
    (messages[0].tool_calls as Array<{ id: string }> | undefined)?.[0]?.id,
    'call_1'
  );
});

test('openai provider does not send reasoning_content to non-DeepSeek models', () => {
  const provider = new OpenAIProvider({ baseURL: 'https://api.openai.com/v1' });
  const providerInternals = provider as unknown as {
    supportsReasoningContent(model?: string): boolean;
    convertMessages(
      system: string,
      messages: unknown[],
      includeReasoningContent?: boolean
    ): Array<Record<string, unknown>>;
  };

  const messages = providerInternals.convertMessages(
    '',
    [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'provider-private reasoning' },
          { type: 'text', text: 'checking environment' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'Bash',
            input: { command: 'pwd' },
          },
        ],
      },
    ],
    providerInternals.supportsReasoningContent('gpt-4.1')
  );

  assert.equal(providerInternals.supportsReasoningContent('gpt-4.1'), false);
  assert.equal(messages[0].reasoning_content, undefined);
  assert.equal(
    (messages[0].tool_calls as Array<{ id: string }> | undefined)?.[0]?.id,
    'call_1'
  );
});
