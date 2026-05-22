import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getAllFiles,
  type FileType,
  type LibraryFile,
  type Task,
} from '@/shared/db';
import {
  getSettings,
  saveSettings,
  syncSettingsWithBackend,
  type Settings as SettingsType,
  type UserProfile,
} from '@/shared/db/settings';
import {
  getAppDataDir,
  getDirName,
  getDisplayPath,
  getMcpConfigPath,
  getSkillsDir,
} from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ArrowRight,
  BadgeDollarSign,
  BrainCircuit,
  BriefcaseBusiness,
  Calculator,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Clock,
  Database,
  ExternalLink,
  File,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  Puzzle,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  User,
} from 'lucide-react';

import { LogoMark, LogoWordmark } from '@/components/common/logo';
import { SettingsModal } from '@/components/settings';
import { API_BASE_URL } from '@/components/settings/constants';
import type { SettingsCategory } from '@/components/settings/types';
import { SkillsPlaza } from '@/components/skills/SkillsPlaza';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { useSidebar } from './sidebar-context';

interface LeftSidebarProps {
  tasks: Task[];
  currentTaskId?: string;
  onDeleteTask?: (taskId: string) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
  onRenameTask?: (taskId: string, newTitle: string) => void;
  runningTaskIds?: string[];
}

interface SidebarAssistant {
  id: string;
  name: string;
  initial: string;
  capabilityId?: string | null;
  source?: 'primary' | 'built-in' | 'custom';
  description?: string;
  skills?: string[];
  mcps?: string[];
}

const CUSTOM_ASSISTANTS_STORAGE_KEY = 'workany:custom-assistants';

const BUILT_IN_ASSISTANTS = [
  {
    id: 'sales',
    name: '销售助手',
    capabilityId: 'sales',
    icon: BadgeDollarSign,
    description: '产品条款、产品比对、渠道推荐、核保和保单查询。',
  },
  {
    id: 'meeting',
    name: '会议助手',
    capabilityId: 'meeting',
    icon: Calendar,
    description: '会议纪要、待办提炼、日程梳理和参会材料整理。',
  },
  {
    id: 'office',
    name: '办公助手',
    capabilityId: 'office',
    icon: BriefcaseBusiness,
    description: '日常办公写作、表格处理、流程材料和事务跟进。',
  },
  {
    id: 'document-review',
    name: '文档审核',
    capabilityId: 'document-review',
    icon: ShieldCheck,
    description: '合同、方案、制度和业务文档的风险与格式审核。',
  },
  {
    id: 'file',
    name: '文件整理助手',
    capabilityId: null,
    icon: FolderOpen,
    description: '文件归类、命名整理、资料检索和归档建议。',
  },
] as const;

const ASSISTANT_SKILL_OPTIONS = [
  {
    id: 'terms',
    label: '条款检索',
    description: '读取产品条款并抽取责任、等待期和免赔额。',
  },
  {
    id: 'compare',
    label: '产品比对',
    description: '按保障责任、适用客群和销售口径做结构化对比。',
  },
  {
    id: 'writing',
    label: '话术生成',
    description: '把业务规则转换成可直接发送给客户的表达。',
  },
  {
    id: 'review',
    label: '文档审核',
    description: '检查文档风险、遗漏项和格式一致性。',
  },
  {
    id: 'underwriting',
    label: '核保咨询',
    description: '识别健康告知、异常指标和需补充的核保材料。',
  },
  {
    id: 'ops-support',
    label: '运维排障',
    description: '梳理系统报错、权限问题和工单处理上下文。',
  },
] as const;

const ASSISTANT_MCP_OPTIONS = [
  {
    id: 'knowledge-base',
    label: '知识库',
    description: '连接产品资料、销售手册和内部 FAQ。',
  },
  {
    id: 'policy-system',
    label: '保单系统',
    description: '查询客户、保单、续保和承保状态。',
  },
  {
    id: 'crm',
    label: '客户中心',
    description: '读取客户画像、渠道和跟进记录。',
  },
  {
    id: 'ops',
    label: '运维工单',
    description: '创建排障工单并补充必要上下文。',
  },
  {
    id: 'proposal-engine',
    label: '建议书系统',
    description: '生成方案建议书并校验产品、费率和投保规则。',
  },
  {
    id: 'channel-product',
    label: '渠道产品库',
    description: '按代理人渠道读取可售、停售和权限内产品。',
  },
] as const;

const ASSISTANT_OPTION_PAGE_SIZE = 4;

function filterAssistantOptions<
  T extends { label: string; description: string },
>(options: readonly T[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => {
    const searchableText =
      `${option.label} ${option.description}`.toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}

function dispatchAssistantSelection(assistant: SidebarAssistant) {
  window.dispatchEvent(
    new CustomEvent('workany:assistant-selected', {
      detail: {
        assistantId: assistant.id,
        assistantName: assistant.name,
        capabilityId: assistant.capabilityId ?? null,
        skills: assistant.skills ?? [],
        mcps: assistant.mcps ?? [],
      },
    })
  );
}

function getInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'A';
}

async function openPathInSystem(targetPath: string) {
  if (!targetPath) return;
  try {
    const response = await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath, expandHome: true }),
    });
    const data = await response.json();
    if (!data.success) {
      console.error('[Workspace] Failed to open path:', data.error);
    }
  } catch (err) {
    console.error('[Workspace] Error opening path:', err);
  }
}

function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div className="bg-background border-border relative w-[400px] max-w-[90vw] rounded-lg border p-6 shadow-xl">
        <h3 className="text-foreground text-lg font-semibold">
          {t.common.deleteTaskConfirm}
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          {t.common.deleteTaskDescription}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => onOpenChange(false)}
            className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600"
          >
            {t.common.delete}
          </button>
        </div>
      </div>
    </div>
  );
}

function getTaskIcon(prompt: string) {
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('网站') || lowerPrompt.includes('website')) {
    return Globe;
  }
  if (lowerPrompt.includes('应用') || lowerPrompt.includes('app')) {
    return Smartphone;
  }
  if (lowerPrompt.includes('设计') || lowerPrompt.includes('design')) {
    return Sparkles;
  }
  if (lowerPrompt.includes('文档') || lowerPrompt.includes('doc')) {
    return FileText;
  }
  return Calendar;
}

