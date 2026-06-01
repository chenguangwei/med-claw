import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ASSISTANT_PROFILES_CHANGED_EVENT,
  buildAssistantExecutionScope as buildProfileExecutionScope,
  createPrimaryAssistantProfile,
  loadCustomAssistantProfiles,
  type AssistantProfile,
} from '@/shared/assistants/profiles';
import {
  shouldActivateSalesDemo,
  type CapabilitySelectionSource,
} from '@/shared/assistants/routing';
import {
  createSession,
  deleteTask,
  getAllTasks,
  updateTask,
  type Task,
} from '@/shared/db';
import type {
  AgentExecutionScope,
  MessageAttachment,
} from '@/shared/hooks/useAgent';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { generateSessionId } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  ArrowUpRight,
  BadgeDollarSign,
  Bot,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Cog,
  Copy,
  FileText,
  FolderOpen,
  Link,
  Loader2,
  Mail,
  MapPin,
  MonitorSmartphone,
  Network,
  Pencil,
  Phone,
  Plus,
  Radar,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserPlus,
  UserRound,
  WalletCards,
  Wifi,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  salesDemoScenarios,
  salesFaqs,
  type SalesAgentPlan,
  type SalesAgentTrace,
  type SalesDemoTurn,
} from '@/components/home/salesAssistantDemo';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import {
  ChatInput,
  type ChatMode,
  type MentionOption,
} from '@/components/shared/ChatInput';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type CategoryKey = 'organizeFiles' | 'generateDocs' | 'automateTasks';

const categoryIcons: Record<CategoryKey, React.ReactNode> = {
  organizeFiles: <FolderOpen className="size-4" />,
  generateDocs: <FileText className="size-4" />,
  automateTasks: <Cog className="size-4" />,
};

const categoryKeys: CategoryKey[] = [
  'organizeFiles',
  'generateDocs',
  'automateTasks',
];

interface DemoStep {
  prompt: string;
  assistant: Extract<SalesDemoTurn, { role: 'assistant' }>;
}

interface DemoMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentTrace?: SalesAgentTrace;
  plan?: SalesAgentPlan;
  planStepStatuses?: SalesDemoPlanStepStatus[];
  planCompleted?: boolean;
  executionItems?: SalesDemoExecutionItem[];
  visibleExecutionItemCount?: number;
  executionExpanded?: boolean;
  answerStarted?: boolean;
  thinking?: string;
  active?: boolean;
}

type SalesDemoPlanStepStatus = 'pending' | 'in_progress' | 'completed';

interface SalesDemoExecutionItem {
  name: string;
  input?: string;
  output?: string;
  summary: string;
}

interface CollaborationAssistant {
  id: 'sales' | 'meeting' | 'office' | 'document-review';
  name: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: 'orange' | 'sky' | 'emerald' | 'violet';
}

interface CollaborationPeer {
  id: string;
  name: string;
  role: string;
  device: string;
  workspace: string;
  status: 'online' | 'busy';
  address?: string | null;
  source?: 'lan' | 'local';
}

interface CollaborationDraftSession {
  id: string;
  title: string;
  assistantIds: CollaborationAssistant['id'][];
  peerIds: CollaborationPeer['id'][];
  createdAt: string;
  updatedAt: string;
}

type MockDetail =
  | {
      type: 'customer';
      id: string;
    }
  | {
      type: 'policy';
      id: string;
    };

interface AssistantSelectionEventDetail {
  assistant?: AssistantProfile;
  executionScope?: AgentExecutionScope;
  capabilityId?: string | null;
  assistantId?: string;
  assistantName?: string;
  prompt?: string;
  skillNames?: string[];
  mcpServerNames?: string[];
}

function buildAssistantExecutionScopeFromEvent(
  detail?: AssistantSelectionEventDetail
): AgentExecutionScope | undefined {
  if (detail?.executionScope) return detail.executionScope;
  if (detail?.assistant) return buildProfileExecutionScope(detail.assistant);

  const skillNames = detail?.skillNames?.filter(Boolean) || [];
  const mcpServerNames = detail?.mcpServerNames?.filter(Boolean) || [];

  if (
    !detail?.assistantId &&
    !detail?.assistantName &&
    !detail?.prompt &&
    skillNames.length === 0 &&
    mcpServerNames.length === 0
  ) {
    return undefined;
  }

  const instructionParts: string[] = [];
  if (detail?.assistantName) {
    instructionParts.push(`当前助手：${detail.assistantName}`);
  }
  if (detail?.prompt) {
    instructionParts.push(detail.prompt);
  }
  if (skillNames.length > 0) {
    instructionParts.push(`已选 Skills：${skillNames.join('、')}`);
  }
  if (mcpServerNames.length > 0) {
    instructionParts.push(
      `本次仅挂载这些真实 MCP 服务：${mcpServerNames.join('、')}`
    );
  }

  return {
    assistantIds: detail?.assistantId ? [detail.assistantId] : undefined,
    assistantNames: detail?.assistantName ? [detail.assistantName] : undefined,
    skillNames,
    mcpServerNames,
    instruction: `使用当前助手配置。${instructionParts.join('；')}。`,
  };
}

function mergeExecutionScopes(
  primary?: AgentExecutionScope,
  secondary?: AgentExecutionScope
): AgentExecutionScope | undefined {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const skillNames = Array.from(
    new Set([...(primary.skillNames || []), ...(secondary.skillNames || [])])
  );
  const assistantIds = Array.from(
    new Set([
      ...(primary.assistantIds || []),
      ...(secondary.assistantIds || []),
    ])
  );
  const assistantNames = Array.from(
    new Set([
      ...(primary.assistantNames || []),
      ...(secondary.assistantNames || []),
    ])
  );
  const mcpServerNames = Array.from(
    new Set([
      ...(primary.mcpServerNames || []),
      ...(secondary.mcpServerNames || []),
    ])
  );
  const instruction = [primary.instruction, secondary.instruction]
    .filter(Boolean)
    .join('\n');

  return {
    assistantIds:
      Array.isArray(primary.assistantIds) ||
      Array.isArray(secondary.assistantIds)
        ? assistantIds
        : undefined,
    assistantNames:
      Array.isArray(primary.assistantNames) ||
      Array.isArray(secondary.assistantNames)
        ? assistantNames
        : undefined,
    skillNames:
      Array.isArray(primary.skillNames) || Array.isArray(secondary.skillNames)
        ? skillNames
        : undefined,
    mcpServerNames:
      Array.isArray(primary.mcpServerNames) ||
      Array.isArray(secondary.mcpServerNames)
        ? mcpServerNames
        : undefined,
    instruction,
  };
}

const collaborationAssistants: CollaborationAssistant[] = [
  {
    id: 'sales',
    name: '销售助手',
    description: '客户跟进、产品话术、异议处理',
    Icon: BadgeDollarSign,
    tone: 'orange',
  },
  {
    id: 'meeting',
    name: '会议助手',
    description: '纪要、待办、决议和会前材料',
    Icon: CalendarCheck2,
    tone: 'sky',
  },
  {
    id: 'office',
    name: '办公助手',
    description: '资料整理、邮件、跨部门跟进',
    Icon: FolderOpen,
    tone: 'emerald',
  },
  {
    id: 'document-review',
    name: '文档审核',
    description: '方案、合同、制度的风险审核',
    Icon: ShieldCheck,
    tone: 'violet',
  },
];

const defaultCollaborationAssistantIds: CollaborationAssistant['id'][] = [
  'sales',
  'meeting',
];

const initialCollaborationPeers: CollaborationPeer[] = [];

const defaultCollaborationPeerIds: string[] = [];

const COLLABORATION_SESSIONS_STORAGE_KEY =
  'uniins-claw:collaboration-draft-sessions';

