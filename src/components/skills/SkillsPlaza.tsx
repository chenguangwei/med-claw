import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Settings as SettingsType } from '@/shared/db/settings';
import { getClaudeSkillsDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ChevronDown,
  ClipboardList,
  Code2,
  Download,
  Flame,
  FolderOpen,
  Globe2,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Search,
  Sparkles,
} from 'lucide-react';

import { Switch } from '@/components/settings/components/Switch';
import { API_BASE_URL } from '@/components/settings/constants';
import type { SkillInfo } from '@/components/settings/types';

type PlazaTab = 'team' | 'official' | 'mine' | 'manage';

interface SkillsPlazaProps {
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
}

interface PlazaSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  source: string;
  installs: string;
  installed: boolean;
  featured?: boolean;
  path?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

const categoryKeys = [
  '全部',
  '办公协作',
  '金融助手',
  '内容创作',
  '学术研究',
  '运营助手',
  '开发工具',
  '数据处理',
  '设计创意',
  '效率工具',
];

const tabLabels: Record<PlazaTab, string> = {
  team: '团队专区',
  official: '官方精选',
  mine: '我的技能',
  manage: '技能管理',
};

const fallbackSkills: PlazaSkill[] = [
  {
    id: 'invoice-assistant',
    name: '发票报销助手',
    description:
      '识别发票信息，自动生成报销单，支持多种发票类型与格式，提升报销效率。',
    category: '金融助手',
    tags: ['发票识别', '报销单生成', '财务合规', 'OCR'],
    source: 'U2 官方',
    installs: '12.4k 安装',
    installed: false,
    featured: true,
    icon: ReceiptText,
    accent: 'from-orange-100 to-amber-50 text-orange-500 border-orange-100',
  },
  {
    id: 'meeting-notes',
    name: '会议纪要助手',
    description: '将会议录音或聊天记录转写为文字，自动提炼要点、行动项与决议。',
    category: '办公协作',
    tags: ['会议转写', '要点提炼', '决议跟踪'],
    source: 'U2 官方',
    installs: '8.7k 安装',
    installed: false,
    icon: ClipboardList,
    accent: 'from-emerald-100 to-teal-50 text-emerald-600 border-emerald-100',
  },
  {
    id: 'topic-planner',
    name: '内容选题规划',
    description: '基于热点趋势与账号定位，生成选题建议、标题方案与内容结构。',
    category: '内容创作',
    tags: ['热点分析', '选题建议', '标题生成'],
    source: 'U2 官方',
    installs: '9.2k 安装',
    installed: false,
    icon: Flame,
    accent: 'from-orange-100 to-rose-50 text-orange-500 border-orange-100',
  },
  {
    id: 'dev-assistant',
    name: '开发助手',
    description:
      '辅助编写代码、解释报错、生成单元测试与 API 文档，提升交付质量。',
    category: '开发工具',
    tags: ['代码生成', '报错分析', '单测生成'],
    source: 'U2 官方',
    installs: '15.6k 安装',
    installed: true,
    icon: Code2,
    accent: 'from-indigo-100 to-blue-50 text-indigo-600 border-indigo-100',
  },
  {
    id: 'web-extractor',
    name: '网页内容提取器',
    description: '从网页中提取指定内容，支持数据清洗与导出为结构化格式。',
    category: '数据处理',
    tags: ['网页抓取', '数据提取', '结构化导出'],
    source: 'U2 官方',
    installs: '11.8k 安装',
    installed: false,
    icon: Globe2,
    accent: 'from-sky-100 to-cyan-50 text-sky-600 border-sky-100',
  },
  {
    id: 'mail-classifier',
    name: '邮件分类助手',
    description:
      '自动分类收件箱邮件，提取关键信息并生成摘要，帮助高效处理邮件。',
    category: '办公协作',
    tags: ['邮件分类', '信息提取', '摘要生成'],
    source: 'U2 官方',
    installs: '6.3k 安装',
    installed: false,
    icon: Mail,
    accent: 'from-cyan-100 to-teal-50 text-cyan-600 border-cyan-100',
  },
];

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

