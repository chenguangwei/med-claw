/**
 * Data Settings - Export, Import, and Clear Data
 */

import { useState } from 'react';
import { API_BASE_URL } from '@/config';
import {
  clearTaskData,
  getAllFiles,
  getAllSessions,
  getAllTasks,
  getMessagesByTaskId,
  replaceDatabaseSnapshot,
} from '@/shared/db/database';
import {
  clearAllSettings,
  getSettings,
  saveSettingsAsync,
  type Settings,
} from '@/shared/db/settings';
import type { DatabaseSnapshot } from '@/shared/db/types';
import { getSessionsDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';

// Check if running in Tauri environment
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

interface ExportData extends DatabaseSnapshot {
  version: number;
  exportedAt: string;
  settings?: Settings;
  memory?: MemorySnapshot;
}

interface MemorySnapshot {
  memories: unknown[];
  shortTerm: unknown[];
}

type OperationStatus = 'idle' | 'loading' | 'success' | 'error';
type ClearType = 'tasks' | 'settings' | 'all' | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string';
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'number' && Number.isFinite(record[key]);
}

function hasNullableNumber(
  record: Record<string, unknown>,
  key: string
): boolean {
  return record[key] === null || hasNumber(record, key);
}

function hasNullableString(
  record: Record<string, unknown>,
  key: string
): boolean {
  return record[key] === null || hasString(record, key);
}

function validateRows(
  name: string,
  rows: unknown[],
  isValid: (row: unknown) => boolean
): void {
  const invalidIndex = rows.findIndex((row) => !isValid(row));
  if (invalidIndex !== -1) {
    throw new Error(`Invalid ${name} row at index ${invalidIndex}`);
  }
}