function createCollaborationDraftSession(
  index: number
): CollaborationDraftSession {
  const now = new Date().toISOString();
  const cryptoApi = typeof window !== 'undefined' ? window.crypto : undefined;
  const id =
    cryptoApi && 'randomUUID' in cryptoApi
      ? `collaboration-${cryptoApi.randomUUID()}`
      : `collaboration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    title: `协作会话 ${index}`,
    assistantIds: [...defaultCollaborationAssistantIds],
    peerIds: [...defaultCollaborationPeerIds],
    createdAt: now,
    updatedAt: now,
  };
}

function isCollaborationAssistantId(
  value: unknown
): value is CollaborationAssistant['id'] {
  return collaborationAssistants.some((assistant) => assistant.id === value);
}

function loadCollaborationDraftSessions(): CollaborationDraftSession[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(COLLABORATION_SESSIONS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item): CollaborationDraftSession | null => {
        if (!item || typeof item !== 'object') return null;

        const value = item as Partial<CollaborationDraftSession>;
        if (typeof value.id !== 'string' || typeof value.title !== 'string') {
          return null;
        }

        const assistantIds = Array.isArray(value.assistantIds)
          ? value.assistantIds.filter(isCollaborationAssistantId)
          : [];
        const peerIds = Array.isArray(value.peerIds)
          ? value.peerIds.filter(
              (peerId): peerId is string => typeof peerId === 'string'
            )
          : [];

        return {
          id: value.id,
          title: value.title,
          assistantIds:
            assistantIds.length > 0
              ? assistantIds
              : [...defaultCollaborationAssistantIds],
          peerIds,
          createdAt:
            typeof value.createdAt === 'string'
              ? value.createdAt
              : new Date().toISOString(),
          updatedAt:
            typeof value.updatedAt === 'string'
              ? value.updatedAt
              : new Date().toISOString(),
        };
      })
      .filter((item): item is CollaborationDraftSession => Boolean(item));
  } catch {
    return [];
  }
}

function saveCollaborationDraftSessions(sessions: CollaborationDraftSession[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    COLLABORATION_SESSIONS_STORAGE_KEY,
    JSON.stringify(sessions)
  );
}

function getCollaborationSessionTitle(prompt: string) {
  const title = prompt.replace(/\s+/g, ' ').trim();
  if (!title) return '协作会话';
  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
}

function formatCollaborationSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const collaborationQuickPrompts = [
  '把今天客户跟进会拉成协作任务：成员负责客户异议和资料确认，@销售助手 输出下一通电话话术。',
  '@会议助手 为这个协作群生成会议议程、决议模板、责任人字段和会后跟进清单。',
  '大家一起准备明天客户方案评审：成员负责确认业务事实，智能助手负责检索、整理和输出可交付材料。',
];

const sleep = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

function splitStreamChunk(chunk: string) {
  const pieces = chunk.match(/.{1,16}(?:[，。；：、\n]|$)?/gu);
  return pieces?.filter(Boolean) ?? [chunk];
}

function getThinkingSummary(step: DemoStep) {
  if (step.assistant.agentTrace?.decisions.length) {
    return step.assistant.agentTrace.decisions.join('\n');
  }

  const prompt = step.prompt;

  if (prompt.includes('等待期和免赔额')) {
    return [
      '用户问的是安康优享百万医疗的两个高频条款点：等待期和免赔额。',
      '先锁定产品为医疗险，而不是重疾险或寿险，因为不同险种的等待期口径差异很大。',
      '再把条款语言拆成销售人员能解释的字段：疾病住院、意外医疗、一般医疗、重大疾病医疗。',
      '免赔额部分需要特别区分“一般医疗 1 万”和“重疾医疗 0 免赔”，否则容易给客户造成全责任 0 免赔的误解。',
      '最后补一句销售提醒：这类百万医疗更适合解释大额住院风险，不要包装成普通小病门诊报销产品。',
    ].join('\n');
  }

  if (prompt.includes('普通门诊')) {
    return [
      '这是上一轮条款咨询的追问，用户没有重复产品名，需要沿用安康优享百万医疗的上下文。',
      '问题焦点从等待期和免赔额转到门诊责任，需要先判断“普通门诊”和“特殊门诊”是不是同一责任。',
      '普通感冒发烧这类门诊通常不是百万医疗的核心报销范围，所以回答要直接否定，避免模糊表达。',
      '同时补充特殊门诊、门诊手术、住院前后门急诊这些可讲责任，方便代理人继续解释。',
    ].join('\n');
  }

  if (prompt.includes('安康优享百万医疗和康惠保长期医疗')) {
    return [
      '用户明确给出了两款产品，当前任务不是泛泛推荐，而是做产品信息比对。',
      '先拆出产品 A 和产品 B，避免把长期医疗、百万医疗和重疾医疗混在一起比较。',
      '对销售端来说，最有用的不是罗列所有条款，而是抓住保障期限、续保稳定性、免赔额和增值服务。',
      '安康优享的优势更偏低成本、短期补缺口；康惠保长期医疗的优势更偏保证续保和家庭配置稳定性。',
      '输出时用表格更像真实业务助手，因为代理人可以直接拿给客户解释。',
      '最后需要给一个选择建议：客户关心长期稳定就讲康惠保，客户先低成本试配就讲安康优享。',
    ].join('\n');
  }

  if (prompt.includes('银保渠道代理人')) {
    return [
      '这不是单纯问产品清单，用户给出了渠道、年龄和家庭责任三个约束。',
      '先识别渠道为银保渠道，推荐范围必须限制在该渠道可售产品，不能推荐个险或经代专属产品。',
      '客户 35 岁且有家庭责任，说明核心风险是医疗支出、收入中断和长期家庭资产安排。',
      '先过滤掉不在银保渠道、停售、年龄不适配或不适合家庭经济支柱的产品。',
      '推荐顺序要符合真实销售沟通：先用医疗险解决大额支出，再用重疾险讲收入损失，最后再谈终身寿或储蓄类产品。',
      '回答里要明确“根据银保渠道可售清单”，让代理人感受到推荐是受渠道权限约束的。',
    ].join('\n');
  }

  if (prompt.includes('甲状腺结节 3 类')) {
    return [
      '用户描述的是健康异常，不是产品条款问题，需要切到核保咨询逻辑。',
      '关键词是“甲状腺结节 3 类”和“重疾险”，这类情况通常不能直接承诺标准体。',
      '先确认需要收集最近一次甲状腺超声，因为分级、大小、边界、血流会影响核保判断。',
      '如果客户有穿刺、手术或病理记录，也要一次性提醒补充，避免代理人反复追问客户。',
      '甲功检查结果可以辅助说明当前功能是否异常，但不能替代影像资料。',
      '结论表达必须保守，只能说可能进入人工核保，不能提前承诺通过、除外或加费。',
    ].join('\n');
  }

  if (prompt.includes('建议书生成失败')) {
    return [
      '用户问的是建议书生成失败，属于销售系统操作问题，不应该按产品咨询回答。',
      '先判断一线可自查项：登录态、网络、刷新页面，这些处理成本最低。',
      '如果基础环境正常，再检查业务限制：产品是否停售、渠道是否有权限、客户年龄是否在投保范围。',
      '建议书失败经常和费率计算、产品规则校验有关，所以需要让代理人保留错误码。',
      '最后给工单分类和附件要求，方便运维拿到代理人工号、产品、客户年龄和截图后继续定位。',
    ].join('\n');
  }

  if (prompt.includes('客户李明')) {
    return [
      '用户想查客户李明的保单状态，意图属于客户和保单信息查询。',
      '这里涉及个人和保单敏感信息，不能只凭姓名直接返回结果。',
      '先检查问题里有没有客户号或保单号，当前只有姓名，没有可唯一定位的编号。',
      '真实系统里同名客户可能很多，所以需要先索要客户号或保单号。',
      '本轮只给追问话术，不拼接详情链接，等用户补充编号后再进入查询结果。',
    ].join('\n');
  }

  if (prompt.includes('客户号 C10086')) {
    return [
      '用户补充的是客户号，不是保单号，因此要走客户详情入口。',
      '先提取编号 C10086，并判断格式满足客户号查询的最小入参要求。',
      '客户号能定位到客户维度信息，但保单明细仍需要到客户详情页继续查看名下保单。',
      '接下来拼接客户详情链接，并把 customerNo 参数写入链接路径。',
      '回答中要使用指定话术，提示点击链接查看证件、联系方式、名下保单和服务记录。',
      '同时避免直接在聊天里暴露过多客户隐私信息。',
    ].join('\n');
  }

  if (prompt.includes('保单号 P20260521001')) {
    return [
      '用户这次明确说“再查保单号”，需要从上一轮客户查询切换到保单查询。',
      '先提取保单号 P20260521001，不能继续沿用客户号链接。',
      '保单号查询的目标是保单状态、缴费计划、责任明细和批改记录。',
      '随后拼接保单详情页链接，并确保链接参数使用 policyNo 对应的编号。',
      '回答保持固定话术，但展示内容要和客户详情区分开。',
    ].join('\n');
  }

  return step.assistant.thinking.join('\n');
}

function getSalesDemoPlan(step: DemoStep): SalesAgentPlan | null {
  if (step.assistant.plan) return step.assistant.plan;

  if (!step.assistant.agentTrace) return null;

  return {
    goal: `处理${step.assistant.agentTrace.intent}并输出可执行话术`,
    steps: [
      '识别业务意图和必要查询入参',
      '调用相关工具获取业务信息',
      '整理为销售人员可直接使用的答复',
    ],
    note: '基于当前助手配置和业务规则生成回答',
  };
}

function buildSalesDemoExecutionItems(
  step: DemoStep,
  plan: SalesAgentPlan | null
): SalesDemoExecutionItem[] {
  const trace = step.assistant.agentTrace;
  if (!trace || !plan) return [];

  const items: SalesDemoExecutionItem[] = [
    {
      name: 'TodoWrite',
      summary: 'Todo list updated',
      output: plan.steps.map((item) => `- ${item}`).join('\n'),
    },
  ];

  for (const tool of trace.tools) {
    items.push({
      name: tool.name,
      input: tool.input,
      output: tool.output,
      summary: tool.name.startsWith('mcp__')
        ? '销售知识库查询完成'
        : getFirstOutputLine(tool.output),
    });
  }

  items.push({
    name: 'TodoWrite',
    summary: 'Todo list updated',
    output: '计划步骤已完成，开始整理最终回答。',
  });

  return items;
}

function getFirstOutputLine(output: string) {
  return output.split('\n').find((line) => line.trim()) || '执行完成';
}

const salesDemoSteps: DemoStep[] = salesDemoScenarios.flatMap((scenario) => {
  const steps: DemoStep[] = [];

  for (let index = 0; index < scenario.turns.length - 1; index++) {
    const currentTurn = scenario.turns[index];
    const nextTurn = scenario.turns[index + 1];

    if (currentTurn.role === 'user' && nextTurn.role === 'assistant') {
      steps.push({
        prompt: currentTurn.prompt,
        assistant: nextTurn,
      });
    }
  }

  return steps;
});

const customerPolicyDemoPrompt =
  salesDemoSteps.find((step) => step.prompt.includes('客户李明'))?.prompt ??
  '客户、保单信息咨询：帮我查一下客户李明的保单状态。';

function normalizeMockPrompt(text: string) {
  return text.replace(/^使用以下能力：(?:销售演示|销售助手)。\s*/u, '').trim();
}

function getSalesDemoStepIndexForPrompt(prompt: string) {
  const normalizedPrompt = normalizeMockPrompt(prompt);

  const routeMarkers = [
    {
      input: '客户号',
      step: '客户号 C10086',
    },
    {
      input: '保单号',
      step: '保单号 P20260521001',
    },
    {
      input: '客户李明',
      step: '客户李明',
    },
    {
      input: '客户、保单信息咨询',
      step: '客户李明',
    },
    {
      input: '保单状态',
      step: '客户李明',
    },
  ];

  const matchedRoute = routeMarkers.find((route) =>
    normalizedPrompt.includes(route.input)
  );
  if (!matchedRoute) return null;

  const stepIndex = salesDemoSteps.findIndex((step) =>
    step.prompt.includes(matchedRoute.step)
  );

  return stepIndex >= 0 ? stepIndex : null;
}

function getCollaborationAssistant(assistantId: CollaborationAssistant['id']) {
  return collaborationAssistants.find(
    (assistant) => assistant.id === assistantId
  );
}

function hasExactAssistantMention(prompt: string, assistantName: string) {
  const escapedName = assistantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(^|\\s)@${escapedName}(?=$|[\\s，。,.!?！？、:：；;])`,
    'u'
  ).test(prompt);
}

