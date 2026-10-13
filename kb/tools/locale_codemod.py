"""Replace India-only locale literals in a Next.js admin (RIZones frontend) with the instance's formatting
helpers from `@/lib/appFormat` (master plan WS3-03). Only shapes that are safe to rewrite mechanically
are touched; everything else is listed for review.

    "en-IN" in toLocaleString / toLocaleDateString / toLocaleTimeString / Intl.*Format  ->  appLocale()
    `₹${x}` (template literal)                                                        ->  `${currencySymbol()}${x}`
    ₹{x} and (₹) in JSX text                                                          ->  {currencySymbol()}{x}, ({currencySymbol()})
    "₹" as a whole string                                                             ->  currencySymbol()
    new Date().toISOString().slice(0, 10)                                             ->  todayLocal()

usage: python -I locale_codemod.py <src dir> [--dry-run]
"""
import os
import re
import sys

SKIP_FILES = {"format.ts", "appFormat.ts", "format.test.ts", "currency.ts", "dateUtils.ts"}
RULES = [
    ("appLocale", re.compile(r"""(\.toLocale(?:String|DateString|TimeString)\(\s*)["']en-IN["']"""), r"\1appLocale()"),
    ("appLocale", re.compile(r"""(new\s+Intl\.(?:NumberFormat|DateTimeFormat)\(\s*)["']en-IN["']"""), r"\1appLocale()"),
    ("currencySymbol", re.compile(r"₹\$\{"), "${currencySymbol()}${"),
    ("currencySymbol", re.compile(r"(?<![\"'`$])₹\{"), "{currencySymbol()}{"),
    ("currencySymbol", re.compile(r"\(₹\)(?=\s*<)"), "({currencySymbol()})"),
    ("currencySymbol", re.compile(r"""(?<![\w])["']₹["'](?!\s*:)"""), "currencySymbol()"),  # not an object key
    ("todayLocal", re.compile(r"new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)"), "todayLocal()"),
]
IMPORT_RE = re.compile(r'^import [^;]*from\s+["\'][^"\']+["\'];?\s*$', re.M)
LEFTOVER = re.compile(r"""₹|["']en-IN["']|["']INR["']|Asia/Kolkata|\bIST\b""")


def add_import(src, names):
    m = re.search(r'import\s*\{([^}]*)\}\s*from\s*["\']@/lib/appFormat["\'];?', src)
    if m:
        have = {n.strip() for n in m.group(1).split(",") if n.strip()}
        merged = ", ".join(sorted(have | names))
        return src[:m.start()] + f'import {{ {merged} }} from "@/lib/appFormat";' + src[m.end():]
    line = f'import {{ {", ".join(sorted(names))} }} from "@/lib/appFormat";\n'
    imports = list(IMPORT_RE.finditer(src))
    if imports:
        end = imports[-1].end()
        return src[:end] + "\n" + line.rstrip("\n") + src[end:]
    # no import yet: after a leading "use client" / "use server" directive if there is one
    m = re.match(r'(\s*["\']use (?:client|server)["\'];?\s*\n)', src)
    return (src[:m.end()] + line + src[m.end():]) if m else line + src


def main(root, dry=False):
    totals, changed, leftovers = {}, 0, []
    for d, dirs, names in os.walk(root):
        dirs[:] = [x for x in dirs if x not in {"node_modules", ".next"}]
        for n in names:
            if not n.endswith((".ts", ".tsx")) or n in SKIP_FILES:
                continue
            p = os.path.join(d, n)
            src = open(p, encoding="utf-8").read()
            out, used = src, set()
            for name, rx, rep in RULES:
                out, k = rx.subn(rep, out)
                if k:
                    used.add(name)
                    totals[name] = totals.get(name, 0) + k
            if used:
                out = add_import(out, used)
            for i, line in enumerate(out.splitlines(), 1):
                if LEFTOVER.search(line) and not line.lstrip().startswith(("//", "*", "/*")):
                    leftovers.append(f"{os.path.relpath(p, root)}:{i}: {line.strip()[:120]}")
            if out != src:
                changed += 1
                if not dry:
                    open(p, "w", encoding="utf-8", newline="").write(out)
    print("replacements:", totals, "| files changed:", changed)
    print(f"left for review ({len(leftovers)} lines):")
    for l in leftovers:
        print("  " + l)


if __name__ == "__main__":
    main(sys.argv[1], "--dry-run" in sys.argv)
