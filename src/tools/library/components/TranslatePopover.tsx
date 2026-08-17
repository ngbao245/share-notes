import { useEffect, useRef, useState } from 'react';
import { Languages, Loader2, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  translate,
  type TranslateResult,
} from '@/tools/library/lib/translate';
import { createToolStorage } from '@/lib/plugin-storage';

interface Props {
  text: string;
  onClose: () => void;
}

const targetStorage = createToolStorage<string>({ toolId: 'library', key: 'translate-target', scope: 'global' });
const removeLinebreakStorage = createToolStorage<boolean>({ toolId: 'library', key: 'translate-remove-linebreak', scope: 'global' });

function normalizeText(text: string, removeLinebreak: boolean) {
  if (!removeLinebreak) return text;

  return text
    .replace(/[ \t]*(?:\r\n|\r|\n)+[ \t]*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function TranslatePopover({ text, onClose }: Props) {
  const [target, setTarget] = useState(() => targetStorage.get() || 'vi');

  const [removeLinebreak, setRemoveLinebreak] = useState(() => {
    // Default true (giữ nguyên hành vi cũ: `stored !== 'false'`).
    const stored = removeLinebreakStorage.get();
    return stored !== false;
  });

  const [editedText, setEditedText] = useState(() =>
    normalizeText(text, removeLinebreakStorage.get() !== false),
  );

  const [result, setResult] = useState<TranslateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const removeLinebreakRef = useRef(removeLinebreak);
  const cacheRef = useRef(new Map<string, TranslateResult>());

  const wordCount = editedText.trim().split(/\s+/).filter(Boolean).length;
  const shouldShowDictionary = wordCount > 0 && wordCount <= 4;

  // Khi user select text mới từ Reader:
  // Nếu Unwrap đang bật thì tự nối line breaks trước khi hiển thị.
  useEffect(() => {
    const nextText = normalizeText(
      text,
      removeLinebreakRef.current,
    );

    setEditedText((previous) => {
      if (previous === nextText) return previous;
      return nextText;
    });

    setResult(null);
    setError(null);
  }, [text]);

  useEffect(() => {
    targetStorage.set(target);
  }, [target]);

  useEffect(() => {
    removeLinebreakStorage.set(removeLinebreak);
  }, [removeLinebreak]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleUnwrapChange = (
    checked: boolean | 'indeterminate',
  ) => {
    const nextValue = checked === true;

    removeLinebreakRef.current = nextValue;
    setRemoveLinebreak(nextValue);

    // Chỉ khi BẬT Unwrap mới sửa textarea.
    // Khi TẮT: giữ nguyên textarea + giữ nguyên kết quả dịch.
    if (nextValue) {
      setEditedText((previous) => {
        const normalized = normalizeText(previous, true);

        return normalized === previous ? previous : normalized;
      });
    }
  };

  const handleTextChange = (value: string) => {
    const nextText = normalizeText(
      value,
      removeLinebreakRef.current,
    );

    setEditedText(nextText);
    setResult(null);
    setError(null);
  };

  useEffect(() => {
    const cleanText = editedText.trim();

    if (!cleanText) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (cleanText.length > 4000) {
      setResult(null);
      setLoading(false);
      setError(
        'Please translate fewer than 4,000 characters at a time.',
      );
      return;
    }

    const cacheKey = `${target}::${cleanText}`;
    const cachedResult = cacheRef.current.get(cacheKey);

    if (cachedResult) {
      setResult(cachedResult);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const timeoutId = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);

        const translatedResult = await translate(
          {
            text: cleanText,
            source: 'auto',
            target,
          },
          controller.signal,
        );

        if (controller.signal.aborted) return;

        if (cacheRef.current.size >= 30) {
          const oldestKey = cacheRef.current
            .keys()
            .next()
            .value as string | undefined;

          if (oldestKey) {
            cacheRef.current.delete(oldestKey);
          }
        }

        cacheRef.current.set(cacheKey, translatedResult);
        setResult(translatedResult);
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : 'Translation failed',
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [editedText, target]);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <Languages className="h-3.5 w-3.5" />

          <span>Translate</span>

          <select
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setResult(null);
              setError(null);
            }}
            className="border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[11px] outline-none"
          >
            <option value="vi">Vietnamese</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh-CN">Chinese</option>
            <option value="ko">Korean</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="es">Spanish</option>
          </select>

          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
            <Checkbox
              checked={removeLinebreak}
              onCheckedChange={handleUnwrapChange}
              className="h-3.5 w-3.5"
            />

            <span>Unwrap</span>
          </label>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200"
          aria-label="Close translation popup"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[70vh] space-y-2 overflow-y-auto p-3 text-sm">
        <textarea
          value={editedText}
          onChange={(event) => handleTextChange(event.target.value)}
          placeholder="Enter text to translate..."
          className="w-full resize-none border border-zinc-700 bg-zinc-800 p-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-primary"
          rows={3}
        />

        <div className="border-t border-zinc-800 pt-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Translating…
            </div>
          ) : error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : result ? (
            <>
              <p className="whitespace-pre-wrap text-zinc-100">
                {result.translated}
              </p>

              {shouldShowDictionary &&
                result.dictionary &&
                result.dictionary.length > 0 && (
                  <div className="hidden md:block">
                    <DictionaryView result={result} />
                  </div>
                )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DictionaryView({ result }: { result: TranslateResult }) {
  return (
    <div className="mt-3 space-y-3">
      {result.dictionary?.map((entry) => (
        <div key={entry.partOfSpeech} className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
            {entry.partOfSpeech}
          </p>

          {entry.translations.length > 0 && (
            <p className="text-xs leading-relaxed text-zinc-400">
              {entry.translations.slice(0, 8).join(', ')}
            </p>
          )}

          {entry.definitions.length > 0 && (
            <div className="space-y-2 border-l-2 border-zinc-700 pl-3">
              {entry.definitions.slice(0, 3).map((item, index) => (
                <div
                  key={`${item.definition}-${index}`}
                  className="space-y-1"
                >
                  <p className="text-xs leading-relaxed text-zinc-300">
                    {item.definition}
                  </p>

                  {item.example && (
                    <p className="text-xs italic text-zinc-500">
                      “{item.example}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}