function getCollaborationTargets(
  prompt: string,
  participantIds: CollaborationAssistant['id'][]
) {
  const mentioned = participantIds.filter((assistantId) => {
    const assistant = getCollaborationAssistant(assistantId);
    return assistant ? hasExactAssistantMention(prompt, assistant.name) : false;
  });

  if (mentioned.length > 0) return mentioned;
  if (/大家|一起|协作|所有助手/u.test(prompt)) return participantIds;

  return participantIds.slice(0, 1);
}

function getAssistantToneClasses(tone: CollaborationAssistant['tone']) {
  return {
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
  }[tone];
}

function buildCollaborationAgentPrompt(
  prompt: string,
  participants: CollaborationAssistant[],
  targets: CollaborationAssistant[],
  humanMembers: CollaborationPeer[]
) {
  const participantLines = participants.map(
    (assistant) => `- @${assistant.name}：${assistant.description}`
  );
  const humanMemberLines = humanMembers.map(
    (member) =>
      `- ${member.name}（${member.role}，${member.device}，${member.workspace}）`
  );
  const targetNames = targets
    .map((assistant) => `@${assistant.name}`)
    .join('、');

  return [
    '这是一个局域网协作会话群。群里有人类成员和智能助手，所有成员都能看到任务、过程、结论和后续待办。',
    '请作为被拉入群的真实智能助手执行，不要使用模拟数据，也不要假装已有外部系统结果；需要工具、文件、检索、代码或系统能力时，按正常智能体能力完成。',
    '',
    '局域网成员：',
    ...humanMemberLines,
    '',
    '智能助手：',
    ...participantLines,
    '',
    `本轮明确响应对象：${targetNames || '按任务需要在参与助手之间分工'}`,
    '',
    '回答要求：',
    '- 如果用户用 @ 指定了某个助手，优先以该助手职责处理。',
    '- 如果用户要求大家一起协作，请同时给出人类成员分工和智能助手分工。',
    '- 输出必须包含共享可见的工作进展、责任人、下一步和需要人确认的事项。',
    '- 需要执行任务时直接执行；需要用户补充信息时只问必要问题。',
    '- 输出要可直接用于协作群推进，避免只像单人聊天回复。',
    '',
    '用户输入：',
    prompt,
  ].join('\n');
}

