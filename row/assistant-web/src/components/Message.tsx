import Markdown from "./Markdown";

export interface UiMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  /** Progress line while the answer is being produced ("Checking membership data…"). */
  status?: string;
  streaming?: boolean;
  stopped?: boolean;
  cached?: boolean;
  asOf?: string;
  error?: { message: string; code?: string };
}

function formatAsOf(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  // Date-only values ("2026-11-05") parse as UTC midnight — format them in UTC so the day doesn't shift.
  return /T\d/.test(value)
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

export default function MessageView({ m }: { m: UiMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-navy-900 px-4 py-2.5 text-sm text-white shadow-card">
          <span className="sr-only">You said: </span>
          {m.content}
        </div>
      </div>
    );
  }

  const waiting = m.streaming && !m.content;
  return (
    <div className="flex gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/rotary-logo.png" alt="" className="mt-1 h-7 w-7 shrink-0 rounded-full bg-white" />
      <div className="min-w-0 flex-1">
        <span className="sr-only">Assistant: </span>
        {(m.content || waiting) && (
          <div className="break-words rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-card">
            {m.content ? (
              <Markdown>{m.content}</Markdown>
            ) : (
              <span className="flex gap-1 py-1" aria-label="Assistant is thinking">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
              </span>
            )}
          </div>
        )}

        {m.streaming && m.status && (
          <p className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-500" aria-hidden="true" />
            {m.status}
          </p>
        )}

        {m.error && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {m.error.message}
          </p>
        )}

        {m.stopped && <p className="mt-1.5 text-xs italic text-slate-500">Stopped.</p>}

        {(m.asOf || m.cached) && !m.streaming && (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {m.asOf && <span>Data as of {formatAsOf(m.asOf)}</span>}
            {m.cached && (
              <span
                className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
                title="Answered from a recent identical question"
              >
                cached
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
