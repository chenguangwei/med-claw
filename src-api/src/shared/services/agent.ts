/**
 * Agent Service
 *
 * This service provides the main interface for running AI agents.
 * It uses the agents abstraction layer to support multiple providers.
 */

import { nanoid } from 'nanoid';

import {
  createAgent,
  type AgentConfig,
  type AgentMessage,
  type AgentSession,
  type ConversationMessage,
  type IAgent,
  type ImageAttachment,
  type McpConfig,
  type SandboxConfig,
  type SkillsConfig,
  type TaskPlan,
} from '@/core/agent';
import { DEFAULT_AGENT_PROVIDER } from '@/config/constants';
import {
  buildMemoryAugmentedPrompt,
  rememberFromConversation,
  updateShortTermFromConversation,
} from '@/shared/memory/service';
import type { MemoryConfig, MemorySource } from '@/shared/memory/types';
import { getProviderManager } from '@/shared/provider/manager';
// ============================================================================
// Logging - uses shared logger (writes to ~/.uniins-claw/logs/uniins-claw.log)
// ============================================================================
import { createLogger } from '@/shared/utils/logger';

const serviceLogger = createLogger('AgentService');

// Global agent instance (lazy initialized)
let globalAgent: IAgent | null = null;
let globalAgentCacheKey: string | null = null;

// Store active sessions for backward compatibility
const activeSessions = new Map<string, { abortController: AbortController }>();

// Global plan store (shared across all agent instances)
const globalPlanStore = new Map<string, TaskPlan>();

export interface AgentMemoryRuntimeOptions {
  memoryConfig?: MemoryConfig;
  clientSessionId?: string;
  taskId?: string;
  projectPath?: string;
  channelId?: string;
  scheduledTaskId?: string;
  origin?: MemorySource['origin'];
}

function collectAssistantText(message: AgentMessage): string {
  if (message.type === 'text' || message.type === 'direct_answer') {
    return message.content || '';
  }
  if (message.type === 'result') {
    return message.result || message.content || '';
  }
  if (message.type === 'error') {
    return message.message || '';
  }
  return '';
}

async function preparePromptWithMemory(
  prompt: string,
  fallbackSessionId: string,
  memoryOptions?: AgentMemoryRuntimeOptions
): Promise<string> {
  const sessionId = memoryOptions?.clientSessionId || fallbackSessionId;
  const { prompt: augmentedPrompt } = await buildMemoryAugmentedPrompt({
    prompt,
    sessionId,
    taskId: memoryOptions?.taskId,
    projectPath: memoryOptions?.projectPath,
    channelId: memoryOptions?.channelId,
    scheduledTaskId: memoryOptions?.scheduledTaskId,
    memoryConfig: memoryOptions?.memoryConfig,
  });
  return augmentedPrompt;
}

async function persistMemoryAfterRun(input: {
  userMessage: string;
  assistantText: string;
  fallbackSessionId: string;
  memoryOptions?: AgentMemoryRuntimeOptions;
}): Promise<void> {
  const sessionId =
    input.memoryOptions?.clientSessionId || input.fallbackSessionId;

  await updateShortTermFromConversation({
    sessionId,
    userMessage: input.userMessage,
    assistantText: input.assistantText,
    taskId: input.memoryOptions?.taskId,
    memoryConfig: input.memoryOptions?.memoryConfig,
  });

  await rememberFromConversation({
    userMessage: input.userMessage,
    assistantText: input.assistantText,
    sessionId,
    taskId: input.memoryOptions?.taskId,
    projectPath: input.memoryOptions?.projectPath,
    origin: input.memoryOptions?.origin || 'agent',
    memoryConfig: input.memoryOptions?.memoryConfig,
  });
}

/**
 * Get or create the global agent instance
 * If modelConfig is provided, creates a new agent with those settings
 */
