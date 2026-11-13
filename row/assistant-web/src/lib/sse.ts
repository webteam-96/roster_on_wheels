import { API_URL, authHeaders, handleUnauthorized, readErrorBody } from "./api";

export type ChatEvent =
  | { type: "meta"; conversationId: number }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "answer_reset" }
  | {
      type: "done";
      answer: string;
      route?: string;
      cached: boolean;
      asOf?: string;
      questionsToday?: number;
      dailyLimit?: number;
    }
  | { type: "error"; message: string; code?: string };

/**
 * Incremental parser for the text/event-stream wire format. Feed it decoded text in arbitrary
 * chunks; it calls `onFrame(event, data)` once per complete frame (blank-line terminated).
 * `:` comment lines (heartbeats) are skipped; multiple `data:` lines are joined with "\n".
 */
export function createSseParser(onFrame: (event: string, data: string) => void) {
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  function dispatch() {
    if (dataLines.length > 0) onFrame(eventName || "message", dataLines.join("\n"));
    eventName = "";
    dataLines = [];
  }

  function processLine(line: string) {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
    // `id` / `retry` are meaningless for a one-shot fetch stream.
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      // A trailing "\r" may be the first half of a "\r\n" split across chunks — hold it back.
      const end = buffer.endsWith("\r") ? buffer.length - 1 : buffer.length;
      const lines = buffer.slice(0, end).split(/\r\n|\r|\n/);
      buffer = lines.pop()! + buffer.slice(end);
      for (const line of lines) processLine(line);
    },
    end() {
      if (buffer) processLine(buffer.replace(/\r$/, ""));
      buffer = "";
      dispatch(); // tolerate a final frame that is missing its blank-line terminator
    },
  };
}

/** Maps a raw frame onto a typed event, coercing fields so the UI never sees junk types. */
function toEvent(name: string, p: Record<string, unknown>): ChatEvent | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  switch (name) {
    case "meta":
      return typeof p.conversationId === "number" ? { type: "meta", conversationId: p.conversationId } : null;
    case "status":
      return { type: "status", text: str(p.text) };
    case "delta":
      return { type: "delta", text: str(p.text) };
    case "answer_reset":
      return { type: "answer_reset" };
    case "done":
      return {
        type: "done",
        answer: str(p.answer),
        route: str(p.route) || undefined,
        cached: p.cached === true,
        asOf: str(p.asOf) || undefined,
        questionsToday: num(p.questionsToday),
        dailyLimit: num(p.dailyLimit),
      };
    case "error":
      return { type: "error", message: str(p.message) || "Something went wrong.", code: str(p.code) || undefined };
    default:
      return null;
  }
}

/**
 * POST /api/assistant/chat and stream the SSE response. Uses fetch + ReadableStream because
 * EventSource cannot send an Authorization header. Rejects with an AbortError when `signal`
 * fires; non-2xx responses are surfaced as a synthetic `error` event.
 */
export async function streamChat(
  body: { conversationId?: number; message: string },
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });

  if (res.status === 401) {
    handleUnauthorized();
    return;
  }
  if (!res.ok || !res.body || !(res.headers.get("content-type") || "").includes("text/event-stream")) {
    const err = res.ok ? {} : await readErrorBody(res);
    onEvent({
      type: "error",
      message: err.message || `The assistant is unavailable right now (HTTP ${res.status}).`,
      code: err.code,
    });
    return;
  }

  const parser = createSseParser((name, data) => {
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return; // malformed frame — skip it rather than kill the stream
    }
    const event = toEvent(name, payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {});
    if (event) onEvent(event);
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}
