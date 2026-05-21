/**
 * Unified Chat Input Component
 *
 * Used for both the home page initial input and task detail reply input.
 * Supports text input, file attachments, image paste, and keyboard shortcuts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/config';
import { getSettings } from '@/shared/db/settings';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ArrowUp,
  BadgeDollarSign,
  BriefcaseBusiness,
  CalendarCheck2,
  Cpu,
  FileCheck2,
  FileText,
  MessageCircle,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ChatMode = 'auto' | 'chat' | 'task';

// Attachment type for files and images
export interface Attachment {
  id: string;
  file: File;
  type: 'image' | 'file';
  preview?: string; // Data URL for image preview
  nativePath?: string; // Native file path from Tauri drag-drop
}

export interface CategoryTag {
  icon: React.ReactNode;
  label: string;
  onClose: () => void;
}

interface SkillOption {
  id: string;
  name: string;
  description?: string;
  source: 'claude' | 'workany';
  path: string;
  enabled: boolean;
}

interface CapabilityOption {
  id: string;
  label: string;
  instruction: string;
  icon: React.ComponentType<{ className?: string }>;
}

const capabilityOptions: CapabilityOption[] = [
  {
    id: 'sales',
    label: '销售助手',
    instruction: '销售助手',
    icon: BadgeDollarSign,
  },
  {
    id: 'meeting',
    label: '会议助手',
    instruction: '会议助手',
    icon: CalendarCheck2,
  },
  {
    id: 'office',
    label: '办公助手',
    instruction: '办公助手',
    icon: BriefcaseBusiness,
  },
  {
    id: 'document-review',
    label: '文档审核',
    instruction: '文档审核',
    icon: FileCheck2,
  },
];

export interface ChatInputProps {
  /** Placeholder text */
  placeholder?: string;
  /** Whether the agent is running */
  isRunning?: boolean;
  /** Callback when submitting with text, attachments, and mode */
  onSubmit: (
    text: string,
    attachments?: MessageAttachment[],
    mode?: ChatMode
  ) => Promise<void>;
  /** Callback when stop button is clicked */
  onStop?: () => void;
  /** Variant: 'home' for larger home page style, 'reply' for compact reply style */
  variant?: 'home' | 'reply';
  /** Additional class names */
  className?: string;
  /** Whether to disable the input */
  disabled?: boolean;
  /** Auto focus on mount */
  autoFocus?: boolean;
  /** Externally controlled value */
  externalValue?: string;
  /** Callback when external value is consumed */
  onExternalValueConsumed?: () => void;
  /** Category tag shown next to the + button */
  categoryTag?: CategoryTag;
  /** Default mode for the mode selector */
  defaultMode?: ChatMode;
}

