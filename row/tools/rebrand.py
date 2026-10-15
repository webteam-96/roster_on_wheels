"""Rebrand a RIZones source copy to ROW (the .NET backend). Rerunnable; safe to apply to a fresh
copy of upstream RIZones code after `scrub_settings.py`. Prints how many replacements each rule made.

Order matters: code-level rules (domains / contacts that become Brand settings) run first, plain
text rules (product name in messages and comments) last.

usage: python -I tools/rebrand.py <root>      (root = the row/ project root, e.g. ".")
"""
import os
import re
import sys

SKIP = {"node_modules", ".next", "bin", "obj", "dist", "out", ".git", "tools"}
CS = {".cs", ".cshtml"}
WEB = {".ts", ".tsx", ".js", ".jsx", ".mjs"}
TEXT = CS | WEB | {".json", ".html", ".css", ".md", ".sql", ".txt", ".config", ".xml"}
B = "RotaryApi.Services.Brand"

# (extensions, pattern, replacement, flags)
RULES = [
    # ── C#: deployment values become Brand settings ─────────────────────────────────────────
    (CS, r'"https://rizones45678\.org/API"', f"{B}.ApiOrigin", 0),
    (CS, r'"https://rizones45678\.org"', f"{B}.PortalOrigin", 0),
    (CS, r'"(?:rotaryindia|rizones45678|rizones4567)\.org"', f"{B}.ClubSiteParentDomain", 0),
    (CS, r'"noreply@(?:rizones45678|rizones4567|rotaryindia)\.org"', f"{B}.NoReplyEmail", 0),
    (CS, r'"(?:communication|payment|promotion)@kaizeninfotech\.com(?:,(?:communication|payment|promotion)@kaizeninfotech\.com)*"',
     f"{B}.InternalCc", 0),
    (CS, r'new\[\]\s*\{\s*"mukesh\.dhole@kaizeninfotech\.com",\s*"naren@kaizeninfotech\.com"\s*\}', f"{B}.ReportRecipients", 0),
    (CS, r'TestRecipientEmails = \{[^}]*kaizeninfotech[^}]*\};', f"TestRecipientEmails = {B}.ReportRecipients;", 0),
    (CS, r'LiveCcEmails = \{[^}]*kaizeninfotech[^}]*\};',
     f"LiveCcEmails = {B}.InternalCc.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);", 0),
    (CS, r'"mukesh\.dhole@kaizeninfotech\.com"', f"{B}.SupportEmail", 0),
    (CS, r'public const string MASS_EMAIL_SENDER_EMAIL = "communication@rizones45678\.org";',
     f"public static string MASS_EMAIL_SENDER_EMAIL => {B}.CommunicationEmail;", 0),
    (CS, r'"support@(?:rotaryzones4567|rizones45678|rizones4567)\.org"', f"{B}.SupportEmail", 0),
    (CS, r'"webmarketplace\.rotaryindia\.org"', f"{B}.PortalDomain", 0),
    (CS, r'private const string DefaultPhone = "8424064369";[^\n]*', f"private static string DefaultPhone => {B}.SupportPhone;", 0),
    (CS, r"'rizones45678\.org'", "''", 0),
    (CS, r'"RotaryIndia-Sync-Worker"', '"ROW-Sync-Worker"', 0),
    (CS, r'"RotaryIndia-Sync"', '"ROW-Sync"', 0),
    (CS, r'ApplicationName = "RotaryIndia"', 'ApplicationName = "ROW"', 0),
    (CS, r'\brotaryIndia = ', "local = ", 0),

    # a const cannot hold a Brand value (read at start-up): make it a property
    (CS, r"(private|public|internal) const string (\w+) = (RotaryApi\.Services\.Brand\.\w+);", r"\1 static string \2 => \3;", 0),

    # ── Web: fallbacks become environment variables ─────────────────────────────────────────
    (WEB, r'(\?\?|\|\|)\s*"https://rizones45678\.org/API"', r'\1 process.env.NEXT_PUBLIC_API_ORIGIN \1 ""', 0),
    (WEB, r'=\s*"https://rizones45678\.org/API";', '= process.env.NEXT_PUBLIC_API_ORIGIN ?? "";', 0),
    (WEB, r'href="https://rizones45678\.org/?"', 'href={process.env.NEXT_PUBLIC_PORTAL_ORIGIN || "/"}', 0),
    (WEB, r'"https://rizones45678\.org/login"', '"/login"', 0),
    (WEB, r'\|\|\s*"support@rotaryindia\.org"', '|| ""', 0),
    (WEB, r'"https://rizones45678\.org/login"', '"/login"', 0),

    # ── RIZones app-store listings and logo files ─────────────────────────────────────────────
    (CS, r"'https://itunes\.apple\.com/[a-z]{2}/app/[\w-]+/id682238809\?mt=8'", "''", 0),
    (WEB, r'"https://itunes\.apple\.com/[a-z]{2}/app/[\w-]+/id682238809\?mt=8"', 'process.env.NEXT_PUBLIC_IOS_APP_URL ?? ""', 0),
    (WEB, r'"https://apps\.apple\.com/[a-z]{2}/app/[\w-]+/id682238809[^"]*"', 'process.env.NEXT_PUBLIC_IOS_APP_URL ?? ""', 0),
    (WEB, r'"https://play\.google\.com/store/apps/details\?id=com\.SampleApp\.\w+[^"]*"', 'process.env.NEXT_PUBLIC_ANDROID_APP_URL ?? ""', 0),
    (TEXT, r"rotary-zone-log-white\.png", "rotary-white-live.png", 0),   # ROW white lockup
    (TEXT, r"rotary-zone-log-blue\.png", "rotary-masterbrand.png", 0),   # ROW blue lockup

    # ── Identifiers that named RIZones ───────────────────────────────────────────────────────
    (TEXT, r"\brizonesCount\b", "localCount", 0),
    (TEXT, r"\brizonesHonorary\b", "localHonorary", 0),
    (TEXT, r"\brizonesRids\b", "localRids", 0),
    (TEXT, r"\brizones45678_", "row_", 0),
    (TEXT, r"\bupdated_rizones_", "updated_row_", 0),

    # ── Plain text: URLs, addresses, then names ──────────────────────────────────────────────
    (TEXT, r"https?://(?:www\.)?rizones4567?8?\.org", "https://portal.example.org", re.I),
    (TEXT, r"[\w.+-]+@(?:rizones4567?8?|rotaryzones4567|rotaryindia)\.org", "support@example.org", re.I),
    (TEXT, r"[\w.+-]+@kaizeninfotech\.com", "support@example.org", re.I),
    (TEXT, r"https?://(?:[\w-]+\.)*rotaryindia1?\.org", "https://club.example.org", re.I),
    (TEXT, r"\b(?:[\w-]+\.)+rotaryindia\.org(?:\.rizones45678\.org)?", "club.example.org", re.I),
    (TEXT, r"\b(?:[\w-]+\.)+rizones4567?8?\.org", "club.example.org", re.I),
    (TEXT, r"(?:www\.)?kaizeninfotech\.com", "example.org", re.I),
    (TEXT, r"\b(?:www\.)?rotaryindia\.org\b", "example.org", re.I),
    (TEXT, r"\bRizones4567?8?\.org\b", "ROW", 0),          # used as the product name in messages
    (TEXT, r"\b(?:www\.)?rizones4567?8?\.org\b", "portal.example.org", re.I),
    (TEXT, r"\bRizones4567?8?\b", "ROW", re.I),
    (TEXT, r"Rotary\s+Zones?\s+4(?:\s*(?:,|&amp;|&|and|[-–])\s*\d)*", "ROW", re.I),
    (TEXT, r"\bZones?\s+4\s*(?:,\s*5|[-–]\s*8)(?:\s*(?:,|&amp;|&|and)\s*\d)*", "the zones", re.I),
    (TEXT, r"\bRotary\s?India\b", "ROW", re.I),
    (TEXT, r"\bRIZones\b|\bRizones\b|\bRIzones\b|\brizones\b", "ROW", 0),
    (TEXT, r"\bROW\s+4\s*,\s*5\s*,\s*6(?:\s*,\s*7)?\s*(?:&amp;|&|and)\s*8", "ROW", 0),  # "RIZones 4,5,6,7 & 8" leftovers
    (TEXT, r"\+91[\s-]?8424064369|\+91[\s-]?8928755144|8424064369|8928755144", "", 0),
]


def main(root):
    counts = [0] * len(RULES)
    changed_files = 0
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP]
        for n in names:
            ext = os.path.splitext(n)[1].lower()
            if ext not in TEXT or n == "package-lock.json":
                continue
            p = os.path.join(d, n)
            # This edition's own README describes where the code came from; never rewrite it.
            if os.path.abspath(p) == os.path.abspath(os.path.join(root, "README.md")):
                continue
            try:
                src = open(p, encoding="utf-8").read()
            except UnicodeDecodeError:
                continue
            out = src
            for i, (exts, pat, rep, flags) in enumerate(RULES):
                if ext in exts:
                    out, k = re.subn(pat, rep, out, flags=flags)
                    counts[i] += k
            if out != src:
                open(p, "w", encoding="utf-8", newline="").write(out)
                changed_files += 1
    for (exts, pat, rep, _), c in zip(RULES, counts):
        if c:
            print(f"{c:5}  {pat[:70]}  ->  {rep[:50]}")
    print(f"files changed: {changed_files}")


if __name__ == "__main__":
    main(sys.argv[1])
