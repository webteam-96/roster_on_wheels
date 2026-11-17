"""Writes ui-labels-29.json: each sentence the app builds from adjacent literals, translated as the join of its
already-reviewed pieces. Only runs whose every piece has a glossary entry are written.

    python -I row/database/translations/join_split.py row

The app looks up a split sentence whole (Dart joins adjacent literals), so run this after fixing any piece, then
build_sql.py. Sentences with a piece missing are listed; translate those whole in ui-labels-30.json."""
import json, pathlib, re, sys

sys.stdout.reconfigure(encoding="utf-8")
ROW = pathlib.Path(sys.argv[1])
TR = ROW / "database/translations"
d = {}
for f in TR.glob("ui-labels-*.json"):
    if f.name == "ui-labels-29.json":
        continue
    d.update({k: v for k, v in json.loads(f.read_text(encoding="utf-8")).items() if not k.startswith("_")})
known = (ROW / "mobile/lib/core/i18n/ui_strings.g.dart").read_text(encoding="utf-8")

PIECE = r"""(?<![\w$r])(?:'(?:[^'\\$\n]|\\.)*'|"(?:[^"\\$\n]|\\.)*")"""
RUN = re.compile(PIECE + r"(?:\s+" + PIECE + r")+")
ESC = {"n": "\n", "'": "'", '"': '"'}


def unescape(s):
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\":
            if i + 1 >= len(s) or s[i + 1] not in ESC:
                return None
            out.append(ESC[s[i + 1]]); i += 2
        else:
            out.append(s[i]); i += 1
    return "".join(out)


out, missing = {"_columns": ["fr", "de", "it", "ja", "ko", "pt", "es"],
                "_note": "Whole sentences the app joins from adjacent literals (2026-11-17). Each is the join of its reviewed pieces; edit the pieces, then rerun."}, []
for p in sorted((ROW / "mobile/lib").rglob("*.dart")):
    text = p.read_text(encoding="utf-8")
    for m in RUN.finditer(text):
        if text[:m.start()].rstrip()[-1:] in ("'", '"') or re.match(r"""\s*['"]""", text[m.end():]):
            continue
        pieces = [unescape(x[1:-1]) for x in re.findall(PIECE, m.group(0))]
        if None in pieces:
            continue
        en = "".join(pieces)
        if en in out or en in d:
            continue
        if all(x in d for x in pieces):
            out[en] = ["".join(d[x][i] for x in pieces) for i in range(7)]
        elif re.search(r"[A-Za-z]{3,} [A-Za-z]{3,}", en):
            missing.append(en)
(TR / "ui-labels-29.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(len(out) - 2, "joined sentences written")
print("pieces missing from the glossary:")
for m in missing:
    print("  ", m[:110])
