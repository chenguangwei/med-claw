import { useCallback, useState } from 'react';
import type { AgentQuestion, PendingQuestion } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { Check, FolderOpen, Send, ShieldCheck } from 'lucide-react';

interface QuestionInputProps {
  pendingQuestion: PendingQuestion;
  onSubmit: (questionId: string, answers: Record<string, string>) => void;
}

function isFolderAuthorizationQuestion(question: AgentQuestion) {
  return /文件夹授权|folder access|folder authorization|目录授权/iu.test(
    `${question.header} ${question.question}`
  );
}

export function QuestionInput({
  pendingQuestion,
  onSubmit,
}: QuestionInputProps) {
  const { t } = useLanguage();
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});

  const handleOptionSelect = useCallback(
    (questionIndex: number, option: string, multiSelect: boolean) => {
      setAnswers((prev) => {
        const currentAnswers = prev[questionIndex] || [];
        if (multiSelect) {
          // Toggle selection for multi-select
          if (currentAnswers.includes(option)) {
            return {
              ...prev,
              [questionIndex]: currentAnswers.filter((a) => a !== option),
            };
          } else {
            return { ...prev, [questionIndex]: [...currentAnswers, option] };
          }
        } else {
          // Single select - replace
          return { ...prev, [questionIndex]: [option] };
        }
      });
    },
    []
  );

  const handleOtherInput = useCallback(
    (questionIndex: number, value: string) => {
      setOtherInputs((prev) => ({ ...prev, [questionIndex]: value }));
    },
    []
  );

  const handleFolderAuthorization = useCallback(
    async (questionIndex: number) => {
      try {
        if (typeof window === 'undefined') return;

        if (!('__TAURI_INTERNALS__' in window)) {
          const manualPath = window.prompt('请输入已授权文件夹的完整路径');
          if (manualPath?.trim()) {
            handleOtherInput(
              questionIndex,
              `已选择并授权文件夹：${manualPath.trim()}`
            );
          }
          return;
        }

        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          directory: true,
          multiple: false,
          title: '重新选择并授权文件夹',
        });
        if (!selected || Array.isArray(selected)) return;

        try {
          const { readDir, startAccessingSecurityScopedResource } =
            await import('@tauri-apps/plugin-fs');
          try {
            await startAccessingSecurityScopedResource(selected);
          } catch {
            // Desktop platforms may not require explicit security scope.
          }
          await readDir(selected);
        } catch (error) {
          handleOtherInput(
            questionIndex,
            `重新授权失败：${error instanceof Error ? error.message : String(error)}`
          );
          return;
        }

        handleOtherInput(questionIndex, `已选择并授权文件夹：${selected}`);
      } catch (error) {
        handleOtherInput(
          questionIndex,
          `无法打开授权窗口：${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [handleOtherInput]
  );

  const handleSubmit = useCallback(() => {
    const formattedAnswers: Record<string, string> = {};

    pendingQuestion.questions.forEach((q, index) => {
      const selectedOptions = answers[index] || [];
      const otherInput = otherInputs[index];

      let answer = selectedOptions.join(', ');
      if (otherInput) {
        answer = answer ? `${answer}, ${otherInput}` : otherInput;
      }

      if (answer) {
        formattedAnswers[q.question] = answer;
      }
    });

    onSubmit(pendingQuestion.id, formattedAnswers);
  }, [pendingQuestion, answers, otherInputs, onSubmit]);

  const hasAnswers =
    Object.keys(answers).some((k) => answers[parseInt(k)]?.length > 0) ||
    Object.values(otherInputs).some((v) => v?.trim());

  return (
    <div className="border-primary/30 bg-accent/30 space-y-4 rounded-xl border p-4">
      <div className="text-foreground flex items-center gap-2 text-sm font-medium">
        <span className="bg-primary size-2 animate-pulse rounded-full" />
        {t.common.questionInput.needsInput}
      </div>

      {pendingQuestion.questions.map((question, qIndex) => (
        <QuestionItem
          key={qIndex}
          question={question}
          selectedOptions={answers[qIndex] || []}
          otherInput={otherInputs[qIndex] || ''}
          onSelectOption={(option) =>
            handleOptionSelect(qIndex, option, question.multiSelect)
          }
          onOtherInput={(value) => handleOtherInput(qIndex, value)}
          onFolderAuthorization={() => handleFolderAuthorization(qIndex)}
          t={t}
        />
      ))}

      <div className="flex justify-end pt-2">
        <button
          onClick={handleSubmit}
          disabled={!hasAnswers}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            hasAnswers
              ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
        >
          <Send className="size-4" />
          {t.common.questionInput.submit}
        </button>
      </div>
    </div>
  );
}

interface QuestionItemProps {
  question: AgentQuestion;
  selectedOptions: string[];
  otherInput: string;
  onSelectOption: (option: string) => void;
  onOtherInput: (value: string) => void;
  onFolderAuthorization: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}

function QuestionItem({
  question,
  selectedOptions,
  otherInput,
  onSelectOption,
  onOtherInput,
  onFolderAuthorization,
  t,
}: QuestionItemProps) {
  const [showOther, setShowOther] = useState(false);
  const isFolderQuestion = isFolderAuthorizationQuestion(question);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground bg-muted flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium">
          {isFolderQuestion && <ShieldCheck className="size-3" />}
          {question.header}
        </span>
        <p className="text-foreground flex-1 text-sm">{question.question}</p>
      </div>

      {isFolderQuestion && (
        <button
          type="button"
          onClick={onFolderAuthorization}
          className="border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
        >
          <FolderOpen className="size-4" />
          选择文件夹并授权
        </button>
      )}

      <div className="grid grid-cols-1 gap-2 pl-0 sm:grid-cols-2">
        {question.options.map((option, oIndex) => {
          const isSelected = selectedOptions.includes(option.label);
          return (
            <button
              key={oIndex}
              onClick={() => onSelectOption(option.label)}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-all',
                isSelected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border/60 bg-background hover:border-primary/50 hover:bg-accent/50 text-foreground'
              )}
            >
              <div
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2',
                  question.multiSelect ? 'rounded-md' : 'rounded-full',
                  isSelected
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/40'
                )}
              >
                {isSelected && (
                  <Check className="text-primary-foreground size-3" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{option.label}</p>
                {option.description && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {option.description}
                  </p>
                )}
              </div>
            </button>
          );
        })}

        {/* Other option */}
        <button
          onClick={() => setShowOther(!showOther)}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-all',
            showOther || otherInput
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border/60 bg-background hover:border-primary/50 hover:bg-accent/50 text-foreground'
          )}
        >
          <div
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2',
              question.multiSelect ? 'rounded-md' : 'rounded-full',
              showOther || otherInput
                ? 'border-primary bg-primary'
                : 'border-muted-foreground/40'
            )}
          >
            {(showOther || otherInput) && (
              <Check className="text-primary-foreground size-3" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {t.common.questionInput.other}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t.common.questionInput.customInput}
            </p>
          </div>
        </button>
      </div>

      {/* Other input field */}
      {showOther && (
        <div className="pl-0">
          <input
            type="text"
            value={otherInput}
            onChange={(e) => onOtherInput(e.target.value)}
            placeholder={t.common.questionInput.placeholder}
            className="border-border/60 bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
