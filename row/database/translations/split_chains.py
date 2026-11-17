"""List Dart implicit string concatenations whose parts are separate glossary keys, with every translation joined.

    python -I row/database/translations/split_chains.py row

Each chain must read as one sentence in every language; fix fragments with fix_labels.py.
"""
import json, pathlib, re, sys

sys.stdout.reconfigure(encoding="utf-8")
ROW = pathlib.Path(sys.argv[1])
d = {}
for f in (ROW / "database/translations").glob("ui-labels-*.json"):
    d.update({k: v for k, v in json.loads(f.read_text(encoding="utf-8")).items() if not k.startswith("_")})

LIT = r"""(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")"""
RUN = re.compile(LIT + r"(?:\s+" + LIT + r")+")
ONE = re.compile(LIT)


def val(s):
    return re.sub(r"\\(.)", r"\1", s[1:-1])


seen, n = set(), 0
for p in sorted((ROW / "mobile/lib/presentation").rglob("*.dart")):
    for m in RUN.finditer(p.read_text(encoding="utf-8")):
        ch = tuple(val(x) for x in ONE.findall(m.group(0)))
        if len(ch) < 2 or ch in seen or not all(c in d for c in ch):
            continue
        seen.add(ch)
        n += 1
        print(f"## {n} {p.name}\nEN " + "|".join(ch))
        for j, l in enumerate("fr de it ja ko pt es".split()):
            print(l.upper(), "|".join(d[c][j] or "" for c in ch))
print("chains", n, file=sys.stderr)
