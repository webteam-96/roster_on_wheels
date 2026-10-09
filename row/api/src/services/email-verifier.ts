import { randomUUID } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { Socket } from "node:net";

export interface VerifyResult {
  isValid: boolean;
  reason: string | null;
}

/**
 * Port of EmailVerifier.cs: format check, then MX lookup, then an SMTP
 * RCPT TO probe on port 25 (after testing whether the server accepts any
 * address). Anything inconclusive counts as valid, with a reason.
 */
export async function verifyEmail(email: string, fromEmail: string, timeoutMs = 8000): Promise<VerifyResult> {
  if (!email || !email.trim()) return { isValid: false, reason: "Email is empty." };
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+$/.test(email.trim())) return { isValid: false, reason: "Invalid email format." };
  const domain = email.slice(email.lastIndexOf("@") + 1);
  let hosts: string[];
  try {
    hosts = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((r) => r.exchange.replace(/\.$/, ""));
    if (!hosts.length) return { isValid: false, reason: `No MX records for domain '${domain}'.` };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND") return { isValid: false, reason: `No MX records for domain '${domain}'.` };
    return { isValid: true, reason: `MX lookup inconclusive: ${(e as Error).message}` };
  }
  const fake = `__nope_${randomUUID().replace(/-/g, "")}@${domain}`;
  for (const mx of hosts.slice(0, 2)) {
    try {
      const fakeResult = await probe(mx, fake, fromEmail, timeoutMs);
      if (fakeResult.isValid && fakeResult.reason === null) return { isValid: true, reason: "ACCEPT_ALL: Server accepts all recipients — cannot verify mailbox." };
      const real = await probe(mx, email, fromEmail, timeoutMs);
      if (real.isValid && real.reason === null) return { isValid: true, reason: null };
      if (real.reason?.startsWith("5")) return real;
    } catch {
      // try the next MX
    }
  }
  return { isValid: true, reason: "MX probe inconclusive (unreachable or timed out)." };
}

function probe(host: string, to: string, from: string, timeoutMs: number): Promise<VerifyResult> {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    let buf = "";
    const waiting: ((line: string) => void)[] = [];
    const finish = (fn: () => void) => {
      sock.destroy();
      fn();
    };
    sock.setTimeout(timeoutMs, () => finish(() => reject(new Error("timeout"))));
    sock.on("error", (e) => finish(() => reject(e)));
    sock.on("close", () => waiting.splice(0).forEach((w) => w("")));
    sock.on("data", (d) => {
      buf += d.toString("ascii");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        // "250-..." is a continuation line: keep reading
        if (line.length >= 4 && line[3] !== " ") continue;
        waiting.shift()?.(line);
      }
    });
    const next = () => new Promise<string>((r) => waiting.push(r));
    const say = (s: string) => sock.write(s + "\r\n");
    void (async () => {
      const banner = next();
      sock.connect(25, host);
      const b = await banner;
      if (!b.startsWith("220")) return finish(() => resolve({ isValid: true, reason: `Probe unclear banner: ${b}` }));
      say(`HELO verify.${randomUUID().replace(/-/g, "")}.local`);
      const helo = await next();
      if (!helo.startsWith("250")) return finish(() => resolve({ isValid: true, reason: `Probe HELO refused: ${helo}` }));
      say(`MAIL FROM:<${from}>`);
      const mf = await next();
      if (!mf.startsWith("250")) return finish(() => resolve({ isValid: true, reason: `Probe MAIL FROM refused: ${mf}` }));
      say(`RCPT TO:<${to}>`);
      const rcpt = await next();
      try {
        say("QUIT");
      } catch {
        // closing anyway
      }
      if (rcpt.startsWith("250") || rcpt.startsWith("251")) return finish(() => resolve({ isValid: true, reason: null }));
      if (rcpt.startsWith("550") || rcpt.startsWith("551") || rcpt.startsWith("553")) return finish(() => resolve({ isValid: false, reason: `Mailbox rejected: ${rcpt}` }));
      finish(() => resolve({ isValid: true, reason: `Probe inconclusive: ${rcpt}` }));
    })();
  });
}
