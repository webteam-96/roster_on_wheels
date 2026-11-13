import { clearToken, getToken } from "./auth";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/+$/, "");
// Where project photos are served from (the API's /Documents folder). Defaults to the API itself; set it
// separately for local development, where the photos exist only on the live server.
export const PHOTO_BASE_URL = (process.env.NEXT_PUBLIC_PHOTO_BASE_URL || API_URL).replace(/\/+$/, "");
export const LOGIN_PATH = "/login/";

// ── Types ───────────────────────────────────────────────────────────────────

export type LoginRequest =
  | { email: string; password: string }
  | { countryCode: string; mobileNumber: string; password: string };

export interface LoginResponse {
  token: string;
  memberName: string;
  email: string;
  memberId: number;
}

export interface Me {
  allowed: boolean;
  reason?: string;
  name: string;
  scope: string;
  questionsToday: number;
  dailyLimit: number;
}

export interface ConversationSummary {
  id: number;
  title: string;
  updatedDate: string;
}

export interface StoredMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  route?: string | null;
  createdDate: string;
}

export interface ConversationDetail {
  id: number;
  messages: StoredMessage[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Any 401 ends the session: drop the token and hard-navigate (clears all in-memory state). */
export function handleUnauthorized(): void {
  clearToken();
  window.location.replace(LOGIN_PATH);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Pulls `{ message, code }` out of an error body, if the server sent JSON. */
export async function readErrorBody(res: Response): Promise<{ message?: string; code?: string }> {
  try {
    const body = await res.json();
    return {
      message: typeof body?.message === "string" ? body.message : undefined,
      code: typeof body?.code === "string" ? body.code : undefined,
    };
  } catch {
    return {};
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...authHeaders(), ...init.headers },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new ApiError(err.message || `Request failed (${res.status}).`, res.status, err.code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

/** POST /api/auth/login — same endpoint/payload as the admin portal. A 401 here is a bad
 *  password, not an expired session, so it does NOT go through handleUnauthorized. */
export async function login(body: LoginRequest): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new ApiError(err.message || "Sign-in failed. Please try again.", res.status);
  }
  return (await res.json()) as LoginResponse;
}

export const getMe = () => request<Me>("/api/assistant/me");

export const listConversations = () => request<ConversationSummary[]>("/api/assistant/conversations");

export const getConversation = (id: number) =>
  request<ConversationDetail>(`/api/assistant/conversations/${id}`);

export const deleteConversation = (id: number) =>
  request<void>(`/api/assistant/conversations/${id}`, { method: "DELETE" });
