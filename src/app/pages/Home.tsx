import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createSession,
  deleteTask,
  getAllTasks,
  updateTask,
  type Task,
} from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { generateSessionId } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ArrowUpRight,
  BadgeDollarSign,
  Bot,
  CalendarDays,
  CheckCircle2,
  Cog,
  Copy,
  FileText,
  FolderOpen,
  Link,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  WalletCards,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  salesDemoScenarios,
  salesFaqs,
  type SalesDemoTurn,
} from '@/components/home/salesAssistantDemo';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { ChatInput, type ChatMode } from '@/components/shared/ChatInput';
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
  thinking?: string;
  active?: boolean;
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

const sleep = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

function splitStreamChunk(chunk: string) {
  const pieces = chunk.match(/.{1,16}(?:[，。；：、\n]|$)?/gu);
  return pieces?.filter(Boolean) ?? [chunk];
}

function getThinkingSummary(step: DemoStep) {
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

function normalizeMockPrompt(text: string) {
  return text.replace(/^使用以下能力：销售助手。\s*/u, '').trim();
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
  const [salesAssistantActive, setSalesAssistantActive] = useState(false);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<
    string | null
  >(null);
  const [demoStepIndex, setDemoStepIndex] = useState(0);
  const [demoMessages, setDemoMessages] = useState<DemoMessage[]>([]);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoCompleted, setDemoCompleted] = useState(false);
  const [mockDetail, setMockDetail] = useState<MockDetail | null>(null);
  const demoMessagesEndRef = useRef<HTMLDivElement>(null);
  const demoRunRef = useRef(0);
  const navigate = useNavigate();

  const hasDemoConversation = demoMessages.length > 0 || demoRunning;
  const nextDemoStep = salesDemoSteps[demoStepIndex];

  useEffect(() => {
    demoMessagesEndRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [demoMessages]);

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

  const resetSalesDemo = useCallback(() => {
    demoRunRef.current += 1;
    setPendingPrompt('');
    setDemoStepIndex(0);
    setDemoMessages([]);
    setDemoRunning(false);
    setDemoCompleted(false);
  }, []);

  const handleCapabilitySelect = useCallback(
    (capabilityId: string | null) => {
      setSelectedCapabilityId(capabilityId);
      const isSales = capabilityId === 'sales';
      setSalesAssistantActive(isSales);
      setActiveCategory(null);

      if (!isSales) {
        resetSalesDemo();
      }
    },
    [resetSalesDemo]
  );

  useEffect(() => {
    const handleAssistantSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ capabilityId?: string | null }>)
        .detail;
      handleCapabilitySelect(detail?.capabilityId ?? null);
    };

    window.addEventListener(
      'workany:assistant-selected',
      handleAssistantSelection
    );

    return () => {
      window.removeEventListener(
        'workany:assistant-selected',
        handleAssistantSelection
      );
    };
  }, [handleCapabilitySelect]);

  const handleInputActivate = useCallback(() => {
    if (
      !salesAssistantActive ||
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
    salesAssistantActive,
  ]);

  const streamMockAssistant = useCallback(
    async (step: DemoStep, runId: number) => {
      const assistantMessageId = `assistant-${Date.now()}`;
      setDemoMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          thinking: '',
          active: true,
        },
      ]);

      await sleep(520);

      let thinking = '';
      for (const char of getThinkingSummary(step)) {
        if (demoRunRef.current !== runId) return false;
        thinking += char;
        updateDemoMessage(assistantMessageId, { thinking });
        await sleep(55);
      }

      await sleep(620);

      let content = '';
      for (const chunk of step.assistant.chunks) {
        for (const piece of splitStreamChunk(chunk)) {
          if (demoRunRef.current !== runId) return false;
          content += piece;
          updateDemoMessage(assistantMessageId, { content });
          await sleep(piece.includes('\n') ? 220 : 95);
        }
      }

      updateDemoMessage(assistantMessageId, { active: false });
      return demoRunRef.current === runId;
    },
    [updateDemoMessage]
  );

  const handleCategoryClick = (key: CategoryKey) => {
    setActiveCategory((prev) => (prev === key ? null : key));
    setSalesAssistantActive(false);
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

  const handleOpenMockDetail = useCallback((href: string) => {
    const detail = getMockDetailFromHref(href);
    if (!detail) return false;

    setMockDetail(detail);
    return true;
  }, []);

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
    mode?: ChatMode
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    const prompt = text.trim();

    if (salesAssistantActive) {
      if (!nextDemoStep || demoRunning) return;

      const runId = demoRunRef.current + 1;
      demoRunRef.current = runId;
      const displayPrompt = normalizeMockPrompt(prompt);

      setDemoRunning(true);
      setDemoMessages((current) => [
        ...current,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: displayPrompt || nextDemoStep.prompt,
        },
      ]);

      const completed = await streamMockAssistant(nextDemoStep, runId);
      if (!completed) return;

      setDemoStepIndex((current) => {
        const nextIndex = current + 1;
        if (nextIndex >= salesDemoSteps.length) {
          setDemoCompleted(true);
        }
        return nextIndex;
      });
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
      },
    });
  };

  const categories = t.home.examplePrompts.categories;
  const activeCategoryData = activeCategory ? categories[activeCategory] : null;
  const inputPlaceholder = useMemo(() => {
    if (salesAssistantActive && demoCompleted) {
      return '本轮咨询已完成，可继续输入新的业务问题';
    }

    if (salesAssistantActive) {
      return '请输入产品、核保、保单或系统操作相关问题';
    }

    return activeCategoryData?.placeholder ?? t.home.inputPlaceholder;
  }, [
    activeCategoryData?.placeholder,
    demoCompleted,
    salesAssistantActive,
    t.home.inputPlaceholder,
  ]);

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
            hasDemoConversation ? 'py-5' : 'items-center justify-center'
          )}
        >
          <div
            className={cn(
              'flex w-full flex-col items-center gap-6',
              hasDemoConversation
                ? 'mx-auto min-h-0 max-w-5xl flex-1'
                : 'max-w-2xl'
            )}
          >
            {/* Title */}
            {!hasDemoConversation && (
              <h1 className="text-foreground text-center font-serif text-4xl font-normal tracking-tight md:text-5xl">
                {t.home.welcomeTitle}
              </h1>
            )}

            {salesAssistantActive && !hasDemoConversation && (
              <SalesAssistantFaqPanel completed={demoCompleted} />
            )}

            {hasDemoConversation && (
              <div className="scrollbar-soft min-h-0 w-full flex-1 overflow-y-auto pr-2">
                <div className="space-y-5 py-2">
                  {demoMessages.map((message) => (
                    <SalesDemoMessageBubble
                      key={message.id}
                      message={message}
                      onOpenMockDetail={handleOpenMockDetail}
                    />
                  ))}
                  <div ref={demoMessagesEndRef} />
                </div>
              </div>
            )}

            {/* Input Box */}
            <ChatInput
              variant="home"
              placeholder={inputPlaceholder}
              isRunning={demoRunning}
              onSubmit={handleSubmit}
              className="w-full"
              autoFocus={!salesAssistantActive}
              externalValue={pendingPrompt}
              onExternalValueConsumed={handlePendingConsumed}
              onCapabilitySelect={handleCapabilitySelect}
              selectedCapabilityId={selectedCapabilityId}
              onInputActivate={handleInputActivate}
              preserveCapabilitiesOnSubmit={salesAssistantActive}
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

            {/* Category Buttons / Prompt List */}
            {salesAssistantActive ? null : activeCategory &&
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
          </div>
        </div>
      </div>

      <MockDetailDialog
        detail={mockDetail}
        onOpenChange={(open) => {
          if (!open) setMockDetail(null);
        }}
      />
    </div>
  );
}

function SalesAssistantFaqPanel({ completed }: { completed: boolean }) {
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
              保险销售端人员使用
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
}: {
  message: DemoMessage;
  onOpenMockDetail: (href: string) => boolean;
}) {
  const isUser = message.role === 'user';

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
          {!isUser && message.thinking && (
            <div className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800">
              <div className="mb-1 font-semibold">思考过程</div>
              <p className="whitespace-pre-line">{message.thinking}</p>
            </div>
          )}

          {isUser ? (
            <p>{message.content}</p>
          ) : (
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
          )}
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
