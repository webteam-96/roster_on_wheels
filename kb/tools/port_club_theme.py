"""Copy files from the RIZones club site (Vite) into row/club-website, rewriting imports to the Next.js layout.

Usage: python kb/tools/port_club_theme.py <source path relative to src/> <target path relative to src/> [...]
Pairs of arguments. Only imports are rewritten; data hooks are hand-ported afterwards (see
docs/plans/2026-10-29-club-themes-rizones-port.md). Files that use React hooks get 'use client'.
"""
import os
import re
import sys

SRC = r"E:\websites\Club-Website-reactjs\Club-Website-reactjs\src"
DST = os.path.join(os.path.dirname(__file__), "..", "..", "row", "club-website", "src")

# Import specifier rewrites, keyed on the module's basename / path tail.
REWRITES = [
    (r"(?:\.\./)+context/ClubProvider\.jsx", "@/site/ClubContext.jsx"),
    (r"(?:\.\./)+lib/media\.js", "@/site/media.js"),
    (r"(?:\.\./)+routes\.js", "@/site/routes.js"),
    (r"(?:\.\./)+config\.js", "@/site/config.js"),
    (r"react-router-dom", "@/site/router.js"),
    (r"(?:\.\./)+lib/apiCache\.js", "@/site/apiCache.js"),
    (r"(?:\.\./)+pages/gold/([A-Za-z]+\.(?:js|jsx))", r"@/themes/gold/pages/\1"),
    (r"(?:\.\./)+pages/([A-Za-z_]+)\.jsx", r"@/themes/shared/pages/\1.jsx"),
    (r"(?:\.\./)+theme/themeAssets\.js", "@/site/themeAssets.js"),
    (r"(?:\.\./)+theme/ThemeProvider\.jsx", "@/site/theme.js"),
    (r"(?:\.\./)+api/clubService\.js", "@/site/clubApi.js"),
    (r"(?:\.\./)+(?:\.\./)?pages/gold/([A-Za-z]+\.(?:js|jsx))", r"@/themes/gold/pages/\1"),
    (r"\./gold/([A-Za-z]+\.(?:js|jsx))", r"@/themes/gold/pages/\1"),
    (r"(?:\.\./)+shared/menus\.js", "@/site/menus.js"),
    (r"\./menus\.js", "@/site/menus.js"),
    (r"(?:\.\./)+shared/YearSelect\.jsx", "@/site/YearSelect.jsx"),
    (r"\./YearSelect\.jsx", "@/site/YearSelect.jsx"),
    (r"(?:\.\./)+shared/([A-Za-z]+\.(?:js|jsx|css))", r"@/themes/shared/\1"),
    (r"(?:\.\./)+components/([A-Za-z/]+\.(?:js|jsx|css))", r"@/themes/shared/components/\1"),
    (r"(?:\.\./)+themes/_shared/([A-Za-z]+\.(?:js|jsx|css))", r"@/themes/_shared/\1"),
]


# Sibling imports inside the shared pages folder (src/pages/X.jsx) -> themes/shared/pages.
PAGE_SIBLING = [(r"\./([A-Za-z_]+)\.jsx", r"@/themes/shared/pages/\1.jsx")]


def rewrite(text: str, src_rel: str = "") -> str:
    rules = REWRITES + (PAGE_SIBLING if re.fullmatch(r"pages/[^/]+", src_rel) else [])
    if src_rel.startswith("pages/gold/"):
        rules = rules + [(r"\.\./([A-Za-z_]+)\.jsx", r"@/themes/shared/pages/\1.jsx")]

    def fix(m: re.Match) -> str:
        spec = m.group(2)
        for pat, rep in rules:
            if re.fullmatch(pat, spec):
                return m.group(1) + re.sub(pat, rep, spec) + m.group(3)
        return m.group(0)

    text = re.sub(r"""(from\s+['"])([^'"]+)(['"])""", fix, text)
    text = re.sub(r"""(import\s+['"])([^'"]+)(['"])""", fix, text)
    if re.search(r"\buse[A-Z]\w*\(", text) and not text.lstrip().startswith("'use client'"):
        text = "'use client'\n" + text
    return text


def main(args: list[str]) -> None:
    if len(args) % 2:
        sys.exit("pairs of <source> <target> expected")
    for src_rel, dst_rel in zip(args[::2], args[1::2]):
        src = os.path.join(SRC, src_rel)
        dst = os.path.normpath(os.path.join(DST, dst_rel))
        with open(src, encoding="utf-8") as f:
            text = f.read()
        out = rewrite(text, src_rel) if src.endswith((".js", ".jsx")) else text
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "w", encoding="utf-8", newline="\n") as f:
            f.write(out)
        print(f"{src_rel} -> {os.path.relpath(dst, DST)}")


if __name__ == "__main__":
    main(sys.argv[1:])
