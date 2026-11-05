/** The local path to open after sign-in, or null. Anything that could leave this site, or loop back to sign-in, is refused. */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, "http://local.invalid");
    if (url.origin !== "http://local.invalid" || url.pathname === "/login") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
