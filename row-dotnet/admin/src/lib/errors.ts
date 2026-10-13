/**
 * The one way to turn a failed API call into text for the user (master plan
 * WS2-15, section 7.4). Responses carry `code` (and sometimes `args`) as well as
 * the English `message`:
 *   1. a translated `errors.<CODE>` message when the code has one,
 *   2. otherwise the server's `message`,
 *   3. otherwise the translated generic sentence.
 *
 * Pass the root translator: const t = useTranslations(); getErrorMessage(e, t).
 */

type RootTranslator = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
};

interface ApiErrorBody {
  code?: string;
  args?: Record<string, string | number>;
  message?: string;
  title?: string;
}

export function getErrorMessage(error: unknown, t: RootTranslator): string {
  const body = (error as { response?: { data?: ApiErrorBody } })?.response?.data;
  if (body && typeof body === "object") {
    if (body.code && t.has(`errors.${body.code}`)) return t(`errors.${body.code}`, body.args);
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  }
  return t("errors.generic");
}