function validateUniqueIds(
  name: string,
  rows: Record<string, unknown>[]
): void {
  const ids = new Set<string | number>();
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new Error(`Invalid ${name} row id`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate ${name} row id: ${id}`);
    }
    ids.add(id);
  }
}

function validateReferences(
  tasks: Record<string, unknown>[],
  messages: Record<string, unknown>[],
  files: Record<string, unknown>[],
  sessions: Record<string, unknown>[]
): void {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const taskIds = new Set(tasks.map((task) => task.id));

  const orphanTask = tasks.find((task) => !sessionIds.has(task.session_id));
  if (orphanTask) {
    throw new Error(`Task references missing session: ${orphanTask.id}`);
  }

  const orphanMessage = messages.find(
    (message) => !taskIds.has(message.task_id)
  );
  if (orphanMessage) {
    throw new Error(`Message references missing task: ${orphanMessage.id}`);
  }

  const orphanFile = files.find((file) => !taskIds.has(file.task_id));
  if (orphanFile) {
    throw new Error(`File references missing task: ${orphanFile.id}`);
  }
}

function parseMemorySnapshot(value: unknown): MemorySnapshot | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error('Invalid memory snapshot');
  }
  const { memories, shortTerm } = value;
  if (!Array.isArray(memories) || !Array.isArray(shortTerm)) {
    throw new Error('Invalid memory snapshot');
  }
  return { memories, shortTerm };
}

function parseExportData(value: unknown): ExportData {
  if (!isRecord(value)) {
    throw new Error('Invalid data format');
  }

  const {
    version,
    exportedAt,
    sessions,
    tasks,
    messages,
    files,
    settings,
    memory,
  } = value;

  if (
    (version !== 1 && version !== 2) ||
    typeof exportedAt !== 'string' ||
    !Array.isArray(sessions) ||
    !Array.isArray(tasks) ||
    !Array.isArray(messages) ||
    !Array.isArray(files)
  ) {
    throw new Error('Invalid data format');
  }

  validateRows(
    'sessions',
    sessions,
    (row) =>
      isRecord(row) &&
      hasString(row, 'id') &&
      hasString(row, 'prompt') &&
      hasNumber(row, 'task_count') &&
      hasString(row, 'created_at') &&
      hasString(row, 'updated_at')
  );
  validateRows(
    'tasks',
    tasks,
    (row) =>
      isRecord(row) &&
      hasString(row, 'id') &&
      hasString(row, 'session_id') &&
      hasNumber(row, 'task_index') &&
      hasString(row, 'prompt') &&
      hasString(row, 'status') &&
      hasNullableNumber(row, 'cost') &&
      hasNullableNumber(row, 'duration') &&
      hasString(row, 'created_at') &&
      hasString(row, 'updated_at')
  );
  validateRows(
    'messages',
    messages,
    (row) =>
      isRecord(row) &&
      hasNumber(row, 'id') &&
      hasString(row, 'task_id') &&
      hasString(row, 'type') &&
      hasNullableString(row, 'content') &&
      hasNullableString(row, 'tool_name') &&
      hasNullableString(row, 'tool_input') &&
      hasNullableString(row, 'tool_output') &&
      hasNullableString(row, 'tool_use_id') &&
      hasNullableString(row, 'subtype') &&
      hasNullableString(row, 'error_message') &&
      hasNullableString(row, 'attachments') &&
      hasString(row, 'created_at')
  );
  validateRows(
    'files',
    files,
    (row) =>
      isRecord(row) &&
      hasNumber(row, 'id') &&
      hasString(row, 'task_id') &&
      hasString(row, 'name') &&
      hasString(row, 'type') &&
      hasString(row, 'path') &&
      hasNullableString(row, 'preview') &&
      hasNullableString(row, 'thumbnail') &&
      (typeof row.is_favorite === 'boolean' || hasNumber(row, 'is_favorite')) &&
      hasString(row, 'created_at')
  );

  const sessionRows = sessions as Record<string, unknown>[];
  const taskRows = tasks as Record<string, unknown>[];
  const messageRows = messages as Record<string, unknown>[];
  const fileRows = files as Record<string, unknown>[];
  validateUniqueIds('sessions', sessionRows);
  validateUniqueIds('tasks', taskRows);
  validateUniqueIds('messages', messageRows);
  validateUniqueIds('files', fileRows);
  validateReferences(taskRows, messageRows, fileRows, sessionRows);

  return {
    version,
    exportedAt,
    sessions: sessions as ExportData['sessions'],
    tasks: tasks as ExportData['tasks'],
    messages: messages as ExportData['messages'],
    files: (files as ExportData['files']).map((file) => ({
      ...file,
      is_favorite: Boolean(file.is_favorite),
    })),
    settings:
      isRecord(settings) && !Array.isArray(settings)
        ? (settings as unknown as Settings)
        : undefined,
    memory: parseMemorySnapshot(memory),
  };
}

async function fetchMemorySnapshot(): Promise<MemorySnapshot> {
  const response = await fetch(`${API_BASE_URL}/memory/snapshot`);
  if (!response.ok) {
    throw new Error('Failed to export Agent memory');
  }
  const data = (await response.json()) as { memory?: MemorySnapshot };
  return parseMemorySnapshot(data.memory) || { memories: [], shortTerm: [] };
}

async function importMemorySnapshot(memory?: MemorySnapshot): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/memory/snapshot`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memory: memory || { memories: [], shortTerm: [] } }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error || 'Failed to import Agent memory');
  }
}

async function clearMemorySnapshot(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/memory`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('Failed to clear Agent memory');
  }
}

async function clearShortTermMemorySnapshot(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/memory/short-term`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to clear session memory');
  }
}