function getMockDetailFromHref(href: string): MockDetail | null {
  try {
    const url = new URL(href);
    const customerNo =
      url.searchParams.get('customerNo') ||
      url.pathname.match(/\/customers\/([^/]+)/u)?.[1];
    const policyNo =
      url.searchParams.get('policyNo') ||
      url.pathname.match(/\/policies\/([^/]+)/u)?.[1];

    if (
      customerNo &&
      (url.hostname === 'crm.example.com' ||
        url.hostname === 'agent.insure.com')
    ) {
      return {
        type: 'customer',
        id: decodeURIComponent(customerNo),
      };
    }

    if (
      policyNo &&
      (url.hostname === 'policy.example.com' ||
        url.hostname === 'agent.insure.com')
    ) {
      return {
        type: 'policy',
        id: decodeURIComponent(policyNo),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function HomePage() {
  return (
    <SidebarProvider>
      <HomeContent />
    </SidebarProvider>
  );
}

function HomeContent() {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(
    null
  );
  const [salesDemoActive, setSalesDemoActive] = useState(false);
  const [assistantExecutionScope, setAssistantExecutionScope] = useState<
    AgentExecutionScope | undefined
  >(undefined);
  const [assistantProfiles, setAssistantProfiles] = useState<
    AssistantProfile[]
  >(() => [
    createPrimaryAssistantProfile(t.nav.primaryAssistant),
    ...loadCustomAssistantProfiles(),
  ]);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<
    string | null
  >(null);
  const [demoStepIndex, setDemoStepIndex] = useState(0);
  const [demoMessages, setDemoMessages] = useState<DemoMessage[]>([]);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoCompleted, setDemoCompleted] = useState(false);
  const [mockDetail, setMockDetail] = useState<MockDetail | null>(null);
  const [collaborationActive, setCollaborationActive] = useState(false);
  const [collaborationSessions, setCollaborationSessions] = useState<
    CollaborationDraftSession[]
  >(() => loadCollaborationDraftSessions());
  const [activeCollaborationSessionId, setActiveCollaborationSessionId] =
    useState<string | null>(
      () => loadCollaborationDraftSessions()[0]?.id ?? null
    );
  const [availableCollaborationPeers, setAvailableCollaborationPeers] =
    useState<CollaborationPeer[]>(initialCollaborationPeers);
  const [collaborationRunning, setCollaborationRunning] = useState(false);
  const [collaborationRenameSession, setCollaborationRenameSession] =
    useState<CollaborationDraftSession | null>(null);
  const [collaborationRenameValue, setCollaborationRenameValue] = useState('');
  const [collaborationDeleteSession, setCollaborationDeleteSession] =
    useState<CollaborationDraftSession | null>(null);
  const demoMessagesEndRef = useRef<HTMLDivElement>(null);
  const demoRunRef = useRef(0);
  const navigate = useNavigate();

  const hasDemoConversation = demoMessages.length > 0 || demoRunning;
  const nextDemoStep = salesDemoSteps[demoStepIndex];
  const activeCollaborationSession = useMemo(
    () =>
      collaborationSessions.find(
        (session) => session.id === activeCollaborationSessionId
      ) ||
      collaborationSessions[0] ||
      null,
    [activeCollaborationSessionId, collaborationSessions]
  );
  const collaborationAssistantIds = activeCollaborationSession?.assistantIds
    .length
    ? activeCollaborationSession.assistantIds
    : defaultCollaborationAssistantIds;
  const collaborationPeerIds = activeCollaborationSession?.peerIds ?? [];
  const activeCollaborationAssistants = collaborationAssistantIds
    .map(getCollaborationAssistant)
    .filter(Boolean) as CollaborationAssistant[];
  const activeCollaborationPeers = collaborationPeerIds
    .map((peerId) =>
      availableCollaborationPeers.find((peer) => peer.id === peerId)
    )
    .filter(Boolean) as CollaborationPeer[];
  const collaborationMentionOptions: MentionOption[] =
    activeCollaborationAssistants.map((assistant) => ({
      id: assistant.id,
      label: assistant.name,
      description: assistant.description,
      icon: assistant.Icon,
    }));
  const assistantMentionOptions: MentionOption[] = assistantProfiles
    .filter((assistant) => assistant.id !== 'primary')
    .map((assistant) => ({
      id: assistant.id,
      label: assistant.name,
      description: assistant.description || assistant.prompt,
      icon: Bot,
      executionScope: buildProfileExecutionScope(assistant),
    }));

  useEffect(() => {
    demoMessagesEndRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [demoMessages]);

  useEffect(() => {
    saveCollaborationDraftSessions(collaborationSessions);
  }, [collaborationSessions]);

  const updateDemoMessage = useCallback(
    (messageId: string, patch: Partial<DemoMessage>) => {
      setDemoMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, ...patch } : message
        )
      );
    },
    []
  );

  const toggleDemoExecutionSteps = useCallback((messageId: string) => {
    setDemoMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              executionExpanded: !message.executionExpanded,
            }
          : message
      )
    );
  }, []);

  const resetSalesDemo = useCallback(() => {
    demoRunRef.current += 1;
    setPendingPrompt('');
    setDemoStepIndex(0);
    setDemoMessages([]);
    setDemoRunning(false);
    setDemoCompleted(false);
  }, []);

  const loadLanCollaborationPeers = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId || activeCollaborationSessionId;

      if (!isTauri()) {
        return;
      }

      try {
        const peers = await invoke<CollaborationPeer[]>(
          'discover_lan_collaboration_peers'
        );
        if (peers.length === 0) return;

        setAvailableCollaborationPeers(peers);
        if (!targetSessionId) return;

        setCollaborationSessions((current) => {
          const validIds = new Set(peers.map((peer) => peer.id));
          const now = new Date().toISOString();

          return current.map((session) => {
            if (session.id !== targetSessionId) return session;

            const stillAvailable = session.peerIds.filter((peerId) =>
              validIds.has(peerId)
            );
            const peerIds =
              stillAvailable.length > 0
                ? stillAvailable
                : peers
                    .slice(0, Math.min(2, peers.length))
                    .map((peer) => peer.id);

            return { ...session, peerIds, updatedAt: now };
          });
        });
      } catch (error) {
        console.warn('[Home] LAN collaboration discovery failed:', error);
      }
    },
    [activeCollaborationSessionId]
  );

  const createCollaborationSession = useCallback(() => {
    const session = createCollaborationDraftSession(
      collaborationSessions.length + 1
    );
    setCollaborationSessions((current) => [session, ...current]);
    setActiveCollaborationSessionId(session.id);
    setCollaborationActive(true);
    setSalesDemoActive(false);
    setAssistantExecutionScope(undefined);
    setSelectedCapabilityId(null);
    setActiveCategory(null);
    resetSalesDemo();
    setPendingPrompt('');
    void loadLanCollaborationPeers(session.id);
  }, [collaborationSessions.length, loadLanCollaborationPeers, resetSalesDemo]);

  const startCollaborationSession = useCallback(
    (options: { createNew?: boolean } = {}) => {
      if (options.createNew) {
        createCollaborationSession();
        return;
      }

      let targetSessionId = activeCollaborationSession?.id || null;

      if (!targetSessionId) {
        const session = createCollaborationDraftSession(1);
        targetSessionId = session.id;
        setCollaborationSessions([session]);
      }

      if (targetSessionId) {
        setActiveCollaborationSessionId(targetSessionId);
      }
      setCollaborationActive(true);
      setSalesDemoActive(false);
      setAssistantExecutionScope(undefined);
      setSelectedCapabilityId(null);
      setActiveCategory(null);
      resetSalesDemo();
      setPendingPrompt('');
      void loadLanCollaborationPeers(targetSessionId || undefined);
    },
    [
      activeCollaborationSession?.id,
      createCollaborationSession,
      loadLanCollaborationPeers,
      resetSalesDemo,
    ]
  );

  const selectCollaborationSession = useCallback(
    (sessionId: string) => {
      setActiveCollaborationSessionId(sessionId);
      setCollaborationActive(true);
      setSalesDemoActive(false);
      setAssistantExecutionScope(undefined);
      setSelectedCapabilityId(null);
      setActiveCategory(null);
      resetSalesDemo();
      setPendingPrompt('');
      void loadLanCollaborationPeers(sessionId);
    },
    [loadLanCollaborationPeers, resetSalesDemo]
  );

  const openRenameCollaborationSession = useCallback(
    (session: CollaborationDraftSession) => {
      setCollaborationRenameSession(session);
      setCollaborationRenameValue(session.title);
    },
    []
  );

  const closeRenameCollaborationSession = useCallback(() => {
    setCollaborationRenameSession(null);
    setCollaborationRenameValue('');
  }, []);

  const confirmRenameCollaborationSession = useCallback(() => {
    const title = collaborationRenameValue.trim();
    if (!collaborationRenameSession || !title) return;

    setCollaborationSessions((current) =>
      current.map((session) =>
        session.id === collaborationRenameSession.id
          ? {
              ...session,
              title,
              updatedAt: new Date().toISOString(),
            }
          : session
      )
    );
    closeRenameCollaborationSession();
  }, [
    closeRenameCollaborationSession,
    collaborationRenameSession,
    collaborationRenameValue,
  ]);

  const requestDeleteCollaborationSession = useCallback(
    (session: CollaborationDraftSession) => {
      setCollaborationDeleteSession(session);
    },
    []
  );

  const closeDeleteCollaborationSession = useCallback(() => {
    setCollaborationDeleteSession(null);
  }, []);

  const confirmDeleteCollaborationSession = useCallback(() => {
    if (!collaborationDeleteSession) return;

    const nextSessions = collaborationSessions.filter(
      (session) => session.id !== collaborationDeleteSession.id
    );

    if (nextSessions.length === 0) {
      const replacement = createCollaborationDraftSession(1);
      setCollaborationSessions([replacement]);
      setActiveCollaborationSessionId(replacement.id);
    } else {
      setCollaborationSessions(nextSessions);
      if (activeCollaborationSessionId === collaborationDeleteSession.id) {
        setActiveCollaborationSessionId(nextSessions[0].id);
      }
    }

    closeDeleteCollaborationSession();
  }, [
    activeCollaborationSessionId,
    closeDeleteCollaborationSession,
    collaborationDeleteSession,
    collaborationSessions,
  ]);

  const startNewSession = useCallback(() => {
    setCollaborationActive(false);
    setCollaborationRunning(false);
    setAvailableCollaborationPeers(initialCollaborationPeers);
    setSalesDemoActive(false);
    setAssistantExecutionScope(undefined);
    setSelectedCapabilityId(null);
    setActiveCategory(null);
    setMockDetail(null);
    resetSalesDemo();
    setPendingPrompt('');
  }, [resetSalesDemo]);

  const handleCapabilitySelect = useCallback(
    (
      capabilityId: string | null,
      source: CapabilitySelectionSource = 'capability-chip'
    ) => {
      setCollaborationActive(false);
      setAssistantExecutionScope(undefined);
      const shouldRunSalesDemo = shouldActivateSalesDemo(capabilityId, source);
      setSelectedCapabilityId(
        source === 'capability-chip' ? capabilityId : null
      );
      setSalesDemoActive(shouldRunSalesDemo);
      setActiveCategory(null);

      if (!shouldRunSalesDemo) {
        resetSalesDemo();
      }
    },
    [resetSalesDemo]
  );

  useEffect(() => {
    const handleProfilesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ assistants?: AssistantProfile[] }>)
        .detail;
      if (Array.isArray(detail?.assistants)) {
        setAssistantProfiles(detail.assistants);
      }
    };

    window.addEventListener(
      ASSISTANT_PROFILES_CHANGED_EVENT,
      handleProfilesChanged
    );
    return () => {
      window.removeEventListener(
        ASSISTANT_PROFILES_CHANGED_EVENT,
        handleProfilesChanged
      );
    };
  }, []);

  useEffect(() => {
    const handleAssistantSelection = (event: Event) => {
      const detail = (event as CustomEvent<AssistantSelectionEventDetail>)
        .detail;
      handleCapabilitySelect(
        detail?.capabilityId ?? null,
        'assistant-selection'
      );
      setAssistantExecutionScope(buildAssistantExecutionScopeFromEvent(detail));
    };
    const handleCollaborationStart = (event: Event) => {
      const detail = (event as CustomEvent<{ createNew?: boolean }>).detail;
      startCollaborationSession(detail);
    };

    window.addEventListener(
      'uniins-claw:assistant-selected',
      handleAssistantSelection
    );
    window.addEventListener(
      'uniins-claw:collaboration-session-start',
      handleCollaborationStart
    );
    window.addEventListener('uniins-claw:new-session-start', startNewSession);

    return () => {
      window.removeEventListener(
        'uniins-claw:assistant-selected',
        handleAssistantSelection
      );
      window.removeEventListener(
        'uniins-claw:collaboration-session-start',
        handleCollaborationStart
      );
      window.removeEventListener(
        'uniins-claw:new-session-start',
        startNewSession
      );
    };
  }, [handleCapabilitySelect, startCollaborationSession, startNewSession]);

  const handleInputActivate = useCallback(() => {
    if (
      !salesDemoActive ||
      demoRunning ||
      demoCompleted ||
      pendingPrompt ||
      !nextDemoStep
    ) {
      return;
    }

    setPendingPrompt(nextDemoStep.prompt);
  }, [
    demoCompleted,
    demoRunning,
    nextDemoStep,
    pendingPrompt,
    salesDemoActive,
  ]);

  const streamMockAssistant = useCallback(
    async (step: DemoStep, runId: number) => {
      const assistantMessageId = `assistant-${Date.now()}`;
      const plan = getSalesDemoPlan(step);
      const executionItems = buildSalesDemoExecutionItems(step, plan);
      setDemoMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          agentTrace: step.assistant.agentTrace,
          plan: plan || undefined,
          planStepStatuses: plan?.steps.map(() => 'pending'),
          planCompleted: false,
          executionItems,
          visibleExecutionItemCount: 0,
          executionExpanded: true,
          answerStarted: !plan,
          thinking: '',
          active: true,
        },
      ]);

      await sleep(260);

      if (plan) {
        for (let index = 0; index < plan.steps.length; index++) {
          if (demoRunRef.current !== runId) return false;
          updateDemoMessage(assistantMessageId, {
            planStepStatuses: plan.steps.map((_, stepIndex) =>
              stepIndex < index
                ? 'completed'
                : stepIndex === index
                  ? 'in_progress'
                  : 'pending'
            ),
          });
          await sleep(360);

          if (demoRunRef.current !== runId) return false;
          updateDemoMessage(assistantMessageId, {
            planStepStatuses: plan.steps.map((_, stepIndex) =>
              stepIndex <= index ? 'completed' : 'pending'
            ),
          });
          await sleep(180);
        }

        updateDemoMessage(assistantMessageId, { planCompleted: true });
        await sleep(260);

        for (let index = 0; index < executionItems.length; index++) {
          if (demoRunRef.current !== runId) return false;
          updateDemoMessage(assistantMessageId, {
            visibleExecutionItemCount: index + 1,
          });
          await sleep(520);
        }
      } else {
        let thinking = '';
        for (const char of getThinkingSummary(step)) {
          if (demoRunRef.current !== runId) return false;
          thinking += char;
          updateDemoMessage(assistantMessageId, { thinking });
          await sleep(28);
        }
      }

      await sleep(310);
      updateDemoMessage(assistantMessageId, { answerStarted: true });

      let content = '';
      for (const chunk of step.assistant.chunks) {
        for (const piece of splitStreamChunk(chunk)) {
          if (demoRunRef.current !== runId) return false;
          content += piece;
          updateDemoMessage(assistantMessageId, { content });
          await sleep(piece.includes('\n') ? 110 : 48);
        }
      }

      updateDemoMessage(assistantMessageId, { active: false });
      return demoRunRef.current === runId;
    },
    [updateDemoMessage]
  );

  const handleCategoryClick = (key: CategoryKey) => {
    setActiveCategory((prev) => (prev === key ? null : key));
    setCollaborationActive(false);
    setSalesDemoActive(false);
    setAssistantExecutionScope(undefined);
    setSelectedCapabilityId(null);
    resetSalesDemo();
    setPendingPrompt('');
  };

  const handlePromptClick = (prompt: string) => {
    setPendingPrompt(prompt);
  };

  const handleCloseCategory = () => {
    setActiveCategory(null);
    setPendingPrompt('');
  };

  const handlePendingConsumed = useCallback(() => {
    setPendingPrompt('');
  }, []);

  const handleCollaborationQuickPrompt = (prompt: string) => {
    setPendingPrompt(prompt);
  };

  const handleToggleCollaborationAssistant = (
    assistantId: CollaborationAssistant['id']
  ) => {
    if (!activeCollaborationSession) return;

    setCollaborationSessions((current) => {
      const now = new Date().toISOString();

      return current.map((session) => {
        if (session.id !== activeCollaborationSession.id) return session;

        const nextAssistantIds = session.assistantIds.includes(assistantId)
          ? session.assistantIds.length > 1
            ? session.assistantIds.filter((id) => id !== assistantId)
            : session.assistantIds
          : [...session.assistantIds, assistantId];

        return {
          ...session,
          assistantIds: nextAssistantIds,
          updatedAt: now,
        };
      });
    });
  };

  const handleToggleCollaborationPeer = (peerId: CollaborationPeer['id']) => {
    if (!activeCollaborationSession) return;

    setCollaborationSessions((current) => {
      const now = new Date().toISOString();

      return current.map((session) => {
        if (session.id !== activeCollaborationSession.id) return session;

        const nextPeerIds = session.peerIds.includes(peerId)
          ? session.peerIds.length > 1
            ? session.peerIds.filter((id) => id !== peerId)
            : session.peerIds
          : [...session.peerIds, peerId];

        return {
          ...session,
          peerIds: nextPeerIds,
          updatedAt: now,
        };
      });
    });
  };

  const handleOpenMockDetail = useCallback((href: string) => {
    const detail = getMockDetailFromHref(href);
    if (!detail) return false;

    setMockDetail(detail);
    return true;
  }, []);

  const handleCollaborationSubmit = useCallback(
    async (
      text: string,
      attachments?: MessageAttachment[],
      executionScope?: AgentExecutionScope
    ) => {
      const prompt = text.trim();
      if (!prompt || collaborationRunning) return;

      setCollaborationRunning(true);
      try {
        const targets = getCollaborationTargets(
          prompt,
          collaborationAssistantIds
        )
          .map(getCollaborationAssistant)
          .filter(Boolean) as CollaborationAssistant[];
        const agentPrompt = buildCollaborationAgentPrompt(
          prompt,
          activeCollaborationAssistants,
          targets,
          activeCollaborationPeers
        );
        const sessionId = generateSessionId(prompt);
        const draftSessionId = activeCollaborationSession?.id;

        if (draftSessionId) {
          setCollaborationSessions((current) =>
            current.map((session) =>
              session.id === draftSessionId
                ? {
                    ...session,
                    title: getCollaborationSessionTitle(prompt),
                    updatedAt: new Date().toISOString(),
                  }
                : session
            )
          );
        }

        try {
          await createSession({ id: sessionId, prompt });
          console.log('[Home] Created collaboration session:', sessionId);
        } catch (error) {
          console.error(
            '[Home] Failed to create collaboration session:',
            error
          );
        }

        navigate(`/task/${Date.now().toString()}`, {
          state: {
            prompt: agentPrompt,
            sessionId,
            taskIndex: 1,
            attachments,
            mode: 'task' satisfies ChatMode,
            executionScope,
          },
        });
      } finally {
        setPendingPrompt('');
        setCollaborationRunning(false);
      }
    },
    [
      activeCollaborationSession?.id,
      activeCollaborationAssistants,
      activeCollaborationPeers,
      collaborationAssistantIds,
      collaborationRunning,
      navigate,
    ]
  );

  // Subscribe to background tasks
  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks(setBackgroundTasks);
    return unsubscribe;
  }, []);

  // Load tasks for sidebar
  useEffect(() => {
    async function loadTasks() {
      try {
        const allTasks = await getAllTasks();
        setTasks(allTasks);
      } catch (error) {
        console.error('Failed to load tasks:', error);
      }
    }
    loadTasks();
  }, []);

  // Handle task deletion
  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  // Handle favorite toggle
  const handleToggleFavorite = async (taskId: string, favorite: boolean) => {
    try {
      await updateTask(taskId, { favorite });
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, favorite } : t))
      );
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleSubmit = async (
    text: string,
    attachments?: MessageAttachment[],
    mode?: ChatMode,
    inputExecutionScope?: AgentExecutionScope
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    const prompt = text.trim();

    if (collaborationActive) {
      await handleCollaborationSubmit(prompt, attachments, inputExecutionScope);
      return;
    }

    if (salesDemoActive) {
      if (demoRunning) return;

      const runId = demoRunRef.current + 1;
      demoRunRef.current = runId;
      const displayPrompt = normalizeMockPrompt(prompt);
      const routedStepIndex =
        getSalesDemoStepIndexForPrompt(displayPrompt) ?? demoStepIndex;
      const routedStep = salesDemoSteps[routedStepIndex];

      if (!routedStep) return;

      setDemoRunning(true);
      setDemoMessages((current) => [
        ...current,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: displayPrompt || routedStep.prompt,
        },
      ]);

      const completed = await streamMockAssistant(routedStep, runId);
      if (!completed) return;

      const nextIndex = routedStepIndex + 1;
      setDemoStepIndex(nextIndex);
      setDemoCompleted(nextIndex >= salesDemoSteps.length);
      setPendingPrompt('');
      setDemoRunning(false);
      return;
    }

    // Create a new session
    const sessionId = generateSessionId(prompt);
    try {
      await createSession({ id: sessionId, prompt });
      console.log('[Home] Created new session:', sessionId);
    } catch (error) {
      console.error('[Home] Failed to create session:', error);
    }

    // Generate task ID and navigate with attachments
    const taskId = Date.now().toString();
    console.log(
      '[Home] Navigating with attachments:',
      attachments?.length || 0
    );

    navigate(`/task/${taskId}`, {
      state: {
        prompt,
        sessionId,
        taskIndex: 1,
        attachments,
        mode,
        executionScope: mergeExecutionScopes(
          assistantExecutionScope,
          inputExecutionScope
        ),
      },
    });
  };

  const categories = t.home.examplePrompts.categories;
  const activeCategoryData = activeCategory ? categories[activeCategory] : null;
  const hasActiveConversation = hasDemoConversation || collaborationActive;
  const inputPlaceholder = useMemo(() => {
    if (collaborationActive) {
      return '在协作群里安排任务，可 @销售助手、@会议助手，也可指定成员负责人';
    }

    if (salesDemoActive && demoCompleted) {
      return '本轮咨询已完成，可继续输入新的业务问题';
    }

    if (salesDemoActive) {
      return '请输入产品、核保、保单或系统操作相关问题';
    }

    return activeCategoryData?.placeholder ?? t.home.inputPlaceholder;
  }, [
    activeCategoryData?.placeholder,
    collaborationActive,
    demoCompleted,
    salesDemoActive,
    t.home.inputPlaceholder,
  ]);

  const chatInput = (
    <ChatInput
      variant="home"
      placeholder={inputPlaceholder}
      isRunning={demoRunning || collaborationRunning}
      onSubmit={handleSubmit}
      className="w-full"
      autoFocus={!salesDemoActive}
      externalValue={pendingPrompt}
      onExternalValueConsumed={handlePendingConsumed}
      onCapabilitySelect={handleCapabilitySelect}
      selectedCapabilityId={selectedCapabilityId}
      onInputActivate={handleInputActivate}
      preserveCapabilitiesOnSubmit={salesDemoActive}
      showCapabilities={!collaborationActive}
      mentionOptions={
        collaborationActive
          ? collaborationMentionOptions
          : assistantMentionOptions
      }
      categoryTag={
        activeCategory && activeCategoryData
          ? {
              icon: categoryIcons[activeCategory],
              label: activeCategoryData.label,
              onClose: handleCloseCategory,
            }
          : undefined
      }
    />
  );

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={backgroundTasks
          .filter((t) => t.isRunning)
          .map((t) => t.taskId)}
      />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden px-4',
            hasActiveConversation ? 'py-5' : 'items-center justify-center'
          )}
        >
          <div
            className={cn(
              'flex w-full flex-col items-center gap-6',
              collaborationActive
                ? 'mx-auto min-h-0 max-w-6xl flex-1'
                : hasActiveConversation
                  ? 'mx-auto min-h-0 max-w-5xl flex-1'
                  : 'max-w-2xl'
            )}
          >
            {/* Title */}
            {!hasActiveConversation && (
              <h1 className="text-foreground text-center font-serif text-4xl font-normal tracking-tight md:text-5xl">
                {t.home.welcomeTitle}
              </h1>
            )}

            {collaborationActive ? (
              <CollaborationStartPanel
                sessions={collaborationSessions}
                activeSessionId={activeCollaborationSession?.id ?? null}
                activeAssistants={activeCollaborationAssistants}
                activePeers={activeCollaborationPeers}
                availablePeers={availableCollaborationPeers}
                assistantIds={collaborationAssistantIds}
                peerIds={collaborationPeerIds}
                onSelectSession={selectCollaborationSession}
                onCreateSession={createCollaborationSession}
                onRenameSession={openRenameCollaborationSession}
                onDeleteSession={requestDeleteCollaborationSession}
                onToggleAssistant={handleToggleCollaborationAssistant}
                onTogglePeer={handleToggleCollaborationPeer}
                onPromptClick={handleCollaborationQuickPrompt}
              >
                {chatInput}
              </CollaborationStartPanel>
            ) : (
              <>
                {salesDemoActive && !hasDemoConversation && (
                  <SalesAssistantFaqPanel
                    completed={demoCompleted}
                    onPromptClick={handlePromptClick}
                  />
                )}

                {hasDemoConversation && (
                  <div className="scrollbar-soft min-h-0 w-full flex-1 overflow-y-auto pr-2">
                    <div className="space-y-5 py-2">
                      {demoMessages.map((message) => (
                        <SalesDemoMessageBubble
                          key={message.id}
                          message={message}
                          onOpenMockDetail={handleOpenMockDetail}
                          onToggleExecutionSteps={toggleDemoExecutionSteps}
                        />
                      ))}
                      <div ref={demoMessagesEndRef} />
                    </div>
                  </div>
                )}

                {chatInput}

                {/* Category Buttons / Prompt List */}
                {salesDemoActive ? null : activeCategory &&
                  activeCategoryData ? (
                  /* Expanded: show prompts for selected category */
                  <div className="w-full">
                    <div className="border-border divide-border divide-y rounded-xl border">
                      {activeCategoryData.prompts.map((prompt, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => handlePromptClick(prompt)}
                          className="text-foreground hover:bg-accent group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm transition-colors first:rounded-t-xl last:rounded-b-xl"
                        >
                          <span className="truncate">{prompt}</span>
                          <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Default: show category buttons */
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {categoryKeys.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleCategoryClick(key)}
                        className={cn(
                          'border-border bg-background text-muted-foreground flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors',
                          'hover:bg-accent hover:text-foreground'
                        )}
                      >
                        {categoryIcons[key]}
                        <span>{categories[key].label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={!!collaborationRenameSession}
        onOpenChange={(open) => {
          if (!open) closeRenameCollaborationSession();
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>重命名协作会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">
                会话名称
              </span>
              <input
                value={collaborationRenameValue}
                onChange={(event) =>
                  setCollaborationRenameValue(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    confirmRenameCollaborationSession();
                  }
                }}
                autoFocus
                maxLength={40}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 transition outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                placeholder="例如：客户方案评审协作"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeRenameCollaborationSession}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmRenameCollaborationSession}
                disabled={!collaborationRenameValue.trim()}
                className="h-10 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!collaborationDeleteSession}
        onOpenChange={(open) => {
          if (!open) closeDeleteCollaborationSession();
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>删除协作会话</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <p className="text-sm leading-6 text-slate-600">
              确认删除
              <span className="font-semibold text-slate-950">
                「{collaborationDeleteSession?.title || '协作会话'}」
              </span>
              ？删除后会移除这个本地协作草稿；已启动生成的任务记录不会被删除。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteCollaborationSession}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDeleteCollaborationSession}
                className="h-10 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                删除
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MockDetailDialog
        detail={mockDetail}
        onOpenChange={(open) => {
          if (!open) setMockDetail(null);
        }}
      />
    </div>
  );
}

function CollaborationStartPanel({
  sessions,
  activeSessionId,
  activeAssistants,
  activePeers,
  availablePeers,
  assistantIds,
  peerIds,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onToggleAssistant,
  onTogglePeer,
  onPromptClick,
  children,
}: {
  sessions: CollaborationDraftSession[];
  activeSessionId: string | null;
  activeAssistants: CollaborationAssistant[];
  activePeers: CollaborationPeer[];
  availablePeers: CollaborationPeer[];
  assistantIds: CollaborationAssistant['id'][];
  peerIds: CollaborationPeer['id'][];
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onRenameSession: (session: CollaborationDraftSession) => void;
  onDeleteSession: (session: CollaborationDraftSession) => void;
  onToggleAssistant: (assistantId: CollaborationAssistant['id']) => void;
  onTogglePeer: (peerId: CollaborationPeer['id']) => void;
  onPromptClick: (prompt: string) => void;
  children: React.ReactNode;
}) {
  const totalMembers = activePeers.length + activeAssistants.length;
  const hasDiscoveredPeers = availablePeers.length > 0;
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ||
    sessions[0] ||
    null;

  return (
    <div className="grid min-h-0 w-full flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="border-border/70 bg-card flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <Wifi className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-foreground truncate text-base font-semibold">
                {activeSession?.title || '协作会话'}
              </h2>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {sessions.length} 个会话 · 已拉入 {activePeers.length} 人、
                {activeAssistants.length} 个智能助手
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="border-border bg-background text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
              <Radar className="size-3.5" />
              {hasDiscoveredPeers
                ? `发现 ${availablePeers.length} 人`
                : '等待同网成员'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              可开始
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-between p-4">
          <div className="bg-muted/20 border-border/70 flex min-h-[280px] flex-1 flex-col justify-between rounded-lg border p-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="bg-background border-border flex size-8 shrink-0 items-center justify-center rounded-lg border">
                  <Network className="text-primary size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-semibold">
                    群内任务会在这里沉淀为共享上下文
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    发送后，智能助手会按群成员和助手职责拆解任务，输出负责人、进展、待确认事项和下一步。
                  </p>
                </div>
              </div>
              <div className="border-border bg-background rounded-lg border px-3 py-2 text-sm">
                <span className="text-muted-foreground">当前群：</span>
                <span className="text-foreground font-medium">
                  {totalMembers} 位成员共享可见
                </span>
              </div>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {collaborationQuickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onPromptClick(prompt)}
                  className="border-border bg-background hover:border-primary/35 hover:bg-primary/5 flex min-h-20 cursor-pointer flex-col justify-between rounded-lg border p-3 text-left text-xs leading-5 transition-colors"
                >
                  <span className="line-clamp-3">{prompt}</span>
                  <ArrowUpRight className="text-muted-foreground mt-2 size-3.5 shrink-0" />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">{children}</div>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-4">
        <section className="border-border/70 bg-card rounded-xl border p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                协作会话
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {sessions.length} 个上下文
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateSession}
              aria-label="新建协作会话"
              className="border-border bg-background text-muted-foreground hover:border-primary/35 hover:bg-primary/5 hover:text-primary flex size-8 cursor-pointer items-center justify-center rounded-lg border transition-colors"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="max-h-44 space-y-1.5 overflow-y-auto">
            {sessions.length === 0 ? (
              <button
                type="button"
                onClick={onCreateSession}
                className="border-border bg-background text-muted-foreground hover:border-primary/35 hover:bg-primary/5 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors"
              >
                <Plus className="size-4" />
                新建协作
              </button>
            ) : (
              sessions.map((session) => {
                const active = session.id === activeSession?.id;

                return (
                  <div
                    key={session.id}
                    className={cn(
                      'border-border bg-background group hover:border-primary/35 hover:bg-primary/5 flex min-h-14 w-full items-center gap-1 rounded-lg border p-1 transition-colors',
                      active && 'border-primary/35 bg-primary/5'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      aria-current={active ? 'true' : undefined}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left"
                    >
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg border',
                          active
                            ? 'border-orange-200 bg-orange-50 text-orange-600'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                        )}
                      >
                        <Network className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground block truncate text-sm font-semibold">
                          {session.title}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {formatCollaborationSessionTime(session.updatedAt)}
                        </span>
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs font-semibold">
                        {session.assistantIds.length}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => onRenameSession(session)}
                        aria-label={`重命名${session.title}`}
                        title="重命名"
                        className="text-muted-foreground hover:bg-background hover:text-primary flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSession(session)}
                        aria-label={`删除${session.title}`}
                        title="删除"
                        className="text-muted-foreground flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="border-border/70 bg-card min-h-0 rounded-xl border p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                同网成员
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                真实桌面端发现结果
              </p>
            </div>
            <MonitorSmartphone className="text-muted-foreground size-4" />
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto">
            {hasDiscoveredPeers ? (
              availablePeers.map((peer) => {
                const active = peerIds.includes(peer.id);

                return (
                  <button
                    key={peer.id}
                    type="button"
                    onClick={() => onTogglePeer(peer.id)}
                    className={cn(
                      'border-border bg-background hover:border-primary/35 hover:bg-primary/5 flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      active && 'border-primary/35 bg-primary/5'
                    )}
                  >
                    <PeerAvatar name={peer.name} active={active} />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-semibold">
                        {peer.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {peer.role}
                      </span>
                    </span>
                    {active ? (
                      <CheckCircle2 className="text-primary size-4 shrink-0" />
                    ) : (
                      <UserPlus className="text-muted-foreground size-4 shrink-0" />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="border-border bg-background rounded-lg border px-3 py-4 text-sm">
                <p className="text-foreground font-medium">暂未发现同网成员</p>
                <p className="text-muted-foreground mt-1 text-xs leading-5">
                  浏览器预览不伪造人员。桌面端会通过局域网发现接口显示真实在线成员。
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="border-border/70 bg-card rounded-xl border p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                智能助手
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                选择要拉入群的能力
              </p>
            </div>
            <Sparkles className="text-muted-foreground size-4" />
          </div>
          <div className="space-y-1.5">
            {collaborationAssistants.map((assistant) => {
              const active = assistantIds.includes(assistant.id);
              const Icon = assistant.Icon;

              return (
                <button
                  key={assistant.id}
                  type="button"
                  onClick={() => onToggleAssistant(assistant.id)}
                  className={cn(
                    'border-border bg-background hover:border-primary/35 hover:bg-primary/5 flex min-h-14 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                    active && 'border-primary/35 bg-primary/5'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg border',
                      getAssistantToneClasses(assistant.tone)
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-semibold">
                      {assistant.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {assistant.description}
                    </span>
                  </span>
                  {active ? (
                    <CheckCircle2 className="text-primary size-4 shrink-0" />
                  ) : (
                    <Plus className="text-muted-foreground size-4 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </aside>
    </div>
  );
}

function PeerAvatar({ name, active }: { name: string; active?: boolean }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
        active
          ? 'bg-blue-600 text-white'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}

function SalesAssistantFaqPanel({
  completed,
  onPromptClick,
}: {
  completed: boolean;
  onPromptClick: (prompt: string) => void;
}) {
  return (
    <div className="border-border/70 bg-card/80 w-full rounded-xl border p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
            <BadgeDollarSign className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-sm font-semibold">
              销售助手常见问题
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              使用 mock 业务数据展示保险销售流程
            </p>
          </div>
        </div>

        {completed && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-3.5" />
            本轮已完成
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => onPromptClick(customerPolicyDemoPrompt)}
        className="border-border/70 bg-background hover:bg-accent text-foreground mb-3 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors"
      >
        <span className="min-w-0">
          <span className="block font-semibold">模拟客户/保单查询</span>
          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
            自动填入客户李明保单状态咨询，发送后展示演示流程
          </span>
        </span>
        <ArrowUpRight className="text-muted-foreground size-4 shrink-0" />
      </button>

      <div className="grid gap-2 md:grid-cols-2">
        {salesFaqs.map((faq) => (
          <div
            key={faq.question}
            className="border-border/70 bg-background rounded-lg border p-3"
          >
            <p className="text-foreground text-sm font-semibold">
              {faq.question}
            </p>
            <p className="text-muted-foreground mt-2 text-xs leading-5">
              {faq.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesDemoMessageBubble({
  message,
  onOpenMockDetail,
  onToggleExecutionSteps,
}: {
  message: DemoMessage;
  onOpenMockDetail: (href: string) => boolean;
  onToggleExecutionSteps: (messageId: string) => void;
}) {
  const isUser = message.role === 'user';
  const shouldRenderAnswer =
    isUser ||
    message.answerStarted ||
    !!message.content ||
    (!message.plan && message.active);

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <span className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow-sm">
          <Bot className="size-5" />
        </span>
      )}

      <div
        className={cn(
          'max-w-[78%]',
          isUser ? 'flex flex-col items-end' : 'flex flex-col items-start'
        )}
      >
        <div
          className={cn(
            'rounded-xl px-4 py-3 text-sm leading-6 shadow-sm',
            isUser
              ? 'bg-muted text-foreground'
              : 'border-border/80 bg-card text-card-foreground border'
          )}
        >
          {!isUser && message.plan && (
            <SalesDemoPlanCard
              plan={message.plan}
              stepStatuses={message.planStepStatuses || []}
              completed={!!message.planCompleted}
            />
          )}

          {!isUser &&
            message.executionItems &&
            message.executionItems.length > 0 &&
            (message.visibleExecutionItemCount || 0) > 0 && (
              <SalesDemoExecutionSteps
                items={message.executionItems}
                visibleCount={message.visibleExecutionItemCount || 0}
                expanded={message.executionExpanded !== false}
                onToggle={() => onToggleExecutionSteps(message.id)}
              />
            )}

          {!isUser && !message.agentTrace && message.thinking && (
            <div className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800">
              <div className="mb-1 font-semibold">思考过程</div>
              <p className="whitespace-pre-line">{message.thinking}</p>
            </div>
          )}

          {isUser ? (
            <p>{message.content}</p>
          ) : shouldRenderAnswer ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ children, href }: any) => (
                    <a
                      href={href}
                      onClick={(event) => {
                        event.preventDefault();
                        if (href && !onOpenMockDetail(href)) {
                          window.open(href, '_blank');
                        }
                      }}
                      className="border-border bg-background text-primary my-2 flex items-center gap-2 rounded-lg border px-3 py-2 font-medium no-underline hover:underline"
                    >
                      <Link className="size-4 shrink-0" />
                      <span className="min-w-0 truncate">{children}</span>
                    </a>
                  ),
                }}
              >
                {message.content || (message.active ? '正在生成回答...' : '')}
              </ReactMarkdown>
              {message.active && (
                <span className="text-primary mt-2 inline-flex items-center gap-1 text-xs font-medium">
                  <Loader2 className="size-3.5 animate-spin" />
                  流式输出中
                </span>
              )}
            </div>
          ) : null}
        </div>

        {!isUser && !message.active && (
          <div className="text-muted-foreground mt-2 flex items-center gap-4 pl-2">
            <button type="button" aria-label="复制回答">
              <Copy className="size-4" />
            </button>
            <button type="button" aria-label="点赞">
              <ThumbsUp className="size-4" />
            </button>
            <button type="button" aria-label="点踩">
              <ThumbsDown className="size-4" />
            </button>
          </div>
        )}
      </div>

      {isUser && (
        <span className="bg-muted text-muted-foreground mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl">
          <UserRound className="size-5" />
        </span>
      )}
    </div>
  );
}

function SalesDemoPlanCard({
  plan,
  stepStatuses,
  completed,
}: {
  plan: SalesAgentPlan;
  stepStatuses: SalesDemoPlanStepStatus[];
  completed: boolean;
}) {
  return (
    <div
      className={cn(
        'mb-3 space-y-4 rounded-xl border p-4',
        completed
          ? 'border-emerald-500/30 bg-emerald-50/30'
          : 'border-orange-300/35 bg-orange-50/40'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
          {completed ? (
            <Check className="size-4 text-emerald-500" />
          ) : (
            <Loader2 className="text-primary size-4 animate-spin" />
          )}
          执行计划
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs',
              completed
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-orange-100 text-orange-700'
            )}
          >
            {completed ? '已完成' : '执行中'}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">目标</p>
        <p className="text-foreground text-sm font-medium">{plan.goal}</p>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          步骤（{plan.steps.length}）
        </p>
        <div className="space-y-2">
          {plan.steps.map((step, index) => {
            const status = stepStatuses[index] || 'pending';

            return (
              <div key={step} className="flex items-start gap-2.5">
                <div
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs font-medium transition-colors',
                    status === 'completed'
                      ? 'border-orange-500 bg-orange-500 text-white'
                      : status === 'in_progress'
                        ? 'border-orange-500 bg-orange-50 text-orange-600'
                        : 'border-muted-foreground/30 bg-background text-muted-foreground'
                  )}
                >
                  {status === 'completed' ? (
                    <Check className="size-3" />
                  ) : status === 'in_progress' ? (
                    <span className="size-1.5 animate-pulse rounded-full bg-orange-500" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={cn(
                    'min-w-0 flex-1 text-sm leading-snug',
                    status === 'pending'
                      ? 'text-muted-foreground'
                      : 'text-foreground font-medium'
                  )}
                >
                  {step}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-muted-foreground text-xs">备注</p>
        <p className="text-muted-foreground mt-1 text-sm">{plan.note}</p>
      </div>
    </div>
  );
}

function SalesDemoExecutionSteps({
  items,
  visibleCount,
  expanded,
  onToggle,
}: {
  items: SalesDemoExecutionItem[];
  visibleCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visibleItems = items.slice(0, visibleCount);
  if (visibleItems.length === 0) return null;

  return (
    <div className="border-border/40 bg-accent/20 mb-3 min-w-0 overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground hover:bg-accent/30 flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-sm transition-colors"
      >
        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform',
            !expanded && '-rotate-90'
          )}
        />
        <span className="flex-1 text-left">
          {expanded ? '隐藏步骤' : `显示步骤（${visibleItems.length}）`}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2">
          <div className="space-y-1">
            {visibleItems.map((item, index) => (
              <SalesDemoExecutionItemRow
                key={`${item.name}-${index}`}
                item={item}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SalesDemoExecutionItemRow({ item }: { item: SalesDemoExecutionItem }) {
  return (
    <div className="-mx-1 rounded-md px-1 py-1.5 font-mono text-[13px]">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-500" />
        <div className="min-w-0 flex-1">
          <p className="leading-relaxed">
            <span className="text-foreground font-semibold">
              {getTraceToolLabel(item.name)}
            </span>
          </p>
        </div>
      </div>
      <div className="mt-0.5 ml-1 flex items-start gap-2">
        <span className="text-muted-foreground/40 leading-none">└</span>
        <span className="text-muted-foreground">{item.summary}</span>
      </div>
    </div>
  );
}

function getTraceToolLabel(toolName: string) {
  if (!toolName.startsWith('mcp__')) return toolName;

  const [, serverName = '', tool = ''] = toolName.split('__');
  const serverLabel =
    serverName === 'sales_knowledge_base'
      ? '销售知识库 MCP'
      : `${serverName || 'MCP'} MCP`;

  return tool ? `${serverLabel} / ${tool}` : serverLabel;
}

function MockDetailDialog({
  detail,
  onOpenChange,
}: {
  detail: MockDetail | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!detail} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[920px]">
        {detail?.type === 'customer' ? (
          <CustomerDetailContent customerNo={detail.id} />
        ) : detail?.type === 'policy' ? (
          <PolicyDetailContent policyNo={detail.id} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetailContent({ customerNo }: { customerNo: string }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-xl">
          <UserRound className="text-primary size-5" />
          客户详情
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="border-border/80 bg-card grid gap-4 rounded-2xl border p-4 md:grid-cols-[1.15fr_0.85fr]">
          <div className="flex gap-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-orange-100 via-white to-sky-100 shadow-inner">
              <div className="absolute inset-x-5 top-4 h-8 rounded-full bg-slate-700" />
              <div className="absolute inset-x-4 top-10 h-11 rounded-t-full bg-orange-200" />
              <div className="absolute inset-x-3 bottom-0 h-7 rounded-t-2xl bg-sky-700" />
              <span className="absolute right-2 bottom-2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                模拟
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-foreground text-2xl font-bold">李明</h3>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  已实名
                </span>
                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">
                  银保渠道
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                客户号：{customerNo} · 最近更新时间：2026-05-21 14:40
              </p>

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <InfoLine icon={<Phone />} label="手机号" value="138****8626" />
                <InfoLine
                  icon={<Mail />}
                  label="邮箱"
                  value="liming@example.cn"
                />
                <InfoLine
                  icon={<ShieldCheck />}
                  label="证件号"
                  value="110101********3218"
                />
                <InfoLine
                  icon={<MapPin />}
                  label="归属机构"
                  value="上海分行营业部"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
            <MetricCard label="名下保单" value="2 张" tone="orange" />
            <MetricCard label="年缴保费" value="14,380 元" tone="blue" />
            <MetricCard label="客户状态" value="可服务" tone="green" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_0.9fr]">
          <section className="border-border/80 bg-card rounded-2xl border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-foreground font-bold">名下保单</h4>
              <span className="text-muted-foreground text-xs">
                已按生效时间排序
              </span>
            </div>
            <div className="space-y-3">
              <PolicyMiniCard
                name="康惠保长期医疗（银保渠道）"
                policyNo="P20260521001"
                status="有效"
                premium="2,380 元/年"
                nextDate="2027-05-21"
              />
              <PolicyMiniCard
                name="稳享人生终身寿险（银保版）"
                policyNo="P20240118009"
                status="有效"
                premium="12,000 元/年"
                nextDate="2027-01-18"
              />
            </div>
          </section>

          <section className="border-border/80 bg-card rounded-2xl border p-4">
            <h4 className="text-foreground mb-3 font-bold">证件影像模拟</h4>
            <div className="overflow-hidden rounded-xl border bg-gradient-to-br from-slate-50 to-orange-50 p-4 shadow-inner">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  居民身份证
                </span>
                <span className="rounded bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                  脱敏预览
                </span>
              </div>
              <div className="flex gap-3">
                <div className="size-16 rounded-lg bg-gradient-to-br from-slate-300 to-slate-500" />
                <div className="flex-1 space-y-2 text-xs">
                  <div className="h-2 w-24 rounded bg-slate-300" />
                  <div className="h-2 w-36 rounded bg-slate-200" />
                  <div className="h-2 w-32 rounded bg-slate-200" />
                  <div className="mt-4 h-2 w-44 rounded bg-slate-300" />
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <TimelineItem title="2026-05-21" desc="客户来电咨询续保安排。" />
              <TimelineItem title="2026-05-12" desc="完成家庭保障缺口测算。" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function PolicyDetailContent({ policyNo }: { policyNo: string }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-xl">
          <WalletCards className="text-primary size-5" />
          保单详情
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="border-border/80 bg-card rounded-2xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-foreground text-2xl font-bold">
                  康惠保长期医疗（银保渠道）
                </h3>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  有效
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                保单号：{policyNo} · 投保人/被保人：李明 ·
                承保机构：云声人寿上海分公司
              </p>
            </div>
            <div className="rounded-xl bg-orange-50 px-4 py-3 text-right">
              <p className="text-muted-foreground text-xs">下次缴费日</p>
              <p className="text-primary text-lg font-bold">2027-05-21</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <MetricCard label="年缴保费" value="2,380 元" tone="orange" />
            <MetricCard label="缴费方式" value="年缴" tone="blue" />
            <MetricCard label="生效日期" value="2026-05-21" tone="green" />
            <MetricCard label="等待期" value="已过" tone="slate" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_0.9fr]">
          <section className="border-border/80 bg-card rounded-2xl border p-4">
            <h4 className="text-foreground mb-3 font-bold">保障责任</h4>
            <div className="space-y-3">
              <CoverageRow label="一般医疗保险金" amount="300 万" used="0 元" />
              <CoverageRow
                label="重大疾病医疗保险金"
                amount="600 万"
                used="0 元"
              />
              <CoverageRow label="质子重离子医疗" amount="100 万" used="0 元" />
              <CoverageRow label="住院垫付服务" amount="可用" used="未使用" />
            </div>
          </section>

          <section className="border-border/80 bg-card rounded-2xl border p-4">
            <h4 className="text-foreground mb-3 font-bold">电子保单影像模拟</h4>
            <div className="rounded-xl border bg-gradient-to-br from-white via-orange-50 to-sky-50 p-4 shadow-inner">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">电子保险单</p>
                  <p className="mt-1 text-xs text-slate-500">{policyNo}</p>
                </div>
                <div className="grid size-14 grid-cols-3 gap-0.5 rounded bg-white p-1 shadow-sm">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <span
                      key={index}
                      className={cn(
                        'rounded-sm',
                        index % 2 ? 'bg-slate-300' : 'bg-slate-800'
                      )}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-5 space-y-2">
                <div className="h-2 w-11/12 rounded bg-slate-200" />
                <div className="h-2 w-4/5 rounded bg-slate-200" />
                <div className="h-2 w-2/3 rounded bg-slate-200" />
              </div>
              <div className="mt-5 flex justify-end">
                <div className="flex size-20 items-center justify-center rounded-full border-2 border-red-300 text-center text-[10px] font-bold text-red-500">
                  电子签章
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="border-border/80 bg-card rounded-2xl border p-4">
            <h4 className="text-foreground mb-3 font-bold">缴费计划</h4>
            <div className="space-y-2">
              <TimelineItem
                title="2026-05-21"
                desc="首期保费 2,380 元，已缴清。"
              />
              <TimelineItem
                title="2027-05-21"
                desc="续期保费 2,380 元，待缴。"
              />
            </div>
          </section>
          <section className="border-border/80 bg-card rounded-2xl border p-4">
            <h4 className="text-foreground mb-3 font-bold">批改记录</h4>
            <div className="space-y-2">
              <TimelineItem title="2026-05-22" desc="回访状态更新为已完成。" />
              <TimelineItem
                title="2026-05-21"
                desc="保单承保完成，电子保单生成。"
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function InfoLine({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-foreground truncate font-medium">{value}</p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'orange' | 'blue' | 'green' | 'slate';
}) {
  const toneClass = {
    orange: 'bg-orange-50 text-orange-700',
    blue: 'bg-sky-50 text-sky-700',
    green: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-slate-50 text-slate-700',
  }[tone];

  return (
    <div className={cn('rounded-xl px-3 py-3', toneClass)}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function PolicyMiniCard({
  name,
  policyNo,
  status,
  premium,
  nextDate,
}: {
  name: string;
  policyNo: string;
  status: string;
  premium: string;
  nextDate: string;
}) {
  return (
    <div className="border-border/70 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-foreground font-semibold">{name}</p>
          <p className="text-muted-foreground mt-1 text-xs">{policyNo}</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          {status}
        </span>
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap gap-4 text-xs">
        <span>保费：{premium}</span>
        <span>下次缴费：{nextDate}</span>
      </div>
    </div>
  );
}

function CoverageRow({
  label,
  amount,
  used,
}: {
  label: string;
  amount: string;
  used: string;
}) {
  return (
    <div className="border-border/70 flex items-center justify-between gap-3 rounded-xl border p-3">
      <div>
        <p className="text-foreground font-semibold">{label}</p>
        <p className="text-muted-foreground mt-1 text-xs">已用：{used}</p>
      </div>
      <span className="text-primary text-lg font-bold">{amount}</span>
    </div>
  );
}

function TimelineItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="bg-primary/10 text-primary mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg">
        <CalendarDays className="size-3.5" />
      </span>
      <div>
        <p className="text-foreground font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