export async function getAgent(config?: Partial<AgentConfig>): Promise<IAgent> {
  console.log('[AgentService] getAgent called with config:', {
    hasConfig: !!config,
    hasApiKey: !!config?.apiKey,
    hasBaseUrl: !!config?.baseUrl,
    model: config?.model,
  });

  // Get current active agent provider from ProviderManager
  const providerManager = getProviderManager();
  const currentAgentConfig = providerManager.getConfig().agent;
  const currentProvider = currentAgentConfig?.type || DEFAULT_AGENT_PROVIDER;
  const syncedConfig = (currentAgentConfig?.config ||
    {}) as Partial<AgentConfig>;
  const effectiveConfig = {
    ...syncedConfig,
    ...(config || {}),
  };

  console.log('[AgentService] Using current agent provider:', currentProvider);

  // If config with API credentials is provided, create a new agent instance
  // Don't cache it to allow different configs per request
  if (
    config &&
    (effectiveConfig.apiKey || effectiveConfig.baseUrl || effectiveConfig.model)
  ) {
    console.log('[AgentService] Creating new agent with custom config:', {
      hasApiKey: !!effectiveConfig.apiKey,
      baseUrl: effectiveConfig.baseUrl,
      model: effectiveConfig.model,
    });
    return createAgent({
      provider: currentProvider as any,
      ...effectiveConfig,
    });
  }

  // Use cached global agent for default configuration
  const nextCacheKey = JSON.stringify({
    provider: currentProvider,
    ...effectiveConfig,
  });
  if (!globalAgent || globalAgentCacheKey !== nextCacheKey) {
    console.log(
      '[AgentService] Creating agent with current provider:',
      currentProvider
    );
    globalAgent = createAgent({
      provider: currentProvider as any,
      ...effectiveConfig,
      workDir: effectiveConfig.workDir || '~/.uniins-claw',
    });
    globalAgentCacheKey = nextCacheKey;
  }
  return globalAgent;
}

/**
 * Create a new agent session
 */
export function createSession(
  phase: 'plan' | 'execute' = 'plan'
): AgentSession {
  const session: AgentSession = {
    id: nanoid(),
    createdAt: new Date(),
    phase: phase === 'plan' ? 'planning' : 'executing',
    isAborted: false,
    abortController: new AbortController(),
  };
  activeSessions.set(session.id, {
    abortController: session.abortController,
  });
  return session;
}

/**
 * Get an existing session
 */
export function getSession(sessionId: string): AgentSession | undefined {
  const session = activeSessions.get(sessionId);
  if (!session) return undefined;

  return {
    id: sessionId,
    createdAt: new Date(),
    phase: 'idle',
    isAborted: session.abortController.signal.aborted,
    abortController: session.abortController,
  };
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.abortController.abort();
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Get a stored plan from global store
 */
export function getPlan(planId: string): TaskPlan | undefined {
  return globalPlanStore.get(planId);
}

/**
 * Save a plan to global store
 */
export function savePlan(plan: TaskPlan): void {
  globalPlanStore.set(plan.id, plan);
  console.log(`[AgentService] Plan saved to global store: ${plan.id}`);
}

/**
 * Delete a plan from global store
 */
export function deletePlan(planId: string): boolean {
  const deleted = globalPlanStore.delete(planId);
  if (deleted) {
    console.log(`[AgentService] Plan deleted from global store: ${planId}`);
  }
  return deleted;
}

/**
 * Run the planning phase
 */
export async function* runPlanningPhase(
  prompt: string,
  session: AgentSession,
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    apiType?: 'anthropic-messages' | 'openai-completions';
  },
  language?: string,
  memoryOptions?: AgentMemoryRuntimeOptions
): AsyncGenerator<AgentMessage> {
  const agent = await getAgent(modelConfig as Partial<AgentConfig>);
  const effectivePrompt = await preparePromptWithMemory(
    prompt,
    session.id,
    memoryOptions
  );

  for await (const message of agent.plan(effectivePrompt, {
    sessionId: session.id,
    abortController: session.abortController,
    language,
  })) {
    // Intercept plan messages and save to global store
    if (message.type === 'plan' && message.plan) {
      savePlan(message.plan);
    }
    yield message;
  }
}

/**
 * Run the execution phase
 */