// Generate unique ID for attachments
const generateId = () =>
  `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// Module-level guard: prevent the same drop event from being handled by multiple ChatInput instances
let lastDropTimestamp = 0;

// Check if file is an image (by MIME type or file extension)
const isImageFile = (file: File) => {
  // Check MIME type first
  if (file.type.startsWith('image/')) {
    return true;
  }
  // Fallback: check file extension for common image formats
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(
    ext || ''
  );
};

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTopLevelYamlValue(
  frontmatter: string,
  key: string
): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  const keyPattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(keyPattern);
    if (!match) continue;

    const inlineValue = match[1].trim();
    if (inlineValue && inlineValue !== '|' && inlineValue !== '>') {
      return stripYamlQuotes(inlineValue);
    }

    const blockLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^[A-Za-z0-9_-]+:\s*/.test(line)) break;
      blockLines.push(line.replace(/^\s+/, ''));
    }

    return stripYamlQuotes(blockLines.join('\n').trim());
  }

  return undefined;
}

function parseSkillMdFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};

  const frontmatter = frontmatterMatch[1];
  return {
    name: readTopLevelYamlValue(frontmatter, 'name'),
    description: readTopLevelYamlValue(frontmatter, 'description'),
  };
}

// Create preview for image files with error handling
const createImagePreview = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
};

export function ChatInput({
  placeholder = 'Type a message...',
  isRunning = false,
  onSubmit,
  onStop,
  variant = 'reply',
  className,
  disabled = false,
  autoFocus = false,
  externalValue,
  onExternalValueConsumed,
  categoryTag,
  defaultMode = 'auto',
}: ChatInputProps) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>(defaultMode);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>(null);
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<string[]>(
    []
  );
  const [highlightedSkillIndex, setHighlightedSkillIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const prevIsRunningRef = useRef(isRunning);
  const skillsLoadedRef = useRef(false);

  const slashMatch = !selectedSkill
    ? value.match(/^\/([A-Za-z0-9_.-]*)$/)
    : null;
  const skillQuery = slashMatch?.[1]?.toLowerCase() ?? '';
  const shouldShowSkillMenu = !!slashMatch && !isRunning && !disabled;
  const filteredSkills = skills
    .filter((skill) => skill.enabled)
    .filter((skill) => {
      if (!skillQuery) return true;
      return (
        skill.name.toLowerCase().includes(skillQuery) ||
        skill.description?.toLowerCase().includes(skillQuery)
      );
    })
    .slice(0, 8);
  const selectedCapabilities = capabilityOptions.filter((capability) =>
    selectedCapabilityIds.includes(capability.id)
  );
  const visibleCapabilities =
    selectedCapabilities.length > 0 ? selectedCapabilities : capabilityOptions;

  // Sync external value into the input
  useEffect(() => {
    if (externalValue !== undefined && externalValue !== '') {
      setValue(externalValue);
      onExternalValueConsumed?.();
      // Focus and move cursor to end
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.selectionStart = externalValue.length;
          textareaRef.current.selectionEnd = externalValue.length;
        }
      }, 0);
    }
  }, [externalValue, onExternalValueConsumed]);

  // Auto focus on mount if autoFocus is true
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Auto focus when agent stops running (reply completed)
  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning && textareaRef.current) {
      textareaRef.current.focus();
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning]);

  const loadSkills = useCallback(async () => {
    if (skillsLoadedRef.current || skillsLoading) return;

    setSkillsLoading(true);
    try {
      const settings = getSettings();
      if (settings.skillsEnabled === false) {
        setSkills([]);
        skillsLoadedRef.current = true;
        return;
      }

      const dirsResponse = await fetch(`${API_BASE_URL}/files/skills-dir`);
      const dirsData = await dirsResponse.json();
      const loadedSkills: SkillOption[] = [];
      const seen = new Set<string>();

      const loadSkillDirectory = async (
        rootPath: string,
        idPrefix: string,
        source: 'claude' | 'workany',
        enabled: boolean
      ) => {
        if (!enabled) return;

        const filesResponse = await fetch(`${API_BASE_URL}/files/readdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: rootPath, maxDepth: 1 }),
        });
        const filesData = await filesResponse.json();
        if (!filesData.success || !filesData.files) return;

        for (const folder of filesData.files as {
          name: string;
          path: string;
          isDir: boolean;
        }[]) {
          if (!folder.isDir) continue;

          let skillName = folder.name;
          let description = '';
          try {
            const mdResponse = await fetch(`${API_BASE_URL}/files/read`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: `${folder.path}/SKILL.md` }),
            });
            const mdData = await mdResponse.json();
            if (mdData.success && mdData.content) {
              const frontmatter = parseSkillMdFrontmatter(mdData.content);
              skillName = frontmatter.name || skillName;
              description = frontmatter.description || '';
            }
          } catch {
            // Ignore unreadable skill metadata.
          }

          const key = skillName.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          loadedSkills.push({
            id: `${idPrefix}-${folder.name}`,
            name: skillName,
            description,
            source,
            path: folder.path,
            enabled: true,
          });
        }
      };

      for (const dir of (dirsData.directories || []) as {
        name: string;
        path: string;
        exists: boolean;
      }[]) {
        if (!dir.exists) continue;
        const isUserDir = dir.name === 'claude';
        await loadSkillDirectory(
          dir.path,
          dir.name,
          isUserDir ? 'claude' : 'workany',
          isUserDir
            ? settings.skillsUserDirEnabled !== false
            : settings.skillsAppDirEnabled !== false
        );
      }

      if (settings.skillsPath) {
        const isDefaultDir = (dirsData.directories || []).some(
          (dir: { path: string }) => dir.path === settings.skillsPath
        );
        if (!isDefaultDir) {
          await loadSkillDirectory(
            settings.skillsPath,
            'custom',
            'workany',
            true
          );
        }
      }

      loadedSkills.sort((a, b) => a.name.localeCompare(b.name));
      setSkills(loadedSkills);
      skillsLoadedRef.current = true;
    } catch (error) {
      console.error('[ChatInput] Failed to load skills:', error);
      setSkills([]);
    } finally {
      setSkillsLoading(false);
    }
  }, [skillsLoading]);

  useEffect(() => {
    if (shouldShowSkillMenu) {
      loadSkills();
      setHighlightedSkillIndex(0);
    }
  }, [loadSkills, shouldShowSkillMenu, skillQuery]);

  // Add files to attachments
  // forceImage: when true, treat all files as images (e.g., from clipboard paste)
  const addFiles = useCallback(
    async (files: FileList | File[], forceImage = false) => {
      const fileArray = Array.from(files);
      const newAttachments: Attachment[] = [];

      console.log(
        '[ChatInput] addFiles called with',
        fileArray.length,
        'files, forceImage:',
        forceImage
      );

      for (const file of fileArray) {
        const isImage = forceImage || isImageFile(file);
        console.log(
          `[ChatInput] Processing file: name=${file.name}, type=${file.type}, size=${file.size}, isImage=${isImage}`
        );

        const attachment: Attachment = {
          id: generateId(),
          file,
          type: isImage ? 'image' : 'file',
        };

        if (isImage) {
          try {
            attachment.preview = await createImagePreview(file);
            console.log(
              `[ChatInput] Created preview for ${file.name}, previewLength=${attachment.preview?.length || 0}`
            );
          } catch (error) {
            console.error('[ChatInput] Failed to create image preview:', error);
            // Keep as image type but with empty preview - it will show file icon
          }
        }

        newAttachments.push(attachment);
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    []
  );

  // Remove attachment
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  // Handle paste event for image upload
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        // Pass forceImage=true since we've already verified these are images
        await addFiles(imageFiles, true);
      }
    },
    [addFiles]
  );

  // Add files from native file paths (Tauri drag-drop)
  const addFilesFromPaths = useCallback(
    async (paths: string[]) => {
      if (isRunning || disabled) return;

      const newAttachments: Attachment[] = [];
      for (const filePath of paths) {
        const name =
          filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const imageExts = [
          'jpg',
          'jpeg',
          'png',
          'gif',
          'webp',
          'bmp',
          'svg',
          'ico',
        ];
        const isImage = imageExts.includes(ext);

        // Create a minimal File object with the path stored in name
        // The actual content will be read later via Tauri FS when converting to MessageAttachment
        const mimeType = isImage
          ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
          : ext === 'pdf'
            ? 'application/pdf'
            : ext === 'json'
              ? 'application/json'
              : ext === 'csv'
                ? 'text/csv'
                : 'application/octet-stream';

        const attachment: Attachment = {
          id: generateId(),
          file: new File([], name, { type: mimeType }),
          type: isImage ? 'image' : 'file',
          nativePath: filePath,
        };

        if (isImage) {
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(filePath);
            const blob = new Blob([bytes], { type: mimeType });
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            attachment.preview = dataUrl;
            // Also create a proper File object with data for later use
            attachment.file = new File([bytes], name, { type: mimeType });
          } catch (error) {
            console.error('[ChatInput] Failed to read image:', error);
          }
        } else {
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(filePath);
            attachment.file = new File([bytes], name, { type: mimeType });
          } catch (error) {
            console.error('[ChatInput] Failed to read file:', error);
          }
        }

        newAttachments.push(attachment);
      }

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    },
    [isRunning, disabled]
  );

  // Tauri native drag-drop event listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupDragDrop = async () => {
      // Only in Tauri environment
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window))
        return;

      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const webview = getCurrentWebview();

        unlisten = await webview.onDragDropEvent((event) => {
          const container = containerRef.current;
          if (!container) return;

          const rect = container.getBoundingClientRect();

          if (event.payload.type === 'enter') {
            // Files are being dragged into the window — no position check needed yet
            setIsDragging(true);
          } else if (event.payload.type === 'over') {
            const { x, y } = event.payload.position;
            const isOver =
              x >= rect.left &&
              x <= rect.right &&
              y >= rect.top &&
              y <= rect.bottom;
            setIsDragging(isOver);
          } else if (event.payload.type === 'drop') {
            setIsDragging(false);
            const now = Date.now();
            const { x, y } = event.payload.position;
            const isOver =
              x >= rect.left &&
              x <= rect.right &&
              y >= rect.top &&
              y <= rect.bottom;
            // Guard: only one ChatInput instance handles each drop
            if (
              isOver &&
              event.payload.paths.length > 0 &&
              now - lastDropTimestamp > 100
            ) {
              lastDropTimestamp = now;
              addFilesFromPaths(event.payload.paths);
            }
          } else if (event.payload.type === 'leave') {
            setIsDragging(false);
          }
        });
      } catch (error) {
        console.error('[ChatInput] Failed to setup Tauri drag-drop:', error);
      }
    };

    setupDragDrop();
    return () => {
      unlisten?.();
    };
  }, [addFilesFromPaths]);

  // Open file picker
  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Read a File object as base64 data URL
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  // Convert attachments to MessageAttachment format
  const convertToMessageAttachments = async (): Promise<
    MessageAttachment[] | undefined
  > => {
    if (attachments.length === 0) return undefined;

    const result: MessageAttachment[] = [];

    for (const a of attachments) {
      // For images, only include if preview exists and has data
      if (a.type === 'image') {
        if (!a.preview || a.preview.length === 0) {
          console.warn(
            `[ChatInput] Skipping image ${a.file.name}: no preview data`
          );
          continue;
        }
      }

      // Determine mimeType
      let mimeType = a.file.type;
      if (!mimeType && a.type === 'image') {
        mimeType = 'image/png';
      }

      // Read file content as base64 for file attachments
      let data = a.preview || '';
      if (a.type === 'file' && !data) {
        try {
          data = await readFileAsBase64(a.file);
          console.log(
            `[ChatInput] Read file ${a.file.name}: ${data.length} chars`
          );
        } catch (error) {
          console.error(
            `[ChatInput] Failed to read file ${a.file.name}:`,
            error
          );
        }
      }

      result.push({
        id: a.id,
        type: a.type,
        name: a.file.name,
        data,
        mimeType,
      });
    }

    // Debug logging
    console.log('[ChatInput] Converting attachments:', result.length);
    result.forEach((a, i) => {
      console.log(
        `[ChatInput] Attachment ${i}: type=${a.type}, hasData=${!!a.data}, dataLength=${a.data?.length || 0}, mimeType=${a.mimeType}`
      );
    });

    return result.length > 0 ? result : undefined;
  };

  const handleSubmit = async () => {
    if (
      (value.trim() ||
        selectedSkill ||
        selectedCapabilityIds.length > 0 ||
        attachments.length > 0) &&
      !isRunning &&
      !disabled
    ) {
      const trimmedValue = value.trim();
      const capabilityInstruction =
        selectedCapabilities.length > 0
          ? `使用以下能力：${selectedCapabilities.map((capability) => capability.instruction).join('、')}。`
          : '';
      const text = selectedSkill
        ? `/${selectedSkill.name}${capabilityInstruction ? ` ${capabilityInstruction}` : ''}${trimmedValue ? ` ${trimmedValue}` : ''}`
        : [capabilityInstruction, trimmedValue].filter(Boolean).join('\n');
      const messageAttachments = await convertToMessageAttachments();

      setValue('');
      setAttachments([]);
      setSelectedSkill(null);
      setSelectedCapabilityIds([]);
      await onSubmit(text, messageAttachments, chatMode);
    }
  };

  const selectCapability = useCallback((capabilityId: string) => {
    setSelectedCapabilityIds([capabilityId]);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const removeSelectedCapability = useCallback(() => {
    setSelectedCapabilityIds([]);
  }, []);

  const selectSkill = useCallback((skill: SkillOption) => {
    setSelectedSkill(skill);
    setValue('');
    setHighlightedSkillIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const removeSelectedSkill = useCallback(() => {
    setSelectedSkill(null);
    setValue('/');
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.selectionStart = 1;
        textareaRef.current.selectionEnd = 1;
      }
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldShowSkillMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedSkillIndex((current) =>
          filteredSkills.length === 0
            ? 0
            : (current + 1) % filteredSkills.length
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedSkillIndex((current) =>
          filteredSkills.length === 0
            ? 0
            : (current - 1 + filteredSkills.length) % filteredSkills.length
        );
        return;
      }
      if (
        (e.key === 'Enter' || e.key === 'Tab') &&
        filteredSkills[highlightedSkillIndex]
      ) {
        e.preventDefault();
        selectSkill(filteredSkills[highlightedSkillIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setValue('');
        return;
      }
    }

    if (
      selectedSkill &&
      value.length === 0 &&
      e.key === 'Backspace' &&
      !isComposingRef.current
    ) {
      e.preventDefault();
      setSelectedSkill(null);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = () => {
    setTimeout(() => {
      isComposingRef.current = false;
    }, 10);
  };

  const isHome = variant === 'home';
  const canSubmit =
    (value.trim() ||
      selectedSkill ||
      selectedCapabilityIds.length > 0 ||
      attachments.length > 0) &&
    !disabled;

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Calculate the new height
    const maxHeight = isHome ? 200 : 120; // Max height in pixels
    const minHeight = isHome ? 56 : 20; // Min height in pixels (home: taller default)
    const newHeight = Math.min(
      Math.max(textarea.scrollHeight, minHeight),
      maxHeight
    );

    textarea.style.height = `${newHeight}px`;

    // Enable/disable overflow based on content height
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, isHome]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full transition-colors',
        isHome
          ? 'rounded-2xl border border-transparent bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,252,248,0.94))_padding-box,linear-gradient(135deg,rgba(249,115,22,0.28),rgba(124,58,237,0.16),rgba(6,182,212,0.2))_border-box] p-4 shadow-[0_18px_42px_rgba(15,23,42,0.09),0_1px_0_rgba(255,255,255,0.9)_inset] focus-within:shadow-[0_20px_48px_rgba(249,115,22,0.12),0_0_0_3px_rgba(249,115,22,0.08)]'
          : 'rounded-xl border border-transparent bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,253,250,0.94))_padding-box,linear-gradient(135deg,rgba(249,115,22,0.18),rgba(124,58,237,0.1),rgba(226,232,240,0.9))_border-box] p-3 shadow-sm',
        isDragging && 'bg-primary/5 border-primary/50 border-2',
        className
      )}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit]">
          <div className="text-primary/70 flex items-center gap-2 text-sm font-medium">
            <Paperclip className="size-4" />
            <span>{t.home.dropFilesHere || 'Drop files here'}</span>
          </div>
        </div>
      )}
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.csv,.xlsx,.xls,.pptx,.ppt"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Attachment Preview */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group border-border/50 bg-muted/50 relative flex items-center gap-2 rounded-lg border px-3 py-2"
            >
              {attachment.type === 'image' && attachment.preview ? (
                <img
                  src={attachment.preview}
                  alt={attachment.file.name}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className="bg-muted flex h-10 w-10 items-center justify-center rounded">
                  <FileText className="text-muted-foreground h-5 w-5" />
                </div>
              )}
              <span className="text-foreground max-w-[120px] truncate text-sm">
                {attachment.file.name}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="bg-foreground text-background absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Skill Suggestions */}
      {shouldShowSkillMenu && (
        <div className="border-border bg-popover absolute right-3 bottom-full left-3 z-30 mb-2 overflow-hidden rounded-lg border shadow-lg">
          <div className="border-border text-muted-foreground flex items-center justify-between border-b px-3 py-2 text-xs">
            <span>Skills</span>
            <span>Enter to select</span>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {skillsLoading ? (
              <div className="text-muted-foreground px-3 py-3 text-sm">
                Loading skills...
              </div>
            ) : filteredSkills.length > 0 ? (
              filteredSkills.map((skill, index) => (
                <button
                  key={skill.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSkill(skill)}
                  onMouseEnter={() => setHighlightedSkillIndex(index)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors',
                    index === highlightedSkillIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/70'
                  )}
                >
                  <span className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded">
                    <Sparkles className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">
                      /{skill.name}
                    </span>
                    {skill.description && (
                      <span className="text-muted-foreground mt-0.5 block max-h-10 overflow-hidden text-xs leading-5">
                        {skill.description}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground mt-1 rounded border px-1.5 py-0.5 text-[10px] uppercase">
                    {skill.source}
                  </span>
                </button>
              ))
            ) : (
              <div className="text-muted-foreground px-3 py-3 text-sm">
                No matching skills
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected Skill Token */}
      {selectedSkill && (
        <div className="mb-2 flex flex-wrap gap-2">
          <span className="border-primary/20 bg-primary/10 text-primary inline-flex h-8 max-w-full items-center gap-2 rounded-md border px-2.5 text-sm font-medium">
            <Sparkles className="size-3.5 shrink-0" />
            <span className="truncate">/{selectedSkill.name}</span>
            <button
              type="button"
              onClick={removeSelectedSkill}
              className="text-primary/60 hover:text-primary -mr-1 rounded p-0.5 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </span>
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPaste={handlePaste}
        placeholder={selectedSkill ? 'Add arguments...' : placeholder}
        className={cn(
          'text-foreground placeholder:text-muted-foreground w-full resize-none border-0 bg-transparent focus:outline-none',
          isHome ? 'text-base' : 'px-1 text-sm'
        )}
        style={{
          minHeight: isHome ? '56px' : '20px',
          maxHeight: isHome ? '200px' : '120px',
          overflowY: 'hidden',
        }}
        rows={1}
        disabled={isRunning || disabled}
      />

      {/* Bottom Actions */}
      <div
        className={cn(
          'flex items-center justify-between',
          isHome ? 'mt-3' : 'mt-2'
        )}
      >
        {/* Add Button + Category Tag */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              disabled={isRunning || disabled}
              className={cn(
                'flex shrink-0 items-center justify-center transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                isHome
                  ? 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground size-8 rounded-full border'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground size-7 rounded-md'
              )}
            >
              <Plus className={isHome ? 'size-4' : 'size-4'} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="z-50 w-56"
            >
              <DropdownMenuItem
                onSelect={openFilePicker}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Paperclip className="size-4" />
                <span>{t.home.addFilesOrPhotos}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mode Selector */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              disabled={isRunning || disabled}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full border transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                isHome ? 'h-8 px-2.5 text-xs' : 'h-7 px-2 text-xs'
              )}
            >
              {chatMode === 'auto' && <Sparkles className="size-3.5" />}
              {chatMode === 'chat' && <MessageCircle className="size-3.5" />}
              {chatMode === 'task' && <Cpu className="size-3.5" />}
              <span>
                {chatMode === 'auto' && t.home.modeAuto}
                {chatMode === 'chat' && t.home.modeChat}
                {chatMode === 'task' && t.home.modeTask}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="z-50 w-48"
            >
              <DropdownMenuLabel>{t.home.modeLabel}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={chatMode}
                onValueChange={(v) => setChatMode(v as ChatMode)}
              >
                <DropdownMenuRadioItem value="auto" className="cursor-pointer">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5" />
                    <span>{t.home.modeAuto}</span>
                  </div>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="chat" className="cursor-pointer">
                  <div className="flex items-center gap-1.5">
                    <MessageCircle className="size-3.5" />
                    <span>{t.home.modeChat}</span>
                  </div>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="task" className="cursor-pointer">
                  <div className="flex items-center gap-1.5">
                    <Cpu className="size-3.5" />
                    <span>{t.home.modeTask}</span>
                  </div>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Capability chips */}
          {isHome &&
            visibleCapabilities.map((capability) => {
              const Icon = capability.icon;
              const isSelected = selectedCapabilityIds.includes(capability.id);

              if (isSelected) {
                return (
                  <button
                    key={capability.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={removeSelectedCapability}
                    disabled={isRunning || disabled}
                    aria-label={`删除${capability.label}`}
                    className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-[0_6px_18px_rgba(249,115,22,0.12)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span>{capability.label}</span>
                    <span
                      aria-hidden="true"
                      className="text-primary/60 -mr-1 rounded-full p-0.5"
                    >
                      <X className="size-3.5" />
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={capability.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectCapability(capability.id)}
                  disabled={isRunning || disabled}
                  aria-label={`选择${capability.label}`}
                  className="border-border bg-background text-muted-foreground hover:border-primary/35 hover:bg-primary/10 hover:text-primary inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span>{capability.label}</span>
                </button>
              );
            })}

          {/* Category Tag */}
          {categoryTag && (
            <span
              className={cn(
                'bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full font-medium',
                isHome ? 'h-8 px-3 text-xs' : 'h-7 px-2.5 text-xs'
              )}
            >
              {categoryTag.icon}
              {categoryTag.label}
              <button
                type="button"
                onClick={categoryTag.onClose}
                className="text-primary/60 hover:text-primary -mr-0.5 rounded-full transition-colors"
              >
                <X className="size-3.5" />
              </button>
            </span>
          )}
        </div>

        {/* Submit/Stop Button */}
        <div className="flex items-center gap-1">
          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              className={cn(
                'flex items-center justify-center rounded-full transition-colors',
                isHome
                  ? 'size-8 bg-red-500 text-white hover:bg-red-600'
                  : 'bg-destructive text-destructive-foreground hover:bg-destructive/90 size-7'
              )}
            >
              <Square className={isHome ? 'size-3.5' : 'size-3'} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'flex items-center justify-center rounded-full transition-all',
                canSubmit
                  ? 'bg-foreground text-background hover:bg-foreground/90 cursor-pointer'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
                isHome ? 'size-8' : 'size-7'
              )}
            >
              {isHome ? (
                <ArrowUp className="size-4" />
              ) : (
                <Send className="size-3" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
