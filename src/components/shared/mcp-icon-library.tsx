import type { ComponentType } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  BookOpenText,
  Bot,
  BriefcaseBusiness,
  Calculator,
  Database,
  FileSearch,
  Globe2,
  Headphones,
  MessagesSquare,
  Server,
  ShieldCheck,
  ShoppingBag,
  Workflow,
} from 'lucide-react';

export interface McpIconOption {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
}

export const DEFAULT_MCP_ICON_KEY = 'server';

export const mcpIconLibrary: McpIconOption[] = [
  {
    key: 'server',
    label: '服务器',
    icon: Server,
    accent: 'from-slate-100 to-blue-50 text-slate-600 border-slate-200',
  },
  {
    key: 'database',
    label: '数据库',
    icon: Database,
    accent: 'from-cyan-100 to-teal-50 text-cyan-600 border-cyan-100',
  },
  {
    key: 'knowledge',
    label: '知识库',
    icon: BookOpenText,
    accent: 'from-sky-100 to-cyan-50 text-sky-600 border-sky-100',
  },
  {
    key: 'calculator',
    label: '理算',
    icon: Calculator,
    accent: 'from-orange-100 to-amber-50 text-orange-500 border-orange-100',
  },
  {
    key: 'workflow',
    label: '流程',
    icon: Workflow,
    accent: 'from-emerald-100 to-teal-50 text-emerald-600 border-emerald-100',
  },
  {
    key: 'crm',
    label: '客户',
    icon: MessagesSquare,
    accent: 'from-indigo-100 to-blue-50 text-indigo-600 border-indigo-100',
  },
  {
    key: 'policy',
    label: '保单',
    icon: ShieldCheck,
    accent: 'from-lime-100 to-emerald-50 text-emerald-600 border-emerald-100',
  },
  {
    key: 'ticket',
    label: '工单',
    icon: Headphones,
    accent: 'from-violet-100 to-purple-50 text-violet-600 border-violet-100',
  },
  {
    key: 'document',
    label: '文档',
    icon: FileSearch,
    accent: 'from-orange-100 to-amber-50 text-orange-500 border-orange-100',
  },
  {
    key: 'commerce',
    label: '产品',
    icon: ShoppingBag,
    accent: 'from-rose-100 to-orange-50 text-rose-600 border-rose-100',
  },
  {
    key: 'web',
    label: 'Web',
    icon: Globe2,
    accent: 'from-blue-100 to-sky-50 text-blue-600 border-blue-100',
  },
  {
    key: 'bot',
    label: '智能体',
    icon: Bot,
    accent: 'from-fuchsia-100 to-purple-50 text-fuchsia-600 border-fuchsia-100',
  },
  {
    key: 'business',
    label: '业务',
    icon: BriefcaseBusiness,
    accent: 'from-amber-100 to-orange-50 text-amber-600 border-amber-100',
  },
];

function createIconfontIcon(iconfontClass: string) {
  return function IconfontIcon({ className }: { className?: string }) {
    return (
      <i
        aria-hidden="true"
        className={cn(
          'iconfont inline-flex items-center justify-center',
          iconfontClass,
          className
        )}
      />
    );
  };
}

export function normalizeMcpIconKey(iconKey?: string): string {
  const trimmed = iconKey?.trim();
  return trimmed || DEFAULT_MCP_ICON_KEY;
}

export function getMcpIconOption(iconKey?: string): McpIconOption {
  const normalized = normalizeMcpIconKey(iconKey);
  if (normalized.startsWith('iconfont:')) {
    const iconfontClass = normalized.replace(/^iconfont:/, '').trim();
    return {
      key: normalized,
      label: iconfontClass || 'Iconfont',
      icon: createIconfontIcon(iconfontClass),
      accent: 'from-slate-100 to-zinc-50 text-slate-600 border-slate-200',
    };
  }

  return (
    mcpIconLibrary.find((option) => option.key === normalized) ||
    mcpIconLibrary[0]
  );
}