function readTopLevelYamlValue(
  frontmatter: string,
  key: string
): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = new RegExp(`^${escapedKey}:\\s*(.*)$`);
  const lines = frontmatter.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(keyPattern);
    if (!match) continue;

    const inlineValue = match[1].trim();
    if (inlineValue && inlineValue !== '|' && inlineValue !== '>') {
      return stripYamlQuotes(inlineValue);
    }

    const blockLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^[A-Za-z0-9_-]+:\s*/.test(lines[j])) break;
      blockLines.push(lines[j].replace(/^\s+/, ''));
    }
    return stripYamlQuotes(blockLines.join('\n').trim());
  }
}

function parseSkillMdFrontmatter(content: string) {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};
  const frontmatter = frontmatterMatch[1];
  return {
    name: readTopLevelYamlValue(frontmatter, 'name'),
    description: readTopLevelYamlValue(frontmatter, 'description'),
  };
}

async function openFolderInSystem(folderPath: string) {
  if (!folderPath) return;
  try {
    const response = await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, expandHome: true }),
    });
    const data = await response.json();
    if (!data.success) {
      console.error('[SkillsPlaza] Failed to open folder:', data.error);
    }
  } catch (err) {
    console.error('[SkillsPlaza] Error opening folder:', err);
  }
}

function inferCategory(name: string, description: string) {
  const text = `${name} ${description}`.toLowerCase();
  if (/发票|报销|财务|finance|invoice|expense/.test(text)) return '金融助手';
  if (/代码|开发|api|test|code|dev|github|browser/.test(text)) {
    return '开发工具';
  }
  if (/网页|数据|抓取|提取|database|data|extract|crawler/.test(text)) {
    return '数据处理';
  }
  if (/会议|邮件|文档|协作|office|meeting|mail|doc/.test(text)) {
    return '办公协作';
  }
  if (/内容|写作|选题|创作|write|content/.test(text)) return '内容创作';
  if (/研究|论文|学术|research|paper/.test(text)) return '学术研究';
  return '效率工具';
}

function skillToPlazaSkill(skill: SkillInfo, index: number): PlazaSkill {
  const category = inferCategory(skill.name, skill.description || '');
  const iconMap: Record<string, PlazaSkill['icon']> = {
    金融助手: ReceiptText,
    办公协作: ClipboardList,
    内容创作: Flame,
    开发工具: Code2,
    数据处理: Globe2,
    效率工具: Sparkles,
    学术研究: ClipboardList,
  };
  const accentMap = [
    'from-orange-100 to-amber-50 text-orange-500 border-orange-100',
    'from-emerald-100 to-teal-50 text-emerald-600 border-emerald-100',
    'from-indigo-100 to-blue-50 text-indigo-600 border-indigo-100',
    'from-sky-100 to-cyan-50 text-sky-600 border-sky-100',
    'from-violet-100 to-indigo-50 text-violet-600 border-violet-100',
  ];

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || '暂无描述，可打开技能目录查看详细说明。',
    category,
    tags: [category, skill.source === 'claude' ? '个人目录' : '工作区目录'],
    source: skill.source === 'claude' ? '个人技能' : '工作区技能',
    installs: skill.enabled ? '已启用' : '未启用',
    installed: true,
    featured: index === 0,
    path: skill.path,
    icon: iconMap[category] || Sparkles,
    accent: accentMap[index % accentMap.length],
  };
}

