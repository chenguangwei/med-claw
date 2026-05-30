export interface AssistantExecutionScopeData {
  assistantIds?: string[];
  assistantNames?: string[];
  skillNames?: string[];
  mcpServerNames?: string[];
  instruction?: string;
}

export interface AssistantProfile {
  id: string;
  name: string;
  initial: string;
  source: 'primary' | 'built-in' | 'custom';
  capabilityId?: string | null;
  description?: string;
  prompt: string;
  skillNames: string[];
  skillSources?: string[];
  mcpServerNames: string[];
  skillLabels?: string[];
  mcpLabels?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export const CUSTOM_ASSISTANTS_STORAGE_KEY = 'uniins-claw:custom-assistants';
export const ASSISTANT_PROFILES_CHANGED_EVENT =
  'uniins-claw:assistant-profiles-changed';

export function getInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'A';
}

export function createPrimaryAssistantProfile(name: string): AssistantProfile {
  return {
    id: 'primary',
    name,
    initial: getInitial(name),
    source: 'primary',
    capabilityId: null,
    description: '',
    prompt: '作为通用助手处理用户任务。',
    skillNames: [],
    skillSources: [],
    mcpServerNames: [],
    skillLabels: [],
    mcpLabels: [],
  };
}

export function normalizeAssistantProfile(
  input: unknown
): AssistantProfile | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<AssistantProfile> & {
    skills?: string[];
    mcps?: string[];
  };

  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.initial !== 'string'
  ) {
    return null;
  }

  const skillNames = Array.isArray(value.skillNames) ? value.skillNames : [];
  const mcpServerNames = Array.isArray(value.mcpServerNames)
    ? value.mcpServerNames
    : [];

  return {
    id: value.id,
    name: value.name,
    initial: value.initial,
    source:
      value.source === 'built-in' || value.source === 'custom'
        ? value.source
        : value.id === 'primary'
          ? 'primary'
          : 'custom',
    capabilityId: value.capabilityId ?? null,
    description: value.description || '',
    prompt: value.prompt || `作为「${value.name}」助手处理用户任务。`,
    skillNames,
    skillSources: Array.isArray(value.skillSources) ? value.skillSources : [],
    mcpServerNames,
    skillLabels: Array.isArray(value.skillLabels)
      ? value.skillLabels
      : Array.isArray(value.skills)
        ? value.skills
        : skillNames,
    mcpLabels: Array.isArray(value.mcpLabels)
      ? value.mcpLabels
      : Array.isArray(value.mcps)
        ? value.mcps
        : mcpServerNames,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function loadCustomAssistantProfiles(): AssistantProfile[] {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(CUSTOM_ASSISTANTS_STORAGE_KEY) || '[]'
    );
    if (!Array.isArray(saved)) return [];

    return saved
      .map(normalizeAssistantProfile)
      .filter(
        (assistant): assistant is AssistantProfile =>
          !!assistant && assistant.id !== 'primary'
      );
  } catch {
    return [];
  }
}

export function saveCustomAssistantProfiles(
  assistants: AssistantProfile[]
): void {
  window.localStorage.setItem(
    CUSTOM_ASSISTANTS_STORAGE_KEY,
    JSON.stringify(assistants.filter((assistant) => assistant.id !== 'primary'))
  );
}

export function dispatchAssistantProfilesChanged(
  assistants: AssistantProfile[]
): void {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_PROFILES_CHANGED_EVENT, {
      detail: { assistants },
    })
  );
}

export function buildAssistantExecutionScope(
  assistant: AssistantProfile
): AssistantExecutionScopeData | undefined {
  if (assistant.source === 'primary') return undefined;

  const skillNames = assistant.skillNames || [];
  const mcpServerNames = assistant.mcpServerNames || [];
  const lines = [
    `<assistant-profile name="${assistant.name}">`,
    `[Active assistant: ${assistant.name}]`,
    assistant.prompt || '',
    `Allowed Skills: ${skillNames.length > 0 ? skillNames.join(', ') : 'none'}`,
    `Allowed MCP servers: ${
      mcpServerNames.length > 0 ? mcpServerNames.join(', ') : 'none'
    }`,
    '严格按该助手的 Skills 与 MCP 范围执行；未列出的 Skills 或 MCP 服务不可用于本次请求。',
    '</assistant-profile>',
  ].filter(Boolean);

  return {
    assistantIds: [assistant.id],
    assistantNames: [assistant.name],
    skillNames,
    mcpServerNames,
    instruction: lines.join('\n'),
  };
}
