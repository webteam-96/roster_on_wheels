"""First-pass review of the UI label glossary, and one sheet per language for a native-speaker reviewer.

    python -I row/database/translations/review.py

Reads ui-labels-*.json (English label -> fr de it ja ko pt es) and writes review/<lang>.csv (UTF-8 with BOM, opens
in Excel). Each row: English, current translation, the automatic flags, and empty "Corrected" and "Comment" columns
for the reviewer. Flagged rows come first. Prints a per-language summary.

Automatic checks (they find likely problems; they do not replace a native speaker):
  empty        no translation
  same         identical to the English (fine for names and codes, suspicious otherwise)
  placeholder  {x}, %s, {0} or numbers differ from the English
  script       Japanese / Korean text with no Japanese / Korean characters
  long         more than 2.2x the English length on a short label (button / menu overflow risk)
  edges        leading or trailing space, or the end punctuation (. : ? !) differs
  term         a core term is translated differently from how most labels translate it
"""
import collections, csv, json, pathlib, re

HERE = pathlib.Path(__file__).resolve().parent
LANGS = ["fr", "de", "it", "ja", "ko", "pt", "es"]
OUT = HERE / "review"

# Core terms whose translation should be the same everywhere in the product.
TERMS = ["Club", "District", "Member", "Members", "Rotary Year", "Board of Directors", "President", "Secretary",
         "Treasurer", "Dues", "Attendance", "Project", "Projects", "Zone", "Assistant Governor", "District Governor",
         "Meeting", "Event", "Events", "Dashboard", "Settings", "Save", "Cancel", "Delete", "Edit", "Search",
         "Subscription", "Newsletter", "Report", "Reports", "Directory", "Volunteer"]
PLACEHOLDER = re.compile(r"\{[^{}]*\}|%[sd]")
JA = re.compile(r"[぀-ヿ一-鿿]")
KO = re.compile(r"[가-힯]")
END = re.compile(r"[.:?!。：？！]$")


def load():
    labels = {}
    for f in sorted(HERE.glob("ui-labels-*.json"), key=lambda p: int(re.findall(r"\d+", p.name)[0])):
        for k, v in json.loads(f.read_text(encoding="utf-8")).items():
            if not k.startswith("_"):
                labels[k] = v
    return labels


def term_usage(labels):
    """For each language and term: how labels that are exactly the term are translated (the reference)."""
    ref = {}
    for i, lang in enumerate(LANGS):
        for t in TERMS:
            if t in labels and labels[t][i]:
                ref[(lang, t)] = labels[t][i].strip()
    return ref


def flags(en, tr, lang, ref, shared=frozenset()):
    out = []
    if not tr or not tr.strip():
        return ["empty"]
    if tr.strip() == en.strip() and re.search(r"[a-z]{3}", en) and en not in shared:
        out.append("same")
    if sorted(PLACEHOLDER.findall(en)) != sorted(PLACEHOLDER.findall(tr)):
        out.append("placeholder")
    words = re.search(r"\b[a-z]{4,}\b", en)  # a real word, not only codes such as "PDF, DOCX"
    if words and lang == "ja" and not JA.search(tr):
        out.append("script")
    if words and lang == "ko" and not KO.search(tr):
        out.append("script")
    if len(en) <= 24 and len(tr) > 2.2 * len(en) + 4 and lang not in ("ja", "ko"):
        out.append("long")
    spaces_differ = (en[:1].isspace(), en[-1:].isspace()) != (tr[:1].isspace(), tr[-1:].isspace())
    if spaces_differ or bool(END.search(en.strip())) != bool(END.search(tr.strip())):
        out.append("edges")
    for t in TERMS:
        r = ref.get((lang, t))
        if not r or en == t or len(en.split()) > 4 or not re.search(r"\b" + re.escape(t) + r"\b", en):
            continue
        stem = r.lower()[:max(4, len(r) - 2)]  # tolerate inflection: Distretto / distrettuale
        if stem not in tr.lower():
            out.append(f"term:{t}={r}")
            break
    return out


def main():
    labels = load()
    ref = term_usage(labels)
    # Names and codes left in English by most languages (countries, file types) are not flagged as "same".
    shared = frozenset(en for en, trs in labels.items() if sum(1 for t in trs if t.strip() == en.strip()) >= 4)
    OUT.mkdir(exist_ok=True)
    print(f"{len(labels)} labels")
    for i, lang in enumerate(LANGS):
        rows = []
        for en, trs in labels.items():
            tr = trs[i] if i < len(trs) else ""
            rows.append((en, tr, flags(en, tr, lang, ref, shared)))
        rows.sort(key=lambda r: (not r[2], r[0].lower()))
        with (OUT / f"{lang}.csv").open("w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["English", "Translation", "Flags", "Corrected", "Comment"])
            for en, tr, fl in rows:
                w.writerow([en, tr, " ".join(fl), "", ""])
        c = collections.Counter(f.split(":")[0] for _, _, fl in rows for f in fl)
        print(f"{lang}: {sum(1 for r in rows if r[2])} flagged  " + "  ".join(f"{k}={v}" for k, v in sorted(c.items())))


if __name__ == "__main__":
    main()