export function LeftSidebar({
  tasks,
  currentTaskId,
  onDeleteTask,
  onToggleFavorite,
  onRenameTask,
  runningTaskIds = [],
}: LeftSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { leftOpen, toggleLeft, setLeftOpen } = useSidebar();
  const { t } = useLanguage();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<
    SettingsCategory | undefined
  >(undefined);
  const [panelCategory, setPanelCategory] = useState<SettingsCategory | null>(
    null
  );
  const [settings, setSettings] = useState<SettingsType>(getSettings);
  const [defaultPaths, setDefaultPaths] = useState({
    workDir: '',
    mcpConfigPath: '',
    skillsPath: '',
  });
  const [profile, setProfile] = useState<UserProfile>({
    nickname: 'Guest User',
    avatar: '',
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [taskToRename, setTaskToRename] = useState<{
    id: string;
    prompt: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  useEffect(() => {
    const settings = getSettings();
    setProfile(settings.profile);
    setSettings(settings);
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      const settings = getSettings();
      setProfile(settings.profile);
      setSettings(settings);
    }
  }, [settingsOpen]);

  useEffect(() => {
    async function loadDefaultPaths() {
      const [workDir, mcpConfigPath, skillsPath] = await Promise.all([
        getAppDataDir().then(getDisplayPath),
        getMcpConfigPath().then(getDisplayPath),
        getSkillsDir().then(getDisplayPath),
      ]);
      setDefaultPaths({ workDir, mcpConfigPath, skillsPath });
    }
    loadDefaultPaths();
  }, []);

  const handleDeleteClick = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskToDelete(taskId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (taskToDelete && onDeleteTask) {
      onDeleteTask(taskToDelete);
      if (taskToDelete === currentTaskId) {
        navigate('/');
      }
    }
    setTaskToDelete(null);
  };

  const handleToggleFavorite = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(task.id, !task.favorite);
    }
  };

  const handleRenameClick = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskToRename({ id: task.id, prompt: task.prompt });
    setRenameValue(task.prompt);
    setRenameDialogOpen(true);
  };

  const handleConfirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && taskToRename && onRenameTask) {
      onRenameTask(taskToRename.id, trimmed);
    }
    setRenameDialogOpen(false);
    setTaskToRename(null);
  };

  const handleTaskAssistant = () => {
    setLeftOpen(true);
    setPanelCategory(null);
    navigate('/');
  };

  const handleSelectTask = (taskId: string) => {
    if (taskId === currentTaskId || loadingTaskId) return;

    setLoadingTaskId(taskId);
    requestAnimationFrame(() => {
      navigate(`/task/${taskId}`);
      setTimeout(() => setLoadingTaskId(null), 100);
    });
  };

  const handleSettings = () => {
    setSettingsCategory('account');
    setPanelCategory(null);
    setSettingsOpen(true);
  };

  const openSettingsCategory = (category: SettingsCategory) => {
    setLeftOpen(true);
    setSettingsOpen(false);
    setPanelCategory(category);
  };

  const handleSettingsChange = (newSettings: SettingsType) => {
    setSettings(newSettings);
    setProfile(newSettings.profile);
    saveSettings(newSettings);
    syncSettingsWithBackend().catch((error) => {
      console.error('[Settings] Failed to sync with backend:', error);
    });
  };

  const isTaskAssistantActive =
    location.pathname === '/' ||
    location.pathname.startsWith('/task') ||
    location.pathname === '/library';
  const showTaskAssistantPanel =
    leftOpen && isTaskAssistantActive && !settingsOpen && !panelCategory;
  const showSettingsPanel = leftOpen && !!panelCategory;
  const showFullWidthPanel =
    showSettingsPanel &&
    (panelCategory === 'skills' ||
      panelCategory === 'workplace' ||
      panelCategory === 'data' ||
      panelCategory === 'mcp');

  const settingsNavItems: Array<{
    category: SettingsCategory;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }> = [
    { category: 'skills', icon: Puzzle, label: t.nav.skillsPlaza },
    { category: 'workplace', icon: FolderOpen, label: t.nav.workspace },
    { category: 'data', icon: Clock, label: t.nav.logManagement },
    { category: 'mcp', icon: Server, label: t.nav.mcpPlaza },
  ];

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'border-sidebar-border bg-sidebar flex h-full shrink-0 border-r transition-all duration-300',
          showFullWidthPanel && 'fixed inset-0 z-40 h-screen',
          leftOpen
            ? showFullWidthPanel
              ? 'w-screen'
              : showTaskAssistantPanel || showSettingsPanel
                ? 'w-[400px]'
                : 'w-20'
            : 'w-16'
        )}
      >
        <div className="flex h-full w-full min-w-0">
          <div
            className={cn(
              'flex h-full shrink-0 flex-col items-center',
              leftOpen ? 'w-20' : 'w-16'
            )}
          >
            <div
              className={cn(
                'relative flex shrink-0 items-center justify-center',
                leftOpen ? 'w-full px-2 pt-4 pb-5' : 'p-3'
              )}
            >
              {leftOpen ? (
                <>
                  <div className="flex w-full flex-col items-center gap-1.5">
                    <LogoMark className="size-12" />
                    <LogoWordmark className="text-sm" />
                  </div>
                  <button
                    onClick={toggleLeft}
                    aria-label="Collapse sidebar"
                    className="text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground absolute top-3 right-1 flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors"
                  >
                    <PanelLeft className="size-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={toggleLeft}
                  aria-label="Expand sidebar"
                  className="hover:bg-sidebar-accent flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors"
                >
                  <LogoMark className="size-9" />
                </button>
              )}
            </div>

            <nav
              className={cn(
                'flex shrink-0 flex-col items-center gap-2',
                leftOpen ? 'w-full px-2 pt-1' : 'px-2 pt-2'
              )}
            >
              <SidebarFeatureButton
                icon={MessageSquare}
                label={t.nav.taskAssistant}
                active={
                  isTaskAssistantActive && !settingsOpen && !panelCategory
                }
                collapsed={!leftOpen}
                onClick={handleTaskAssistant}
              />

              {settingsNavItems.map((item) => (
                <SidebarFeatureButton
                  key={item.category}
                  icon={item.icon}
                  label={item.label}
                  collapsed={!leftOpen}
                  active={panelCategory === item.category}
                  onClick={() => openSettingsCategory(item.category)}
                />
              ))}
            </nav>

            <div className="flex-1" />

            <div className="flex w-full shrink-0 justify-center px-2 pb-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="hover:bg-sidebar-accent flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200">
                    <div className="bg-sidebar-accent flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                      {profile.avatar ? (
                        <img
                          src={profile.avatar}
                          alt={profile.nickname}
                          className="size-full object-cover"
                        />
                      ) : (
                        <User className="text-sidebar-foreground/70 size-5" />
                      )}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-56 rounded-lg"
                  side="right"
                  align="end"
                  sideOffset={8}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-3 px-2 py-2 text-left">
                      <div className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg">
                        {profile.avatar ? (
                          <img
                            src={profile.avatar}
                            alt={profile.nickname}
                            className="size-full object-cover"
                          />
                        ) : (
                          <User className="text-muted-foreground size-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {profile.nickname || 'Guest User'}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={handleSettings}
                    >
                      <Settings className="size-4" />
                      <span>{t.nav.settings}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {showTaskAssistantPanel && (
            <TaskAssistantPanel
              tasks={tasks}
              currentTaskId={currentTaskId}
              loadingTaskId={loadingTaskId}
              runningTaskIds={runningTaskIds}
              onSelectTask={handleSelectTask}
              onToggleFavorite={handleToggleFavorite}
              onRenameTask={handleRenameClick}
              onDeleteTask={handleDeleteClick}
              t={t}
            />
          )}

          {showSettingsPanel && panelCategory && (
            <SettingsInlinePanel
              category={panelCategory}
              label={
                settingsNavItems.find((item) => item.category === panelCategory)
                  ?.label ?? ''
              }
              settings={settings}
              defaultPaths={defaultPaths}
              onSettingsChange={handleSettingsChange}
            />
          )}
        </div>
      </aside>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialCategory={settingsCategory}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        t={t}
      />

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t.common.rename}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium">{t.common.taskTitle}</label>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmRename();
              }}
              autoFocus
              className="border-border focus:border-primary focus:ring-primary/30 mt-1.5 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setRenameDialogOpen(false)}
              className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleConfirmRename}
              disabled={!renameValue.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              {t.common.confirm}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function SidebarFeatureButton({
  icon: Icon,
  label,
  collapsed,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const button = (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex cursor-pointer items-center justify-center transition-all duration-200',
        collapsed
          ? 'mx-auto size-10 rounded-xl'
          : 'h-[66px] w-full flex-col gap-1 rounded-2xl text-center',
        active
          ? 'bg-gradient-to-br from-orange-50 via-white to-orange-100/70 text-orange-600 shadow-sm ring-1 ring-orange-100'
          : 'text-sidebar-foreground/70 hover:bg-orange-50/70 hover:text-orange-600'
      )}
    >
      <Icon className="size-5" />
      {!collapsed && (
        <span className="w-full px-0.5 text-xs leading-tight font-medium whitespace-nowrap">
          {label}
        </span>
      )}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SettingsInlinePanel({
  category,
  label,
  settings,
  defaultPaths,
  onSettingsChange,
}: {
  category: SettingsCategory;
  label: string;
  settings: SettingsType;
  defaultPaths: {
    workDir: string;
    mcpConfigPath: string;
    skillsPath: string;
  };
  onSettingsChange: (settings: SettingsType) => void;
}) {
  if (category === 'skills') {
    return (
      <div className="border-sidebar-border bg-background flex h-full min-w-0 flex-1 flex-col border-l">
        <SkillsPlaza settings={settings} onSettingsChange={onSettingsChange} />
      </div>
    );
  }

  if (category === 'workplace') {
    return (
      <WorkspacePanel
        settings={settings}
        defaultWorkDir={defaultPaths.workDir}
      />
    );
  }

  if (category === 'data') {
    return <ScheduledTasksPanel />;
  }

  if (category === 'mcp') {
    return <AIAbilityPlazaPanel />;
  }

  return (
    <div className="border-sidebar-border bg-background/50 flex h-full min-w-0 flex-1 flex-col border-l">
      <div className="border-sidebar-border shrink-0 border-b px-4 py-4">
        <h2 className="text-foreground text-base font-semibold">{label}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="settings-inline-panel p-4 [&_.grid-cols-2]:grid-cols-1 [&_.max-w-md]:max-w-full [&_.p-6]:p-0 [&_.px-6]:px-0 [&_.sticky]:static [&_.sticky]:flex-col [&_.sticky]:items-stretch [&_.sticky]:gap-3 [&_.w-64]:w-full" />
      </div>
    </div>
  );
}

type AbilityCategoryKey =
  | '全部'
  | '医疗健康'
  | '语音识别'
  | '文档智能'
  | '业务风控'
  | '数据处理';

interface AIAbility {
  id: string;
  name: string;
  description: string;
  category: AbilityCategoryKey;
  tags: string[];
  provider: string;
  usage: string;
  connected: boolean;
  featured?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

const abilityCategories: AbilityCategoryKey[] = [
  '全部',
  '医疗健康',
  '语音识别',
  '文档智能',
  '业务风控',
  '数据处理',
];

const aiAbilities: AIAbility[] = [
  {
    id: 'claim-calculation',
    name: '理算技能',
    description:
      '面向保险理赔场景，自动识别责任、保额、免赔额与赔付规则，输出可追溯的理算结果。',
    category: '医疗健康',
    tags: ['责任判断', '赔付试算', '规则引擎', '结果追溯'],
    provider: 'U2 能力',
    usage: '18.6k 调用',
    connected: false,
    featured: true,
    icon: Calculator,
    accent: 'from-orange-100 to-amber-50 text-orange-500 border-orange-100',
  },
  {
    id: 'medical-insurance-audit',
    name: '医保审核技能',
    description:
      '校验医保目录、诊疗项目、用药合规与报销限制，辅助完成费用合规审核。',
    category: '医疗健康',
    tags: ['医保目录', '费用审核', '合规校验'],
    provider: 'U2 能力',
    usage: '12.8k 调用',
    connected: false,
    icon: ShieldCheck,
    accent: 'from-emerald-100 to-teal-50 text-emerald-600 border-emerald-100',
  },
  {
    id: 'asr',
    name: 'ASR 技能',
    description:
      '将录音、通话与会议音频转写为结构化文本，支持说话人分离与关键词抽取。',
    category: '语音识别',
    tags: ['语音转写', '说话人分离', '关键词'],
    provider: 'U2 能力',
    usage: '32.1k 调用',
    connected: true,
    icon: Mic,
    accent: 'from-indigo-100 to-blue-50 text-indigo-600 border-indigo-100',
  },
  {
    id: 'ocr',
    name: 'OCR 技能',
    description:
      '识别发票、保单、病历、身份证与表格影像内容，输出字段级结构化结果。',
    category: '文档智能',
    tags: ['票据识别', '证照识别', '结构化抽取'],
    provider: 'U2 能力',
    usage: '28.4k 调用',
    connected: true,
    icon: FileText,
    accent: 'from-sky-100 to-cyan-50 text-sky-600 border-sky-100',
  },
  {
    id: 'risk-control',
    name: '风控核验技能',
    description:
      '结合业务规则与历史行为信号，识别异常申报、重复材料和高风险操作。',
    category: '业务风控',
    tags: ['异常检测', '重复核验', '风险评分'],
    provider: 'U2 能力',
    usage: '9.7k 调用',
    connected: false,
    icon: BrainCircuit,
    accent: 'from-violet-100 to-purple-50 text-violet-600 border-violet-100',
  },
  {
    id: 'data-normalization',
    name: '数据标准化技能',
    description:
      '清洗业务表单与接口返回数据，统一字段命名、枚举值、单位和日期格式。',
    category: '数据处理',
    tags: ['字段映射', '数据清洗', '格式统一'],
    provider: 'U2 能力',
    usage: '7.3k 调用',
    connected: false,
    icon: Database,
    accent: 'from-cyan-100 to-teal-50 text-cyan-600 border-cyan-100',
  },
];

function AIAbilityPlazaPanel() {
  const [activeCategory, setActiveCategory] =
    useState<AbilityCategoryKey>('全部');
  const [searchQuery, setSearchQuery] = useState('');

  const visibleAbilities = aiAbilities.filter((ability) => {
    const matchesCategory =
      activeCategory === '全部' || ability.category === activeCategory;
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      ability.name.toLowerCase().includes(query) ||
      ability.description.toLowerCase().includes(query) ||
      ability.tags.some((tag) => tag.toLowerCase().includes(query));
    return matchesCategory && matchesSearch;
  });

  const featuredAbility =
    visibleAbilities.find((ability) => ability.featured) || visibleAbilities[0];
  const regularAbilities = visibleAbilities.filter(
    (ability) => ability !== featuredAbility
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden border-l border-slate-200 bg-white">
      <div className="relative shrink-0 overflow-hidden border-b border-slate-200 bg-gradient-to-br from-white via-orange-50/25 to-blue-50 px-12 py-8">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(135deg,transparent_18%,rgba(147,197,253,0.28)_18%,rgba(147,197,253,0.28)_56%,transparent_56%)]" />
        <div className="relative z-10 flex items-start justify-between gap-8">
          <div>
            <h1 className="text-4xl font-bold tracking-normal text-slate-950">
              AI 能力广场
            </h1>
            <p className="mt-3 text-base text-slate-600">
              统一接入业务 AI 能力，按场景组合理算、审核、识别与数据处理服务。
            </p>
          </div>

          <div className="flex min-w-[520px] items-center gap-5">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-5 size-5 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索能力名称、场景或描述"
                className="h-14 w-full rounded-full border border-slate-200 bg-white/95 pr-6 pl-14 text-base text-slate-900 shadow-sm transition outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-10 px-12">
          {['能力总览', '官方能力', '已接入', '能力管理'].map((tab, index) => (
            <button
              key={tab}
              className={cn(
                'relative h-full px-1 text-base font-semibold transition',
                index === 0
                  ? 'text-orange-600'
                  : 'text-slate-600 hover:text-slate-950'
              )}
            >
              {tab}
              {index === 0 && (
                <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-orange-600" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-10 py-5">
        <div className="mb-5 flex items-center gap-4 overflow-x-auto pb-1">
          {abilityCategories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={cn(
                'h-10 shrink-0 rounded-full border px-5 text-sm font-medium transition',
                activeCategory === category
                  ? 'border-orange-200 bg-orange-50 text-orange-600'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
              )}
            >
              {category}
            </button>
          ))}
          <button className="ml-auto flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-600">
            更多分类
            <ArrowRight className="size-4" />
          </button>
        </div>

        {visibleAbilities.length === 0 ? (
          <div className="flex h-60 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
            没有匹配的 AI 能力
          </div>
        ) : (
          <div className="grid grid-cols-12 items-start gap-4">
            {featuredAbility && (
              <AIAbilityCard ability={featuredAbility} featured />
            )}
            {regularAbilities.map((ability, index) => (
              <AIAbilityCard
                key={ability.id}
                ability={ability}
                wide={index === 0 || index === 3}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AIAbilityCard({
  ability,
  featured,
  wide,
}: {
  ability: AIAbility;
  featured?: boolean;
  wide?: boolean;
}) {
  const Icon = ability.icon;

  return (
    <article
      className={cn(
        'group relative flex min-h-[168px] flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-lg',
        featured &&
          'col-span-12 min-h-[190px] overflow-hidden border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 xl:col-span-6',
        !featured &&
          (wide
            ? 'col-span-12 min-h-[180px] xl:col-span-6'
            : 'col-span-12 md:col-span-6 xl:col-span-3')
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center border bg-gradient-to-br shadow-sm',
            ability.accent,
            featured ? 'size-16 rounded-[22px]' : 'size-12 rounded-2xl'
          )}
        >
          <Icon className={featured ? 'size-8' : 'size-6'} />
        </div>
        <button className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      <div className={cn('mt-3', featured && 'max-w-[620px]')}>
        <div className="mb-1.5 flex items-center gap-2">
          {featured && (
            <span className="rounded-full bg-orange-500 px-2.5 py-0.5 text-xs font-semibold text-white">
              推荐
            </span>
          )}
          {ability.connected && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              已接入
            </span>
          )}
        </div>
        <h3 className="text-lg font-bold tracking-normal text-slate-950">
          {ability.name}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
          {ability.description}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {ability.tags.slice(0, featured ? 4 : 3).map((tag) => (
          <span
            key={tag}
            className="rounded-lg bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">
            AI
          </span>
          <span className="truncate font-semibold">{ability.provider}</span>
          <span className="truncate">{ability.usage}</span>
        </div>
        <button className="h-9 shrink-0 rounded-xl border border-orange-500 px-5 text-sm font-semibold text-orange-600 transition hover:bg-orange-50">
          {ability.connected ? '管理' : '接入'}
        </button>
      </div>
    </article>
  );
}

type WorkspaceCategory = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (file: LibraryFile) => boolean;
};

const workspaceCategories: WorkspaceCategory[] = [
  { key: 'all', label: '全部', icon: File, match: () => true },
  {
    key: 'document',
    label: '文档',
    icon: FileText,
    match: (file) => file.type === 'document' || file.type === 'text',
  },
  {
    key: 'spreadsheet',
    label: '表格',
    icon: FileSpreadsheet,
    match: (file) => file.type === 'spreadsheet',
  },
  {
    key: 'image',
    label: '图片',
    icon: FileImage,
    match: (file) => file.type === 'image',
  },
  {
    key: 'code',
    label: '代码',
    icon: FileCode,
    match: (file) => file.type === 'code' || file.type === 'website',
  },
  {
    key: 'presentation',
    label: 'PPT',
    icon: FileText,
    match: (file) => file.type === 'presentation',
  },
  {
    key: 'pdf',
    label: 'PDF',
    icon: FileText,
    match: (file) => file.name.toLowerCase().endsWith('.pdf'),
  },
  {
    key: 'other',
    label: '其他',
    icon: File,
    match: (file) => {
      const knownTypes: FileType[] = [
        'image',
        'text',
        'code',
        'document',
        'website',
        'presentation',
        'spreadsheet',
      ];
      return !knownTypes.includes(file.type);
    },
  },
];

function getWorkspaceFileIcon(file: LibraryFile) {
  if (file.name.toLowerCase().endsWith('.pdf')) return FileText;

  switch (file.type) {
    case 'code':
    case 'website':
      return FileCode;
    case 'image':
      return FileImage;
    case 'spreadsheet':
      return FileSpreadsheet;
    case 'document':
    case 'text':
    case 'presentation':
      return FileText;
    default:
      return File;
  }
}

function getWorkspaceFileTypeLabel(file: LibraryFile) {
  if (file.name.toLowerCase().endsWith('.pdf')) return 'PDF';

  switch (file.type) {
    case 'code':
      return '代码';
    case 'website':
      return '网页';
    case 'image':
      return '图片';
    case 'spreadsheet':
      return '表格';
    case 'presentation':
      return 'PPT';
    case 'document':
      return '文档';
    case 'text':
      return '文本';
    default:
      return '其他';
  }
}

function getWorkspaceFileExtension(fileName: string) {
  const extension = fileName.split('.').pop();
  if (!extension || extension === fileName) return 'FILE';
  return extension.slice(0, 6).toUpperCase();
}

function formatWorkspaceTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function WorkspacePanel({
  settings,
  defaultWorkDir,
}: {
  settings: SettingsType;
  defaultWorkDir: string;
}) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    async function loadFiles() {
      setLoading(true);
      try {
        setFiles(await getAllFiles());
      } catch (error) {
        console.error('[Workspace] Failed to load files:', error);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    }
    loadFiles();
  }, []);

  const activeCategoryConfig =
    workspaceCategories.find((category) => category.key === activeCategory) ||
    workspaceCategories[0];
  const ActiveCategoryIcon = activeCategoryConfig.icon;
  const filteredFiles = files.filter((file) => {
    const matchesCategory = activeCategoryConfig.match(file);
    const matchesSearch =
      !searchQuery.trim() ||
      file.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const countForCategory = (category: WorkspaceCategory) =>
    files.filter(category.match).length;

  return (
    <div className="border-sidebar-border flex h-full min-w-0 flex-1 flex-col border-l bg-white">
      <div className="flex min-h-0 flex-1 flex-col px-8 pt-7 pb-6">
        <div className="flex shrink-0 items-center gap-6">
          <div className="w-52 shrink-0">
            <h1 className="text-3xl font-bold tracking-normal text-slate-950">
              工作空间
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              集中查看任务生成的交付文件
            </p>
          </div>

          <div className="relative max-w-[620px] flex-1">
            <Search className="absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索文件名"
              className="h-11 w-full rounded-full border border-transparent bg-slate-100 pr-5 pl-11 text-sm text-slate-900 transition outline-none placeholder:text-slate-400 focus:border-slate-200 focus:bg-white focus:ring-4 focus:ring-slate-100"
            />
          </div>

          <button
            onClick={() => openPathInSystem(settings.workDir || defaultWorkDir)}
            className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <FolderOpen className="size-4.5" />
            打开工作目录
          </button>
        </div>

        <div className="mt-6 flex min-h-0 flex-1 gap-6">
          <aside className="w-52 shrink-0 border-r border-slate-200 pr-4">
            <div className="space-y-1.5">
              {workspaceCategories.map((category) => {
                const Icon = category.icon;
                const active = category.key === activeCategory;
                return (
                  <button
                    key={category.key}
                    onClick={() => setActiveCategory(category.key)}
                    className={cn(
                      'flex h-10 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-left text-sm transition',
                      active
                        ? 'bg-gradient-to-r from-orange-50 to-slate-50 text-orange-600 shadow-[inset_0_0_0_1px_rgba(255,119,35,0.12)]'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon className="size-4.5 shrink-0" />
                      <span className="truncate font-semibold">
                        {category.label}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        active ? 'text-orange-500' : 'text-slate-500'
                      )}
                    >
                      {countForCategory(category)}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
                  <ActiveCategoryIcon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-950">
                    {activeCategoryConfig.label}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {searchQuery.trim()
                      ? `已按“${searchQuery.trim()}”筛选`
                      : '任务输出文件，不包含上传输入文件'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-400">
                  {filteredFiles.length}
                </p>
                <p className="text-xs font-medium text-slate-500">个文件</p>
              </div>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {loading ? (
                <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" />
                  加载中...
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
                  <File className="size-13 text-slate-300" strokeWidth={1.8} />
                  <h2 className="mt-5 text-lg font-bold text-slate-950">
                    暂无生成文件
                  </h2>
                  <p className="mt-2 max-w-md text-sm text-slate-500">
                    任务生成的文件会显示在这里。可以先打开工作目录查看本地文件夹。
                  </p>
                  <button
                    onClick={() =>
                      openPathInSystem(settings.workDir || defaultWorkDir)
                    }
                    className="mt-5 flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-slate-50"
                  >
                    <FolderOpen className="size-4" />
                    打开工作目录
                  </button>
                </div>
              ) : (
                <div className="h-full overflow-auto">
                  <div className="grid min-w-[900px] grid-cols-[minmax(260px,1.6fr)_110px_minmax(240px,1fr)_120px_190px] items-center border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs font-bold text-slate-500">
                    <span>文件</span>
                    <span>类型</span>
                    <span>位置</span>
                    <span>生成时间</span>
                    <span className="text-right">操作</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {filteredFiles.map((file) => {
                      const Icon = getWorkspaceFileIcon(file);
                      const folderPath = getDirName(file.path);

                      return (
                        <div
                          key={file.id}
                          className="grid min-w-[900px] grid-cols-[minmax(260px,1.6fr)_110px_minmax(240px,1fr)_120px_190px] items-center px-4 py-3 transition hover:bg-orange-50/35"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-700 ring-1 ring-slate-200">
                              <Icon className="size-5" strokeWidth={1.9} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-950">
                                {file.name}
                              </p>
                              <span className="mt-1 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                                {getWorkspaceFileExtension(file.name)}
                              </span>
                            </div>
                          </div>

                          <span className="text-sm font-semibold text-slate-700">
                            {getWorkspaceFileTypeLabel(file)}
                          </span>

                          <span
                            title={file.path}
                            className="truncate pr-4 font-mono text-xs text-slate-500"
                          >
                            {file.path}
                          </span>

                          <span className="text-xs font-medium text-slate-500">
                            {formatWorkspaceTime(file.created_at)}
                          </span>

                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => openPathInSystem(file.path)}
                              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-bold text-orange-600 transition hover:border-orange-300 hover:bg-orange-100"
                              title="直接打开文件"
                            >
                              <ExternalLink className="size-3.5" />
                              打开
                            </button>
                            <button
                              onClick={() =>
                                openPathInSystem(folderPath || file.path)
                              }
                              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                              title="打开所在文件夹"
                            >
                              <FolderOpen className="size-3.5" />
                              文件夹
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ScheduledTasksPanel() {
  const suggestions = [
    '设置每天 10:00的定时任务，为我推送一篇优质AI文章的核心观点摘要',
    '每周一至周五 10:00，为我定点推送 20 个高频英语单词 + 例句，明日起长期生效。',
    '设置每天为我推送当天最新的10条科技新闻，每条新闻总结精简，重复频率：每日，任务立即启用',
  ];

  return (
    <div className="border-sidebar-border relative flex h-full min-w-0 flex-1 flex-col border-l bg-white">
      <div className="flex min-h-0 flex-1 items-center justify-center px-8">
        <div className="flex w-full max-w-[860px] -translate-y-10 flex-col items-center text-center">
          <div className="flex size-24 items-center justify-center rounded-full bg-[#ff5358] text-white shadow-[0_22px_54px_rgba(255,83,88,0.28)]">
            <ClipboardList className="size-12" strokeWidth={1.8} />
          </div>

          <button className="mt-11 flex h-13 items-center gap-3 rounded-xl bg-slate-900 px-8 text-xl font-bold text-white shadow-sm transition hover:bg-slate-800">
            <Plus className="size-7" />
            创建任务
          </button>

          <h1 className="mt-18 text-2xl font-bold tracking-normal text-slate-950">
            选择下方对话，一句话创建你的任务
          </h1>

          <div className="mt-7 flex w-full flex-col items-center gap-4">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                className={cn(
                  'flex h-[74px] items-center justify-between rounded-full bg-slate-100 px-7 text-left text-base text-slate-950 transition hover:bg-slate-200',
                  index === 0 && 'w-[590px]',
                  index === 1 && 'w-[680px]',
                  index === 2 && 'w-[790px]'
                )}
              >
                <span className="truncate">{suggestion}</span>
                <ArrowRight className="ml-5 size-5 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskAssistantPanel({
  tasks,
  currentTaskId,
  loadingTaskId,
  runningTaskIds,
  onSelectTask,
  onToggleFavorite,
  onRenameTask,
  onDeleteTask,
  t,
}: {
  tasks: Task[];
  currentTaskId?: string;
  loadingTaskId: string | null;
  runningTaskIds: string[];
  onSelectTask: (taskId: string) => void;
  onToggleFavorite: (task: Task, e: React.MouseEvent) => void;
  onRenameTask: (task: Task, e: React.MouseEvent) => void;
  onDeleteTask: (taskId: string, e: React.MouseEvent) => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  const [assistants, setAssistants] = useState<SidebarAssistant[]>(() => {
    const primaryAssistant = {
      id: 'primary',
      name: t.nav.primaryAssistant,
      initial: 'W',
    };

    try {
      const saved = JSON.parse(
        window.localStorage.getItem(CUSTOM_ASSISTANTS_STORAGE_KEY) || '[]'
      );
      if (!Array.isArray(saved)) return [primaryAssistant];

      const customAssistants = saved.filter(
        (assistant): assistant is SidebarAssistant =>
          typeof assistant?.id === 'string' &&
          typeof assistant?.name === 'string' &&
          typeof assistant?.initial === 'string' &&
          assistant.id !== 'primary'
      );

      return [primaryAssistant, ...customAssistants];
    } catch {
      return [primaryAssistant];
    }
  });
  const [activeAssistantId, setActiveAssistantId] = useState('primary');
  const [createAssistantOpen, setCreateAssistantOpen] = useState(false);
  const [assistantName, setAssistantName] = useState('');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([
    'writing',
  ]);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([
    'knowledge-base',
  ]);
  const [skillPage, setSkillPage] = useState(0);
  const [mcpPage, setMcpPage] = useState(0);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [assistantNameError, setAssistantNameError] = useState('');
  const trimmedAssistantName = assistantName.trim();
  const matchedBuiltInAssistant = BUILT_IN_ASSISTANTS.find(
    (assistant) => assistant.name === trimmedAssistantName
  );
  const showCustomComposer =
    trimmedAssistantName.length > 0 && !matchedBuiltInAssistant;
  const filteredSkillOptions = filterAssistantOptions(
    ASSISTANT_SKILL_OPTIONS,
    skillSearchQuery
  );
  const filteredMcpOptions = filterAssistantOptions(
    ASSISTANT_MCP_OPTIONS,
    mcpSearchQuery
  );
  const skillPageCount = Math.max(
    1,
    Math.ceil(filteredSkillOptions.length / ASSISTANT_OPTION_PAGE_SIZE)
  );
  const mcpPageCount = Math.max(
    1,
    Math.ceil(filteredMcpOptions.length / ASSISTANT_OPTION_PAGE_SIZE)
  );
  const visibleSkillOptions = filteredSkillOptions.slice(
    skillPage * ASSISTANT_OPTION_PAGE_SIZE,
    (skillPage + 1) * ASSISTANT_OPTION_PAGE_SIZE
  );
  const visibleMcpOptions = filteredMcpOptions.slice(
    mcpPage * ASSISTANT_OPTION_PAGE_SIZE,
    (mcpPage + 1) * ASSISTANT_OPTION_PAGE_SIZE
  );

  const resetCreateAssistantForm = () => {
    setAssistantName('');
    setSelectedSkillIds(['writing']);
    setSelectedMcpIds(['knowledge-base']);
    setSkillPage(0);
    setMcpPage(0);
    setSkillSearchQuery('');
    setMcpSearchQuery('');
    setAssistantNameError('');
  };

  const findAssistantByName = (name: string) =>
    assistants.find((assistant) => assistant.name === name);

  const validateAssistantName = (name: string) => {
    if (!name.trim()) return '请输入助手名称。';
    if (findAssistantByName(name.trim()))
      return '助手名称已存在，请换一个名称。';
    return '';
  };

  useEffect(() => {
    const customAssistants = assistants.filter(
      (assistant) => assistant.id !== 'primary'
    );
    window.localStorage.setItem(
      CUSTOM_ASSISTANTS_STORAGE_KEY,
      JSON.stringify(customAssistants)
    );
  }, [assistants]);

  const activateAssistant = (assistant: SidebarAssistant) => {
    setActiveAssistantId(assistant.id);
    dispatchAssistantSelection(assistant);
  };

  const addAssistant = (assistant: SidebarAssistant) => {
    setAssistants((current) => [...current, assistant]);
    activateAssistant(assistant);
    resetCreateAssistantForm();
    setCreateAssistantOpen(false);
  };

  const handleCreateBuiltInAssistant = (
    template: (typeof BUILT_IN_ASSISTANTS)[number]
  ) => {
    const error = validateAssistantName(template.name);
    if (error) {
      setAssistantName(template.name);
      setAssistantNameError(error);
      return;
    }

    const assistant = {
      id: `assistant-${template.id}-${Date.now()}`,
      name: template.name,
      initial: getInitial(template.name),
      capabilityId: template.capabilityId,
      source: 'built-in' as const,
      description: template.description,
    };

    addAssistant(assistant);
  };

  const handleCreateAssistant = () => {
    const trimmed = assistantName.trim();
    const error = validateAssistantName(trimmed);
    if (error) {
      setAssistantNameError(error);
      return;
    }

    if (matchedBuiltInAssistant) {
      handleCreateBuiltInAssistant(matchedBuiltInAssistant);
      return;
    }

    const skills = ASSISTANT_SKILL_OPTIONS.filter((skill) =>
      selectedSkillIds.includes(skill.id)
    ).map((skill) => skill.label);
    const mcps = ASSISTANT_MCP_OPTIONS.filter((mcp) =>
      selectedMcpIds.includes(mcp.id)
    ).map((mcp) => mcp.label);

    addAssistant({
      id: `assistant-${Date.now()}`,
      name: trimmed,
      initial: getInitial(trimmed),
      capabilityId: null,
      source: 'custom',
      description:
        skills.length || mcps.length
          ? `已配置 ${skills.length} 项技能、${mcps.length} 项 MCP 能力`
          : '未绑定额外技能或 MCP，按通用助手创建。',
      skills,
      mcps,
    });
  };

  const toggleSkill = (skillId: string) => {
    setSelectedSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    );
  };

  const toggleMcp = (mcpId: string) => {
    setSelectedMcpIds((current) =>
      current.includes(mcpId)
        ? current.filter((id) => id !== mcpId)
        : [...current, mcpId]
    );
  };

  const handleDeleteAssistant = (
    assistant: SidebarAssistant,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    if (assistant.id === 'primary') return;

    const nextAssistants = assistants.filter(
      (item) => item.id !== assistant.id
    );
    const fallbackAssistant =
      nextAssistants.find((item) => item.id === 'primary') || nextAssistants[0];

    setAssistants(nextAssistants);
    if (activeAssistantId === assistant.id && fallbackAssistant) {
      activateAssistant(fallbackAssistant);
    }
  };

  const goToOptionPage = (
    type: 'skill' | 'mcp',
    direction: 'previous' | 'next'
  ) => {
    if (type === 'skill') {
      setSkillPage((current) =>
        direction === 'previous'
          ? Math.max(0, current - 1)
          : Math.min(skillPageCount - 1, current + 1)
      );
      return;
    }

    setMcpPage((current) =>
      direction === 'previous'
        ? Math.max(0, current - 1)
        : Math.min(mcpPageCount - 1, current + 1)
    );
  };

  return (
    <>
      <div className="border-sidebar-border bg-background/50 flex h-full min-w-0 flex-1 flex-col border-l">
        <div className="border-sidebar-border shrink-0 border-b px-3 py-4">
          <p className="text-muted-foreground px-1 text-sm font-medium">
            {t.nav.myAssistant}
          </p>
          <div className="mt-4 space-y-2">
            {assistants.map((assistant) => {
              const active = activeAssistantId === assistant.id;

              return (
                <div
                  key={assistant.id}
                  className={cn(
                    'group flex min-h-12 w-full items-center gap-1 rounded-xl border p-1 shadow-sm transition-colors',
                    active
                      ? 'border-orange-200 bg-gradient-to-br from-orange-50 via-white to-orange-100/70 text-orange-600'
                      : 'border-border bg-background text-sidebar-foreground hover:bg-accent'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => activateAssistant(assistant)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left"
                  >
                    <div
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm',
                        active
                          ? 'bg-gradient-to-br from-orange-500 to-amber-400 text-white'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {assistant.initial}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      <span className="block truncate">{assistant.name}</span>
                      {assistant.description && (
                        <span className="text-muted-foreground mt-0.5 block truncate text-xs font-normal">
                          {assistant.description}
                        </span>
                      )}
                    </span>
                    {active && (
                      <CircleCheck className="size-5 shrink-0 fill-orange-500 text-white" />
                    )}
                  </button>
                  {assistant.id !== 'primary' && (
                    <button
                      type="button"
                      aria-label={`删除${assistant.name}`}
                      title="删除助手"
                      onClick={(event) =>
                        handleDeleteAssistant(assistant, event)
                      }
                      className={cn(
                        'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 focus:opacity-100',
                        active && 'opacity-100'
                      )}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setCreateAssistantOpen(true)}
              className="border-border hover:bg-accent bg-background flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors"
            >
              <span className="text-lg leading-none">+</span>
              {t.nav.createAssistant}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
          <p className="text-muted-foreground px-1 text-sm font-medium">
            {t.nav.taskRecords}
          </p>
          <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {tasks.length === 0 ? (
              <p className="text-muted-foreground px-1 py-6 text-center text-sm">
                {t.nav.noTasksYet}
              </p>
            ) : (
              tasks
                .slice(0, 12)
                .map((task) => (
                  <TaskRecordItem
                    key={task.id}
                    task={task}
                    active={currentTaskId === task.id}
                    loading={loadingTaskId === task.id}
                    running={runningTaskIds.includes(task.id)}
                    onSelectTask={onSelectTask}
                    onToggleFavorite={onToggleFavorite}
                    onRenameTask={onRenameTask}
                    onDeleteTask={onDeleteTask}
                    t={t}
                  />
                ))
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={createAssistantOpen}
        onOpenChange={(open) => {
          setCreateAssistantOpen(open);
          if (!open) {
            resetCreateAssistantForm();
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {t.nav.createAssistant}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <label className="text-sm font-semibold">助手名称</label>
              <input
                type="text"
                value={assistantName}
                onChange={(event) => {
                  setAssistantName(event.target.value);
                  setAssistantNameError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleCreateAssistant();
                  }
                }}
                autoFocus
                placeholder="例如：销售助手"
                aria-invalid={!!assistantNameError}
                aria-describedby={
                  assistantNameError ? 'assistant-name-error' : undefined
                }
                className={cn(
                  'border-border focus:border-primary focus:ring-primary/30 mt-2 h-14 w-full rounded-xl border bg-transparent px-4 text-lg outline-none focus:ring-2',
                  assistantNameError &&
                    'border-red-300 focus:border-red-400 focus:ring-red-100'
                )}
              />
              {assistantNameError && (
                <p
                  id="assistant-name-error"
                  role="alert"
                  className="mt-2 text-sm font-medium text-red-500"
                >
                  {assistantNameError}
                </p>
              )}
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                创建后会出现在“我的助手”列表中，并自动切换为当前助手。
              </p>
            </div>

            {!showCustomComposer ? (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-base font-extrabold tracking-normal text-slate-950">
                    内置助手
                  </p>
                  <p className="text-muted-foreground text-xs font-semibold">
                    点击后立即创建并选中对应能力块
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {BUILT_IN_ASSISTANTS.map((assistant) => {
                    const Icon = assistant.icon;

                    return (
                      <button
                        key={assistant.id}
                        type="button"
                        onClick={() => handleCreateBuiltInAssistant(assistant)}
                        className="border-border hover:border-primary/40 hover:bg-primary/5 group bg-background flex min-h-24 cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors"
                      >
                        <span className="bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="text-foreground block text-base font-extrabold tracking-normal">
                            {assistant.name}
                          </span>
                          <span className="text-muted-foreground mt-1 block text-xs leading-5 font-medium">
                            {assistant.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-primary text-lg font-extrabold tracking-normal">
                        技能选择
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs font-semibold">
                        可多选，也可以不选择
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-primary text-xs font-bold">
                        {skillPage + 1} / {skillPageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => goToOptionPage('skill', 'previous')}
                        disabled={skillPage === 0}
                        className="border-primary/20 text-primary hover:bg-primary/10 flex size-8 cursor-pointer items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="上一页技能"
                      >
                        <ChevronLeft className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => goToOptionPage('skill', 'next')}
                        disabled={skillPage >= skillPageCount - 1}
                        className="border-primary/20 text-primary hover:bg-primary/10 flex size-8 cursor-pointer items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="下一页技能"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="relative mb-3">
                    <label htmlFor="assistant-skill-search" className="sr-only">
                      搜索技能
                    </label>
                    <Search className="text-primary/60 absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <input
                      id="assistant-skill-search"
                      type="search"
                      value={skillSearchQuery}
                      onChange={(event) => {
                        setSkillSearchQuery(event.target.value);
                        setSkillPage(0);
                      }}
                      placeholder="搜索技能名称或说明"
                      className="border-primary/20 bg-primary/5 text-foreground focus:border-primary/50 focus:bg-background focus:ring-primary/15 h-10 w-full rounded-xl border pr-3 pl-9 text-sm font-medium transition outline-none placeholder:text-slate-400 focus:ring-2"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {visibleSkillOptions.length === 0 ? (
                      <div className="border-primary/25 bg-primary/5 text-primary col-span-2 flex min-h-24 items-center justify-center rounded-xl border border-dashed text-sm font-bold">
                        没有匹配的技能
                      </div>
                    ) : (
                      visibleSkillOptions.map((skill) => {
                        const selected = selectedSkillIds.includes(skill.id);

                        return (
                          <button
                            key={skill.id}
                            type="button"
                            onClick={() => toggleSkill(skill.id)}
                            className={cn(
                              'min-h-24 cursor-pointer rounded-xl border p-3 text-left text-sm transition-colors',
                              selected
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
                            )}
                          >
                            <span className="block text-base font-extrabold tracking-normal">
                              {skill.label}
                            </span>
                            <span className="text-muted-foreground mt-1.5 block text-xs leading-5 font-semibold">
                              {skill.description}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-primary text-lg font-extrabold tracking-normal">
                        AI 能力广场 / MCP 选择
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs font-semibold">
                        作为该助手的可用工具范围
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-primary text-xs font-bold">
                        {mcpPage + 1} / {mcpPageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => goToOptionPage('mcp', 'previous')}
                        disabled={mcpPage === 0}
                        className="border-primary/20 text-primary hover:bg-primary/10 flex size-8 cursor-pointer items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="上一页 MCP 能力"
                      >
                        <ChevronLeft className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => goToOptionPage('mcp', 'next')}
                        disabled={mcpPage >= mcpPageCount - 1}
                        className="border-primary/20 text-primary hover:bg-primary/10 flex size-8 cursor-pointer items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="下一页 MCP 能力"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="relative mb-3">
                    <label htmlFor="assistant-mcp-search" className="sr-only">
                      搜索 AI 能力或 MCP
                    </label>
                    <Search className="text-primary/60 absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <input
                      id="assistant-mcp-search"
                      type="search"
                      value={mcpSearchQuery}
                      onChange={(event) => {
                        setMcpSearchQuery(event.target.value);
                        setMcpPage(0);
                      }}
                      placeholder="搜索 AI 能力、MCP 或说明"
                      className="border-primary/20 bg-primary/5 text-foreground focus:border-primary/50 focus:bg-background focus:ring-primary/15 h-10 w-full rounded-xl border pr-3 pl-9 text-sm font-medium transition outline-none placeholder:text-slate-400 focus:ring-2"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {visibleMcpOptions.length === 0 ? (
                      <div className="border-primary/25 bg-primary/5 text-primary col-span-2 flex min-h-24 items-center justify-center rounded-xl border border-dashed text-sm font-bold">
                        没有匹配的 AI 能力或 MCP
                      </div>
                    ) : (
                      visibleMcpOptions.map((mcp) => {
                        const selected = selectedMcpIds.includes(mcp.id);

                        return (
                          <button
                            key={mcp.id}
                            type="button"
                            onClick={() => toggleMcp(mcp.id)}
                            className={cn(
                              'min-h-24 cursor-pointer rounded-xl border p-3 text-left text-sm transition-colors',
                              selected
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
                            )}
                          >
                            <span className="block text-base font-extrabold tracking-normal">
                              {mcp.label}
                            </span>
                            <span className="text-muted-foreground mt-1.5 block text-xs leading-5 font-semibold">
                              {mcp.description}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setCreateAssistantOpen(false);
                resetCreateAssistantForm();
              }}
              className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={handleCreateAssistant}
              disabled={!assistantName.trim() || !!assistantNameError}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              {t.common.confirm}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TaskRecordItem({
  task,
  active,
  loading,
  running,
  onSelectTask,
  onToggleFavorite,
  onRenameTask,
  onDeleteTask,
  t,
}: {
  task: Task;
  active: boolean;
  loading: boolean;
  running: boolean;
  onSelectTask: (taskId: string) => void;
  onToggleFavorite: (task: Task, e: React.MouseEvent) => void;
  onRenameTask: (task: Task, e: React.MouseEvent) => void;
  onDeleteTask: (taskId: string, e: React.MouseEvent) => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  const TaskIcon = getTaskIcon(task.prompt);

  return (
    <div
      className={cn(
        'group flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors',
        active || loading
          ? 'bg-gradient-to-r from-orange-50 to-orange-100/70 text-slate-950 shadow-sm ring-1 ring-orange-100'
          : 'text-sidebar-foreground/75 hover:bg-orange-50/70 hover:text-slate-950',
        loading && 'opacity-70'
      )}
      onClick={() => onSelectTask(task.id)}
    >
      <div className="relative shrink-0">
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-lg',
            active || loading
              ? 'bg-orange-100 text-orange-600'
              : 'text-muted-foreground'
          )}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <TaskIcon className="size-4" />
          )}
        </span>
        {running && !loading && (
          <span className="absolute -top-0.5 -right-0.5 flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-green-500" />
          </span>
        )}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm">{task.prompt}</span>

      {running ? (
        <div className="flex size-6 shrink-0 items-center justify-center">
          <Loader2 className="text-primary size-4 animate-spin" />
        </div>
      ) : (
        <TaskActionsMenu
          task={task}
          onToggleFavorite={onToggleFavorite}
          onRenameTask={onRenameTask}
          onDeleteTask={onDeleteTask}
          t={t}
        />
      )}
    </div>
  );
}

function TaskActionsMenu({
  task,
  onToggleFavorite,
  onRenameTask,
  onDeleteTask,
  t,
}: {
  task: Task;
  onToggleFavorite: (task: Task, e: React.MouseEvent) => void;
  onRenameTask: (task: Task, e: React.MouseEvent) => void;
  onDeleteTask: (taskId: string, e: React.MouseEvent) => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="flex size-6 shrink-0 items-center justify-center rounded transition-all"
        >
          {task.favorite ? (
            <>
              <Star className="size-4 fill-amber-400 text-amber-400 group-hover:hidden" />
              <MoreHorizontal className="text-muted-foreground hover:text-foreground hidden size-4 group-hover:block" />
            </>
          ) : (
            <MoreHorizontal className="text-muted-foreground hover:text-foreground size-4 opacity-0 group-hover:opacity-100" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-[140px]">
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={(e) => onToggleFavorite(task, e)}
        >
          <Star
            className={cn(
              'size-4',
              task.favorite && 'fill-amber-400 text-amber-400'
            )}
          />
          <span>{task.favorite ? t.common.unfavorite : t.common.favorite}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={(e) => onRenameTask(task, e)}
        >
          <Pencil className="size-4" />
          <span>{t.common.rename}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-red-500 focus:text-red-500"
          onClick={(e) => onDeleteTask(task.id, e)}
        >
          <Trash2 className="size-4" />
          <span>{t.common.delete}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