export async function* runExecutionPhase(
  planId: string,
  session: AgentSession,
  originalPrompt: string,
  workDir?: string,
  taskId?: string,
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    apiType?: 'anthropic-messages' | 'openai-completions';
  },
  sandboxConfig?: SandboxConfig,
  skillsConfig?: SkillsConfig,
  mcpConfig?: McpConfig,
  language?: string,
  memoryOptions?: AgentMemoryRuntimeOptions
): AsyncGenerator<AgentMessage> {
  const agent = await getAgent(modelConfig);
  const effectivePrompt = await preparePromptWithMemory(
    originalPrompt,
    session.id,
    memoryOptions
  );

  // Get the plan from global store to pass to agent
  // This is necessary because each agent instance has its own plan store
  const plan = getPlan(planId);
  if (!plan) {
    yield { type: 'error', message: `Plan not found: ${planId}` };
    yield { type: 'done' };
    return;
  }

  serviceLogger.info(`[AgentService] Executing plan: ${planId} (${plan.goal})`);
  // Log sandbox config for debugging - write to file for packaged app visibility
  serviceLogger.info('[AgentService] runExecutionPhase sandbox config:', {
    hasSandboxConfig: !!sandboxConfig,
    sandboxEnabled: sandboxConfig?.enabled,
    sandboxProvider: sandboxConfig?.provider,
    apiEndpoint: sandboxConfig?.apiEndpoint,
  });
  serviceLogger.info(
    '[AgentService] runExecutionPhase skills config:',
    skillsConfig
  );
  serviceLogger.info('[AgentService] runExecutionPhase mcp config:', mcpConfig);

  let assistantText = '';
  for await (const message of agent.execute({
    planId,
    plan, // Pass the plan directly so agent doesn't need to look it up
    originalPrompt: effectivePrompt,
    sessionId: session.id,
    cwd: workDir,
    taskId,
    abortController: session.abortController,
    sandbox: sandboxConfig,
    skillsConfig,
    mcpConfig,
    language,
  })) {
    assistantText += collectAssistantText(message);
    yield message;
  }

  await persistMemoryAfterRun({
    userMessage: originalPrompt,
    assistantText,
    fallbackSessionId: session.id,
    memoryOptions,
  });
}

/**
 * Run agent directly (without planning phase)
 */
export async function* runAgent(
  prompt: string,
  session: AgentSession,
  conversation?: ConversationMessage[],
  workDir?: string,
  taskId?: string,
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    apiType?: 'anthropic-messages' | 'openai-completions';
  },
  sandboxConfig?: SandboxConfig,
  images?: ImageAttachment[],
  skillsConfig?: SkillsConfig,
  mcpConfig?: McpConfig,
  language?: string,
  memoryOptions?: AgentMemoryRuntimeOptions
): AsyncGenerator<AgentMessage> {
  const agent = await getAgent(modelConfig);
  const effectivePrompt = await preparePromptWithMemory(
    prompt,
    session.id,
    memoryOptions
  );

  // Log sandbox config for debugging - write to file for packaged app visibility
  serviceLogger.info('[AgentService] runAgent called with sandbox config:', {
    hasSandboxConfig: !!sandboxConfig,
    sandboxEnabled: sandboxConfig?.enabled,
    sandboxProvider: sandboxConfig?.provider,
    apiEndpoint: sandboxConfig?.apiEndpoint,
  });
  serviceLogger.info(
    '[AgentService] runAgent called with skills config:',
    skillsConfig
  );
  serviceLogger.info(
    '[AgentService] runAgent called with mcp config:',
    mcpConfig
  );

  let assistantText = '';
  for await (const message of agent.run(effectivePrompt, {
    sessionId: session.id,
    conversation,
    cwd: workDir,
    taskId,
    abortController: session.abortController,
    sandbox: sandboxConfig,
    images,
    skillsConfig,
    mcpConfig,
    language,
  })) {
    assistantText += collectAssistantText(message);
    yield message;
  }

  await persistMemoryAfterRun({
    userMessage: prompt,
    assistantText,
    fallbackSessionId: session.id,
    memoryOptions,
  });
}

/**
 * Stop an agent execution
 */
export function stopAgent(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.abortController.abort();
  }
}

// Re-export types for convenience
export type {
  AgentMessage,
  AgentSession,
  TaskPlan,
  ConversationMessage,
  AgentConfig,
  IAgent,
  ImageAttachment,
  SkillsConfig,
  McpConfig,
};