export function DataSettings() {
  const { t } = useLanguage();
  const [exportStatus, setExportStatus] = useState<OperationStatus>('idle');
  const [importStatus, setImportStatus] = useState<OperationStatus>('idle');
  const [clearStatus, setClearStatus] = useState<OperationStatus>('idle');
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [confirmClearType, setConfirmClearType] = useState<ClearType>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Export all data
  const handleExport = async () => {
    setExportStatus('loading');
    setErrorMessage('');

    try {
      // Gather all data
      const sessions = await getAllSessions();
      const tasks = await getAllTasks();
      const files = await getAllFiles();
      const settings = getSettings();
      const memory = await fetchMemorySnapshot();

      // Get messages for each task
      const allMessages: DatabaseSnapshot['messages'] = [];
      for (const task of tasks) {
        const messages = await getMessagesByTaskId(task.id);
        allMessages.push(...messages);
      }

      const exportData: ExportData = {
        version: 2,
        exportedAt: new Date().toISOString(),
        sessions,
        tasks,
        messages: allMessages,
        files,
        settings,
        memory,
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const filename = `uniins-claw-backup-${new Date().toISOString().split('T')[0]}.json`;

      // Use Tauri native dialog
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');

      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: filename,
      });

      if (filePath) {
        await writeTextFile(filePath, jsonString);
        setExportStatus('success');
        setTimeout(() => setExportStatus('idle'), 2000);
      } else {
        // User cancelled
        setExportStatus('idle');
      }
    } catch (error) {
      console.error('[DataSettings] Export failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Export failed');
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 3000);
    }
  };

  // Import data from file
  const handleImport = async () => {
    setImportStatus('loading');
    setErrorMessage('');

    try {
      // Use Tauri native dialog
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');

      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });

      if (!filePath) {
        // User cancelled
        setImportStatus('idle');
        return;
      }

      const content = await readTextFile(filePath as string);
      const data = parseExportData(JSON.parse(content));

      await replaceDatabaseSnapshot({
        sessions: data.sessions,
        tasks: data.tasks,
        messages: data.messages,
        files: data.files,
      });

      // Import settings if included
      if (data.settings) {
        await saveSettingsAsync(data.settings);
      }
      await importMemorySnapshot(data.memory);

      setImportStatus('success');
      setTimeout(() => {
        setImportStatus('idle');
        // Reload page to apply imported settings
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('[DataSettings] Import failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Import failed');
      setImportStatus('error');
      setTimeout(() => setImportStatus('idle'), 3000);
    }
  };

  // Clear workspace files (sessions directory)
  const clearWorkspaceFiles = async () => {
    if (!isTauri()) return;

    try {
      const sessionsDir = await getSessionsDir();
      const { remove, exists } = await import('@tauri-apps/plugin-fs');

      // Check if sessions directory exists
      const dirExists = await exists(sessionsDir);
      if (dirExists) {
        // Remove the entire sessions directory recursively
        await remove(sessionsDir, { recursive: true });
        console.log('[DataSettings] Cleared workspace files:', sessionsDir);
      }
    } catch (error) {
      console.warn('[DataSettings] Failed to clear workspace files:', error);
      // Don't throw - continue with database cleanup even if file cleanup fails
    }
  };

  // Clear data
  const handleClear = async (type: ClearType) => {
    if (!type) return;

    setClearStatus('loading');
    setErrorMessage('');
    setShowClearDialog(false);
    setConfirmClearType(null);

    try {
      if (type === 'settings') {
        // Clear settings only
        await clearAllSettings();
      } else if (type === 'tasks') {
        // Clear workspace files first
        await clearWorkspaceFiles();

        await clearTaskData();
        await clearShortTermMemorySnapshot();
      } else if (type === 'all') {
        // Clear workspace files first
        await clearWorkspaceFiles();

        await clearTaskData();
        await clearMemorySnapshot();

        // Clear settings
        await clearAllSettings();
      }

      setClearStatus('success');
      setTimeout(() => {
        setClearStatus('idle');
        // Reload page to reflect changes
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('[DataSettings] Clear failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Clear failed');
      setClearStatus('error');
      setTimeout(() => setClearStatus('idle'), 3000);
    }
  };

  // Handle clear option click - show confirmation
  const handleClearOptionClick = (type: ClearType) => {
    setConfirmClearType(type);
  };

  // Get confirmation message based on clear type
  const getConfirmMessage = (type: ClearType): string => {
    switch (type) {
      case 'tasks':
        return (
          t.settings.dataClearTasksConfirm ||
          'Are you sure you want to delete all tasks, messages, and session memory? This action cannot be undone.'
        );
      case 'settings':
        return (
          t.settings.dataClearSettingsConfirm ||
          'Are you sure you want to reset all settings to defaults? This action cannot be undone.'
        );
      case 'all':
        return (
          t.settings.dataClearAllConfirm ||
          'Are you sure you want to delete ALL data including tasks, messages, settings, and Agent memory? This action cannot be undone.'
        );
      default:
        return '';
    }
  };

  const getButtonContent = (
    status: OperationStatus,
    icon: React.ReactNode,
    label: string,
    loadingLabel: string
  ) => {
    if (status === 'loading') {
      return (
        <>
          <Loader2 className="size-4 animate-spin" />
          <span>{loadingLabel}</span>
        </>
      );
    }
    if (status === 'success') {
      return (
        <>
          <CheckCircle2 className="size-4 text-green-500" />
          <span>{t.settings.dataSuccess || 'Success'}</span>
        </>
      );
    }
    return (
      <>
        {icon}
        <span>{label}</span>
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Description */}
      <p className="text-muted-foreground text-sm">
        {t.settings.dataDescription ||
          'Manage your data: export backups, import data, or clear all data.'}
      </p>

      {/* Export Data */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataExport || 'Export Data'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataExportDescription ||
                'Export all tasks, messages, settings, and Agent memory to a JSON file.'}
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exportStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {getButtonContent(
              exportStatus,
              <Download className="size-4" />,
              t.settings.dataExportButton || 'Export',
              t.settings.dataExporting || 'Exporting...'
            )}
          </button>
        </div>
      </div>

      {/* Import Data */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataImport || 'Import Data'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataImportDescription ||
                'Import data from a previously exported JSON file.'}
            </p>
          </div>
          <button
            onClick={handleImport}
            disabled={importStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'border-border text-foreground hover:bg-accent border',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {getButtonContent(
              importStatus,
              <Upload className="size-4" />,
              t.settings.dataImportButton || 'Import',
              t.settings.dataImporting || 'Importing...'
            )}
          </button>
        </div>
      </div>

      {/* Clear Data */}
      <div className="border-border rounded-lg border border-red-500/20 bg-red-500/5 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataClear || 'Clear Data'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataClearDescription ||
                'Permanently delete all data. This action cannot be undone.'}
            </p>
          </div>
          <button
            onClick={() => setShowClearDialog(true)}
            disabled={clearStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-red-500/10 text-red-500 hover:bg-red-500/20',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {getButtonContent(
              clearStatus,
              <Trash2 className="size-4" />,
              t.settings.dataClearButton || 'Clear',
              t.settings.dataClearing || 'Clearing...'
            )}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-red-500">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="text-sm">{errorMessage}</span>
        </div>
      )}

      {/* Clear Confirmation Dialog */}
      {showClearDialog && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="border-border bg-background mx-4 w-full max-w-md rounded-xl border p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle className="size-5" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                {t.settings.dataClearConfirmTitle || 'Clear Data'}
              </h3>
            </div>

            <p className="text-muted-foreground mb-6 text-sm">
              {t.settings.dataClearConfirmDescription ||
                'Choose what data you want to clear:'}
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleClearOptionClick('tasks')}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border-border hover:bg-accent border'
                )}
              >
                <div>
                  <div className="text-foreground font-medium">
                    {t.settings.dataClearTasksOnly || 'Clear Tasks Only'}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearTasksOnlyDescription ||
                      'Delete all tasks, messages, and session memory; keep settings'}
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleClearOptionClick('settings')}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border-border hover:bg-accent border'
                )}
              >
                <div>
                  <div className="text-foreground font-medium">
                    {t.settings.dataClearSettingsOnly || 'Clear Settings Only'}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearSettingsOnlyDescription ||
                      'Reset all settings to defaults, keep tasks'}
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleClearOptionClick('all')}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                )}
              >
                <div>
                  <div className="font-medium text-red-500">
                    {t.settings.dataClearAll || 'Clear All Data'}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearAllDescription ||
                      'Delete all tasks, messages, settings, and Agent memory'}
                  </div>
                </div>
              </button>
            </div>

            <button
              onClick={() => setShowClearDialog(false)}
              className="text-muted-foreground hover:text-foreground mt-4 w-full py-2 text-center text-sm transition-colors"
            >
              {t.settings.dataCancel || 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmClearType && (
        <div className="bg-background/80 fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm">
          <div className="border-border bg-background mx-4 w-full max-w-md rounded-xl border p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle className="size-5" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                {t.settings.dataConfirmTitle || 'Confirm'}
              </h3>
            </div>

            <p className="text-muted-foreground mb-6 text-sm">
              {getConfirmMessage(confirmClearType)}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmClearType(null)}
                className={cn(
                  'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  'border-border text-foreground hover:bg-accent border'
                )}
              >
                {t.settings.dataCancel || 'Cancel'}
              </button>
              <button
                onClick={() => handleClear(confirmClearType)}
                className={cn(
                  'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  'bg-red-500 text-white hover:bg-red-600'
                )}
              >
                {t.settings.dataConfirmClear || 'Yes, Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
