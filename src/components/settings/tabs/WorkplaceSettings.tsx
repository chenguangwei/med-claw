import { useEffect, useState } from 'react';
import { getPathSeparator } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  Bot,
  Check,
  Code2,
  FileText,
  FolderOpen,
  Package,
  Shield,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import { API_BASE_URL } from '../constants';
import type { WorkplaceSettingsProps } from '../types';

// Helper function to open folder in system file manager
const openFolderInSystem = async (folderPath: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, expandHome: true }),
    });
    const data = await response.json();
    if (!data.success) {
      console.error('[Workspace] Failed to open folder:', data.error);
    }
  } catch (err) {
    console.error('[Workspace] Error opening folder:', err);
  }
};

interface WorkspaceOption {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
}

interface OptionCardProps {
  option: WorkspaceOption;
  selected: boolean;
  statusText: string;
  disabledText: string;
  onSelect: (option: WorkspaceOption) => void;
}

function OptionCard({
  option,
  selected,
  statusText,
  disabledText,
  onSelect,
}: OptionCardProps) {
  const Icon = option.icon;

  return (
    <button
      type="button"
      disabled={!option.enabled}
      onClick={() => onSelect(option)}
      className={cn(
        'border-border bg-card flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
        option.enabled && 'hover:border-primary/50 hover:bg-accent/40',
        selected && 'border-primary bg-primary/5 text-primary',
        !option.enabled && 'cursor-not-allowed opacity-55'
      )}
    >
      <span
        className={cn(
          'bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md',
          selected && 'bg-primary/10 text-primary'
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground flex items-center gap-2 text-sm font-semibold">
          {option.label}
          {!option.enabled && (
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
              {disabledText}
            </span>
          )}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {option.description}
        </span>
      </span>
      {selected && (
        <span className="text-primary flex shrink-0 items-center gap-1 text-xs font-medium">
          <Check className="size-4" />
          {statusText}
        </span>
      )}
    </button>
  );
}

export function WorkplaceSettings({
  settings,
  onSettingsChange,
  defaultPaths,
}: WorkplaceSettingsProps) {
  const { t } = useLanguage();
  const [pathSep, setPathSep] = useState('/');

  const agentRuntimeOptions: WorkspaceOption[] = [
    {
      id: 'codeany',
      label: t.settings.runtimeCodeAnyAgent,
      description: t.settings.runtimeCodeAnyAgentDescription,
      icon: Bot,
      enabled: true,
    },
    {
      id: 'claude-code',
      label: t.settings.runtimeClaudeCode,
      description: t.settings.runtimeClaudeCodeDescription,
      icon: Terminal,
      enabled: false,
    },
    {
      id: 'codex',
      label: t.settings.runtimeCodex,
      description: t.settings.runtimeCodexDescription,
      icon: Code2,
      enabled: false,
    },
    {
      id: 'deepagents',
      label: t.settings.runtimeDeepAgents,
      description: t.settings.runtimeDeepAgentsDescription,
      icon: Bot,
      enabled: false,
    },
  ];

  const codeEnvironmentOptions: WorkspaceOption[] = [
    {
      id: 'native',
      label: t.settings.envLocal,
      description: t.settings.envLocalDescription,
      icon: Terminal,
      enabled: true,
    },
    {
      id: 'codex',
      label: t.settings.envCodexSandbox,
      description: t.settings.envCodexSandboxDescription,
      icon: Shield,
      enabled: true,
    },
    {
      id: 'claude',
      label: t.settings.envClaudeSandbox,
      description: t.settings.envClaudeSandboxDescription,
      icon: Shield,
      enabled: true,
    },
    {
      id: 'boxlite',
      label: t.settings.envBoxlite,
      description: t.settings.envBoxliteDescription,
      icon: Package,
      enabled: false,
    },
  ];

  // Load platform-aware path separator
  useEffect(() => {
    getPathSeparator().then(setPathSep);
  }, []);

  // Get the log file path using the correct separator
  const getLogFilePath = (workDir: string) => {
    return `${workDir}${pathSep}logs${pathSep}uniins-claw.log`;
  };

  const handleAgentRuntimeSelect = (option: WorkspaceOption) => {
    if (!option.enabled) return;
    onSettingsChange({
      ...settings,
      defaultAgentRuntime: option.id,
    });
  };

  const handleCodeEnvironmentSelect = (option: WorkspaceOption) => {
    if (!option.enabled) return;
    onSettingsChange({
      ...settings,
      sandboxEnabled: true,
      defaultSandboxProvider: option.id,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.workplaceDescription}
        </p>
      </div>

      {/* Agent Runtime */}
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-foreground block text-sm font-medium">
            {t.settings.agentRuntime}
          </label>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.agentRuntimeDescription}
          </p>
        </div>
        <div className="grid gap-2">
          {agentRuntimeOptions.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              selected={settings.defaultAgentRuntime === option.id}
              statusText={t.settings.currentSelection}
              disabledText={t.settings.notConnected}
              onSelect={handleAgentRuntimeSelect}
            />
          ))}
        </div>
      </div>

      {/* Code Environment */}
      <div className="border-border flex flex-col gap-3 border-t pt-5">
        <div>
          <label className="text-foreground block text-sm font-medium">
            {t.settings.codeEnvironment}
          </label>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.codeEnvironmentDescription}
          </p>
        </div>
        <div className="grid gap-2">
          {codeEnvironmentOptions.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              selected={
                settings.sandboxEnabled &&
                settings.defaultSandboxProvider === option.id
              }
              statusText={t.settings.currentSelection}
              disabledText={t.settings.notConnected}
              onSelect={handleCodeEnvironmentSelect}
            />
          ))}
        </div>
      </div>

      {/* Working Directory */}
      <div className="border-border flex flex-col gap-2 border-t pt-5">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.workingDirectory}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.workingDirectoryDescription}
        </p>
        <div className="flex items-center gap-2">
          <div className="border-input bg-muted text-foreground flex h-10 max-w-md flex-1 items-center rounded-lg border px-3 text-sm">
            {settings.workDir || defaultPaths.workDir || 'Loading...'}
          </div>
          <button
            onClick={() =>
              openFolderInSystem(settings.workDir || defaultPaths.workDir)
            }
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
            title={t.settings.skillsOpenFolder}
          >
            <FolderOpen className="size-5" />
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t.settings.directoryStructure.replace('{path}', settings.workDir)}
        </p>
      </div>

      {/* Log File */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.logFile}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.logFileDescription}
        </p>
        <div className="flex items-center gap-2">
          <div className="border-input bg-muted text-foreground flex h-10 max-w-md flex-1 items-center rounded-lg border px-3 text-sm">
            {getLogFilePath(settings.workDir || defaultPaths.workDir)}
          </div>
          <button
            onClick={() =>
              openFolderInSystem(
                getLogFilePath(settings.workDir || defaultPaths.workDir)
              )
            }
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
            title={t.settings.logFileOpen}
          >
            <FileText className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
