import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { SendIcon, StopIcon } from "./icons";

export const MAX_MESSAGE_LENGTH = 1000;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  quota: React.ReactNode;
}

const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { value, onChange, onSend, onStop, streaming, disabled, quota },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => textareaRef.current!);

  // Auto-grow up to ~8 lines, then scroll.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = !streaming && !disabled && value.trim().length > 0;

  return (
    <form
      className="border-t border-slate-200 bg-white px-4 pb-4 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="mx-auto max-w-3xl">
        <label htmlFor="assistant-input" className="sr-only">
          Ask the ROW Assistant
        </label>
        <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-navy-700 focus-within:ring-2 focus-within:ring-navy-700/20">
          <textarea
            id="assistant-input"
            ref={textareaRef}
            rows={1}
            value={value}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder="Ask about your members, clubs, reports or projects…"
            aria-describedby="assistant-input-help"
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <StopIcon className="h-4 w-4" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-900 text-white hover:bg-navy-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <div id="assistant-input-help" className="mt-1.5 flex items-center justify-between gap-3 px-1 text-xs text-slate-500">
          <span>{quota}</span>
          <span className={value.length >= MAX_MESSAGE_LENGTH ? "font-medium text-red-600" : undefined}>
            {value.length}/{MAX_MESSAGE_LENGTH}
            <span className="sr-only"> characters. Press Enter to send, Shift+Enter for a new line.</span>
          </span>
        </div>
      </div>
    </form>
  );
});

export default Composer;
