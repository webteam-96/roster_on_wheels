"""Apply reviewed corrections to the UI label glossary (ui-labels-*.json) without reformatting the files.

    python -I row/database/translations/fix_labels.py corrections.json

corrections.json: [{"en": "<English label>", "lang": "ko", "to": "<corrected text>", "why": "<reason>"}, ...]
Each correction replaces only that one string in the file's text, then the file is parsed again to check that exactly
the intended value changed. An unknown label or language stops the run before anything is written.
Afterwards run build_sql.py to rebuild the database script.
"""
import json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
LANGS = ["fr", "de", "it", "ja", "ko", "pt", "es"]


def enc(s):
    return json.dumps(s, ensure_ascii=False)


def main():
    fixes = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    texts = {p: p.read_text(encoding="utf-8") for p in sorted(HERE.glob("ui-labels-*.json"))}
    where = {k: p for p, t in texts.items() for k in json.loads(t)}
    for f in fixes:
        if f["en"] not in where or f["lang"] not in LANGS:
            sys.exit(f"unknown label or language, nothing written: {f}")
    applied = 0
    for f in fixes:
        p = where[f["en"]]
        text = texts[p]
        i = LANGS.index(f["lang"])
        old = json.loads(text)[f["en"]][i]
        if old == f["to"]:
            continue
        start = text.index(enc(f["en"]) + ":")
        end = text.index("]", start)
        # the i-th string literal of this label's array
        pos = text.index("[", start) + 1
        for _ in range(i):
            pos = text.index(enc(json.loads(text)[f["en"]][_]), pos) + len(enc(json.loads(text)[f["en"]][_]))
        at = text.index(enc(old), pos)
        if at > end:
            sys.exit(f"could not place {f}")
        new_text = text[:at] + enc(f["to"]) + text[at + len(enc(old)):]
        before, after = json.loads(text), json.loads(new_text)
        before[f["en"]][i] = f["to"]
        if before != after:
            sys.exit(f"edit changed more than intended, nothing written for {p.name}: {f}")
        texts[p] = new_text
        applied += 1
    for p, t in texts.items():
        if t != p.read_text(encoding="utf-8"):
            p.write_text(t, encoding="utf-8", newline="")
    print(f"{len(fixes)} corrections read, {applied} applied")


if __name__ == "__main__":
    main()