export function SkillsPlaza({ settings, onSettingsChange }: SkillsPlazaProps) {
  const { t } = useLanguage();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PlazaTab>('team');
  const [activeCategory, setActiveCategory] = useState('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [skillsDirs, setSkillsDirs] = useState({ user: '', app: '' });
  const [defaultSkillsPath, setDefaultSkillsPath] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);

  useEffect(() => {
    getClaudeSkillsDir().then(setDefaultSkillsPath);
  }, []);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const dirsResponse = await fetch(`${API_BASE_URL}/files/skills-dir`);
      const dirsData = await dirsResponse.json();
      const allSkills: SkillInfo[] = [];
      const dirs = { user: '', app: '' };

      if (dirsData.directories) {
        for (const dir of dirsData.directories as {
          name: string;
          path: string;
          exists: boolean;
        }[]) {
          if (dir.name === 'claude') dirs.user = dir.path;
          if (dir.name === 'workany') dirs.app = dir.path;
          if (!dir.exists) continue;

          const source = dir.name === 'claude' ? 'claude' : 'workany';
          const enabled =
            dir.name === 'claude'
              ? settings.skillsUserDirEnabled !== false
              : settings.skillsAppDirEnabled !== false;
          const filesResponse = await fetch(`${API_BASE_URL}/files/readdir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dir.path, maxDepth: 3 }),
          });
          const filesData = await filesResponse.json();
          if (!filesData.success || !filesData.files) continue;

          for (const folder of filesData.files) {
            if (!folder.isDir) continue;
            let name = folder.name;
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
                name = frontmatter.name || name;
                description = frontmatter.description || '';
              }
            } catch {
              // Keep the folder name if SKILL.md cannot be read.
            }

            allSkills.push({
              id: `${dir.name}-${folder.name}`,
              name,
              source,
              path: folder.path,
              files: folder.children || [],
              enabled,
              description,
            });
          }
        }
      }

      setSkillsDirs(dirs);
      setSkills(allSkills);
    } catch (err) {
      console.error('[SkillsPlaza] Failed to load skills:', err);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [settings.skillsAppDirEnabled, settings.skillsUserDirEnabled]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const plazaSkills = useMemo(() => {
    const localSkills = skills.map(skillToPlazaSkill);
    const merged = [...localSkills, ...fallbackSkills];
    const seen = new Set<string>();
    return merged.filter((skill) => {
      const key = skill.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [skills]);

  const visibleSkills = plazaSkills.filter((skill) => {
    if (activeTab === 'mine' && !skill.installed) return false;
    if (activeTab === 'official' && skill.source !== 'U2 官方') return false;
    if (activeTab === 'manage' && !skill.installed) return false;
    if (activeCategory !== '全部' && skill.category !== activeCategory) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    return (
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  const featuredSkill = visibleSkills.find((skill) => skill.featured);
  const regularSkills = visibleSkills.filter(
    (skill) => skill !== featuredSkill
  );
  const boardPrimarySkill = featuredSkill || regularSkills[0];
  const boardSkills = featuredSkill ? regularSkills : regularSkills.slice(1);
  const sideHeroSkill = boardSkills[0];
  const compactSkills = boardSkills.slice(1, 3);
  const rightColumnSkills = boardSkills.slice(3, 5);
  const remainingSkills = boardSkills.slice(5);

  const handleAddSkill = () => {
    openFolderInSystem(skillsDirs.user || defaultSkillsPath);
    setShowAddMenu(false);
  };

  const renderSkillCard = (
    skill: PlazaSkill,
    variant: SkillMarketCardVariant
  ) => (
    <SkillMarketCard
      key={skill.id}
      skill={skill}
      variant={variant}
      onPrimaryAction={() =>
        openFolderInSystem(skill.path || skillsDirs.user || defaultSkillsPath)
      }
    />
  );

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin text-orange-500" />
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-white">
      <div className="relative shrink-0 overflow-hidden border-b border-slate-200 bg-gradient-to-br from-white via-orange-50/30 to-blue-50 px-6 py-8 xl:px-12 xl:py-10">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(135deg,transparent_20%,rgba(147,197,253,0.32)_20%,rgba(147,197,253,0.32)_58%,transparent_58%)]" />
        <div className="relative z-10 flex flex-col items-start justify-between gap-5 2xl:flex-row 2xl:gap-8">
          <div>
            <h1 className="text-4xl font-bold tracking-normal text-slate-950">
              技能广场
            </h1>
            <p className="mt-3 text-base text-slate-600">
              发现、安装并管理 AI 自动化技能，让工作更高效。
            </p>
          </div>

          <div className="flex w-full min-w-0 flex-col gap-4 sm:flex-row sm:items-center 2xl:w-auto 2xl:min-w-[560px] 2xl:gap-5">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-5 size-5 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索技能名称、作者或描述"
                className="h-16 w-full rounded-full border border-slate-200 bg-white/95 pr-6 pl-14 text-base text-slate-900 shadow-sm transition outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
              />
            </div>

            <div className="relative">
              <button
                onClick={() => setShowAddMenu((value) => !value)}
                className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-orange-600 px-6 text-base font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-500 sm:w-auto"
              >
                <Plus className="size-5" />
                添加技能
                <span className="h-6 w-px bg-white/25" />
                <ChevronDown className="size-4" />
              </button>

              {showAddMenu && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setShowAddMenu(false)}
                  />
                  <div className="absolute top-full right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 shadow-xl">
                    <button
                      onClick={handleAddSkill}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    >
                      <FolderOpen className="size-4 text-slate-500" />
                      打开技能目录
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex h-16 items-center gap-8 overflow-x-auto px-6 xl:gap-10 xl:px-12">
          {(Object.keys(tabLabels) as PlazaTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'relative h-full px-1 text-base font-semibold transition',
                activeTab === tab
                  ? 'text-orange-600'
                  : 'text-slate-600 hover:text-slate-950'
              )}
            >
              {tabLabels[tab]}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-orange-600" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 xl:px-12">
        <div className="mb-6 flex items-center gap-4 overflow-x-auto pb-1">
          {categoryKeys.map((category) => (
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
            <ChevronDown className="size-4" />
          </button>
        </div>

        {activeTab === 'manage' && (
          <div className="mb-6 grid grid-cols-2 gap-4">
            <ManageSwitchCard
              title="启用 Skills"
              description="在智能体对话时加载已启用的技能。"
              checked={settings.skillsEnabled !== false}
              onChange={(checked) =>
                onSettingsChange({ ...settings, skillsEnabled: checked })
              }
            />
            <ManageSwitchCard
              title="加载个人目录"
              description={skillsDirs.user || defaultSkillsPath}
              checked={settings.skillsUserDirEnabled !== false}
              onChange={(checked) =>
                onSettingsChange({
                  ...settings,
                  skillsUserDirEnabled: checked,
                })
              }
            />
          </div>
        )}

        {visibleSkills.length === 0 ? (
          <div className="flex h-60 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
            没有匹配的技能
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(420px,0.9fr)]">
              <div className="grid content-start gap-5 md:grid-cols-2">
                {boardPrimarySkill && (
                  <div className="md:col-span-2">
                    {renderSkillCard(boardPrimarySkill, 'featured')}
                  </div>
                )}
                {compactSkills.map((skill) =>
                  renderSkillCard(skill, 'compact')
                )}
              </div>

              <div className="grid content-start gap-5">
                {sideHeroSkill && renderSkillCard(sideHeroSkill, 'sideHero')}
                {rightColumnSkills.map((skill) =>
                  renderSkillCard(skill, 'wide')
                )}
              </div>
            </div>

            {remainingSkills.length > 0 && (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {remainingSkills.map((skill) => renderSkillCard(skill, 'wide'))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ManageSwitchCard({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 truncate text-sm text-slate-500">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

type SkillMarketCardVariant = 'featured' | 'sideHero' | 'compact' | 'wide';

function SkillMarketCard({
  skill,
  variant,
  onPrimaryAction,
}: {
  skill: PlazaSkill;
  variant: SkillMarketCardVariant;
  onPrimaryAction: () => void;
}) {
  const Icon = skill.icon;
  const featured = variant === 'featured';
  const sideHero = variant === 'sideHero';
  const compact = variant === 'compact';
  const wide = variant === 'wide';

  if (featured) {
    return (
      <article className="group relative flex min-h-[252px] flex-col overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-lg">
        <div className="flex min-w-0 flex-1 flex-col gap-5 md:flex-row md:items-center md:gap-7 2xl:pr-56">
          <SkillIconBadge skill={skill} icon={Icon} size="lg" />

          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-2">
              {skill.featured && (
                <span className="inline-flex items-center rounded-full bg-orange-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm shadow-orange-500/20">
                  精选
                </span>
              )}
              {skill.installed && (
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-600">
                  已添加
                </span>
              )}
            </div>
            <h3 className="text-2xl font-bold tracking-normal whitespace-nowrap text-slate-950">
              {skill.name}
            </h3>
            <p className="mt-3 line-clamp-2 max-w-[520px] text-sm leading-6 text-slate-600">
              {skill.description}
            </p>
            <SkillTags tags={skill.tags} limit={4} className="mt-4" />
          </div>
        </div>

        <FeaturedSkillPreview />

        <SkillCardFooter skill={skill} onPrimaryAction={onPrimaryAction} />
      </article>
    );
  }

  if (sideHero || wide) {
    return (
      <article
        className={cn(
          'group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-lg',
          sideHero ? 'h-[252px]' : 'h-[164px]'
        )}
      >
        <button className="absolute top-6 right-6 rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
          <MoreHorizontal className="size-5" />
        </button>

        <div className="flex min-w-0 gap-5 pr-10">
          <SkillIconBadge
            skill={skill}
            icon={Icon}
            size={sideHero ? 'md' : 'sm'}
          />

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              {skill.installed && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  已添加
                </span>
              )}
            </div>
            <h3
              className={cn(
                'font-bold tracking-normal text-slate-950',
                sideHero ? 'text-xl' : 'text-lg'
              )}
            >
              {skill.name}
            </h3>
            <p
              className={cn(
                'mt-2 text-sm leading-6 text-slate-600',
                sideHero ? 'line-clamp-2' : 'line-clamp-1'
              )}
            >
              {skill.description}
            </p>
            <SkillTags tags={skill.tags} limit={3} className="mt-3" />
          </div>
        </div>

        <SkillCardFooter
          skill={skill}
          onPrimaryAction={onPrimaryAction}
          dense={wide}
        />
      </article>
    );
  }

  return (
    <article
      className={cn(
        'group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-lg',
        compact && 'h-[336px]'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <SkillIconBadge
          skill={skill}
          icon={Icon}
          size={compact ? 'md' : 'sm'}
        />
        <button className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
          <MoreHorizontal className="size-5" />
        </button>
      </div>

      <div className={cn(sideHero ? 'mt-5 max-w-[460px]' : 'mt-4')}>
        <div className="mb-2 flex items-center gap-2">
          {skill.featured && (
            <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
              精选
            </span>
          )}
          {skill.installed && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              已添加
            </span>
          )}
        </div>
        <h3 className="text-xl font-bold tracking-normal text-slate-950">
          {skill.name}
        </h3>
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
          {skill.description}
        </p>
      </div>

      <SkillTags tags={skill.tags} limit={3} className="mt-5" />

      <SkillCardFooter skill={skill} onPrimaryAction={onPrimaryAction} />
    </article>
  );
}

function SkillIconBadge({
  skill,
  icon: Icon,
  size,
}: {
  skill: PlazaSkill;
  icon: PlazaSkill['icon'];
  size: 'sm' | 'md' | 'lg';
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center border bg-gradient-to-br shadow-sm',
        skill.accent,
        size === 'lg' && 'size-24 rounded-[28px]',
        size === 'md' && 'size-18 rounded-[24px]',
        size === 'sm' && 'size-16 rounded-[22px]'
      )}
    >
      <Icon
        className={cn(
          size === 'lg' && 'size-12',
          size === 'md' && 'size-9',
          size === 'sm' && 'size-8'
        )}
      />
    </div>
  );
}

function SkillTags({
  tags,
  limit,
  className,
}: {
  tags: string[];
  limit: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {tags.slice(0, limit).map((tag) => (
        <span
          key={tag}
          className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function SkillCardFooter({
  skill,
  onPrimaryAction,
  dense,
}: {
  skill: PlazaSkill;
  onPrimaryAction: () => void;
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        'mt-auto flex items-center justify-between gap-4',
        dense ? 'pt-3' : 'pt-6'
      )}
    >
      <div className="flex min-w-0 items-center gap-3 text-sm text-slate-600">
        <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
          U2
        </span>
        <span className="truncate font-semibold">{skill.source}</span>
        <Download className="size-4 shrink-0 text-slate-400" />
        <span className="truncate">{skill.installs}</span>
      </div>
      <button
        onClick={onPrimaryAction}
        className="h-10 shrink-0 rounded-xl border border-orange-500 px-6 text-sm font-semibold text-orange-600 transition hover:bg-orange-50"
      >
        {skill.installed ? '管理' : '安装'}
      </button>
    </div>
  );
}

function FeaturedSkillPreview() {
  return (
    <div className="pointer-events-none absolute top-8 right-7 hidden w-44 2xl:block">
      <div className="rounded-xl border border-orange-100 bg-white/90 p-4 shadow-lg shadow-orange-100/50">
        <div className="h-3 w-24 rounded bg-slate-100" />
        <div className="mt-3 h-3 w-32 rounded bg-slate-100" />
        <div className="mt-5 flex gap-2">
          <div className="size-11 rounded-xl bg-orange-100" />
          <div className="size-11 rounded-xl bg-slate-800" />
        </div>
      </div>
      <div className="absolute right-28 bottom-[-30px] w-24 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-md">
        <div className="mb-2 h-2.5 rounded bg-slate-100" />
        <div className="h-2.5 w-16 rounded bg-slate-100" />
      </div>
      <div className="absolute right-0 bottom-[-28px] flex size-12 items-center justify-center rounded-xl bg-slate-800 text-white shadow-md">
        <ReceiptText className="size-6" />
      </div>
    </div>
  );
}
