/**
 * Lightweight Chat Service
 *
 * Directly calls the LLM API for simple conversational queries,
 * bypassing the Claude Agent SDK to avoid CLI subprocess, tools, and thinking mode overhead.
 *
 * Supports both Anthropic (native SDK) and OpenAI-compatible APIs (fetch).
 */

import Anthropic from '@anthropic-ai/sdk';

import type { AgentMessage, ConversationMessage } from '@/core/agent/types';
import {
  buildMemoryAugmentedPrompt,
  rememberFromConversation,
  updateShortTermFromConversation,
} from '@/shared/memory/service';
import type { MemoryConfig, MemorySource } from '@/shared/memory/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ChatService');

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

type AnthropicMessagesCreate = (
  params: Record<string, unknown>
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

export interface ChatMemoryRuntimeOptions {
  memoryConfig?: MemoryConfig;
  clientSessionId?: string;
  taskId?: string;
  projectPath?: string;
  origin?: MemorySource['origin'];
}

// Maximum number of conversation messages to include in API calls
// to prevent excessive token usage. Each "turn" is a user+assistant pair.
const MAX_CONTEXT_MESSAGES = 40; // 20 turns × 2 messages

function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-') || model.includes('claude');
}

function resolveConfig(modelConfig?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}) {
  // Use explicit modelConfig from user settings only — no environment variable fallback
  const apiKey = modelConfig?.apiKey || '';
  const baseURL = modelConfig?.baseUrl || undefined;
  const model = modelConfig?.model || DEFAULT_MODEL;

  return { apiKey, baseURL, model };
}

function buildOpenAIChatCompletionsUrl(baseURL: string | undefined): string {
  if (!baseURL) {
    return 'https://api.openai.com/v1/chat/completions';
  }

  const base = baseURL.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) {
    return base;
  }

  if (/\/v\d+(?:\.\d+)?$/.test(base)) {
    return `${base}/chat/completions`;
  }

  return `${base}/v1/chat/completions`;
}

function buildSystemPrompt(base: string, language?: string): string {
  let systemPrompt = base;
  if (language) {
    const langMap: Record<string, string> = {
      'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      'en-US': 'English',
      'ja-JP': 'Japanese',
      'ko-KR': 'Korean',
    };
    const langName = langMap[language] || language;
    systemPrompt += ` Please respond in ${langName}.`;
  }
  return systemPrompt;
}

// ============================================================================
// OpenAI-compatible streaming (for non-Anthropic models via proxy)
// ============================================================================

async function* runOpenAICompatibleChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  baseURL: string | undefined,
  model: string,
  abortController?: AbortController
): AsyncGenerator<AgentMessage> {
  const endpoint = buildOpenAIChatCompletionsUrl(baseURL);

  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  logger.info('[ChatService] OpenAI-compatible request:', { endpoint, model });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: openaiMessages,
      max_tokens: 4096,
      stream: true,
    }),
    signal: abortController?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          yield { type: 'text', content };
        }
      } catch {
        // skip unparseable chunks
      }
    }
  }

  yield { type: 'done' };
}

async function openAICompatibleCreate(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  apiKey: string,
  baseURL: string | undefined,
  model: string,
  maxTokens: number
): Promise<string> {
  const endpoint = buildOpenAIChatCompletionsUrl(baseURL);

  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: openaiMessages,
      max_tokens: maxTokens,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================================================
// Main chat function
// ============================================================================

/**
 * Run a lightweight chat using the appropriate API.
 * - Anthropic models: uses Anthropic SDK
 * - Other models: uses OpenAI-compatible fetch
 */
export async function* runChat(
  prompt: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string },
  language?: string,
  conversation?: ConversationMessage[],
  abortController?: AbortController,
  memoryOptions?: ChatMemoryRuntimeOptions
): AsyncGenerator<AgentMessage> {
  const { apiKey, baseURL, model } = resolveConfig(modelConfig);

  if (!apiKey) {
    yield {
      type: 'error',
      message: 'No API key configured. Please set up your API key in Settings.',
    };
    yield { type: 'done' };
    return;
  }

  logger.info('[ChatService] Starting chat:', {
    model,
    hasBaseURL: !!baseURL,
    isAnthropic: isAnthropicModel(model),
    hasConversation: !!(conversation && conversation.length > 0),
    promptLength: prompt.length,
  });

  const systemPrompt = buildSystemPrompt(
    'You are a helpful assistant. Be concise and direct in your responses. ' +
      'You have network access capabilities. When users ask about URLs, websites, or online content, ' +
      'you should attempt to help by analyzing the URL structure, inferring content from the domain/path, ' +
      'or suggesting the user switch to Agent/Task mode for full web access with tools like curl and browser automation.',
    language
  );

  const sessionId = memoryOptions?.clientSessionId || memoryOptions?.taskId;
  const memoryPrompt = await buildMemoryAugmentedPrompt({
    prompt,
    sessionId,
    taskId: memoryOptions?.taskId,
    projectPath: memoryOptions?.projectPath,
    memoryConfig: memoryOptions?.memoryConfig,
  });
  const effectivePrompt = memoryPrompt.prompt;

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (conversation && conversation.length > 0) {
    // Limit conversation history to prevent excessive token usage
    const trimmedConversation =
      conversation.length > MAX_CONTEXT_MESSAGES
        ? conversation.slice(-MAX_CONTEXT_MESSAGES)
        : conversation;

    if (trimmedConversation.length < conversation.length) {
      logger.info(
        `[ChatService] Truncated conversation history from ${conversation.length} to ${trimmedConversation.length} messages`
      );
    }

    for (const msg of trimmedConversation) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: effectivePrompt });

  let assistantText = '';
  const remember = async () => {
    if (!sessionId) return;
    await updateShortTermFromConversation({
      sessionId,
      userMessage: prompt,
      assistantText,
      taskId: memoryOptions?.taskId,
      memoryConfig: memoryOptions?.memoryConfig,
    });
    await rememberFromConversation({
      userMessage: prompt,
      assistantText,
      sessionId,
      taskId: memoryOptions?.taskId,
      projectPath: memoryOptions?.projectPath,
      origin: memoryOptions?.origin || 'chat',
      memoryConfig: memoryOptions?.memoryConfig,
    });
  };

  // Non-Anthropic models: use OpenAI-compatible API
  if (!isAnthropicModel(model)) {
    try {
      for await (const message of runOpenAICompatibleChat(
        messages,
        systemPrompt,
        apiKey,
        baseURL,
        model,
        abortController
      )) {
        if (message.type === 'text') {
          assistantText += message.content || '';
        }
        yield message;
      }
      await remember();
    } catch (error) {
      if (abortController?.signal.aborted) {
        logger.info('[ChatService] Chat aborted by user');
        yield { type: 'done' };
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('[ChatService] OpenAI-compatible chat error:', errorMessage);
      yield { type: 'error', message: errorMessage };
      yield { type: 'done' };
    }
    return;
  }

  // Anthropic models: use Anthropic SDK
  const client = new Anthropic({ apiKey, baseURL });

  try {
    const requestParams: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    };

    requestParams.thinking = { type: 'disabled' };

    const stream = client.messages.stream(
      requestParams as Parameters<typeof client.messages.stream>[0]
    );

    if (abortController) {
      abortController.signal.addEventListener('abort', () => {
        stream.abort();
      });
    }

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        assistantText += event.delta.text;
        yield { type: 'text', content: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    logger.info('[ChatService] Chat completed:', {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });

    yield { type: 'done' };
    await remember();
  } catch (error) {
    if (abortController?.signal.aborted) {
      logger.info('[ChatService] Chat aborted by user');
      yield { type: 'done' };
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[ChatService] Chat error:', errorMessage);
    yield { type: 'error', message: errorMessage };
    yield { type: 'done' };
  }
}

// ============================================================================
// Title generation
// ============================================================================

/**
 * Generate a short title from a user prompt.
 * Uses a lightweight LLM call to summarize the prompt into a concise title.
 */
export async function generateTitle(
  prompt: string,
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string },
  language?: string
): Promise<string> {
  const { apiKey, baseURL, model } = resolveConfig(modelConfig);

  if (!apiKey) {
    return prompt.slice(0, 30) + (prompt.length > 30 ? '...' : '');
  }

  const langHint = language?.startsWith('zh') ? '请用中文回复。' : '';
  const systemPrompt = `Generate a very short title (max 20 characters) that summarizes the user's request. Output ONLY the title, no quotes, no punctuation at the end, no explanation. ${langHint}`;

  try {
    let title: string;

    if (!isAnthropicModel(model)) {
      // Non-Anthropic: OpenAI-compatible
      title = await openAICompatibleCreate(
        [{ role: 'user', content: prompt }],
        systemPrompt,
        apiKey,
        baseURL,
        model,
        50
      );
    } else {
      // Anthropic: native SDK
      const client = new Anthropic({ apiKey, baseURL });
      const requestParams: Record<string, unknown> = {
        model,
        max_tokens: 50,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'disabled' },
      };

      const response = await (
        client.messages.create as unknown as AnthropicMessagesCreate
      )(requestParams);
      title = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text || '')
        .join('')
        .trim();
    }

    logger.info('[ChatService] Generated title:', {
      prompt: prompt.slice(0, 50),
      title,
    });
    return title || prompt.slice(0, 30);
  } catch (error) {
    logger.error('[ChatService] Title generation failed:', error);
    return prompt.slice(0, 30) + (prompt.length > 30 ? '...' : '');
  }
}
