"""Empty the array / object literal of named exports in a TS file, keeping the export and its type.

    export const DISTRICTS: District[] = [ ...RIZones data... ];   ->   export const DISTRICTS: District[] = [];

usage: python -I tools/empty_exports.py <file> NAME [NAME ...]
"""
import re
import sys

PAIRS = {"[": "]", "{": "}"}


def empty(src, name):
    m = re.search(r"(?:export )?const " + re.escape(name) + r"\b[^=]*=\s*", src)
    if not m:
        raise SystemExit(f"{name}: not found")
    start = m.end()
    opener = src[start]
    if opener not in PAIRS:
        raise SystemExit(f"{name}: value is not a literal")
    depth, i, quote = 0, start, None
    while i < len(src):
        c = src[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c == "/" and src[i + 1] == "/":
            i = src.index("\n", i)
            continue
        elif c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0:
                return src[:start] + opener + PAIRS[opener] + src[i + 1:]
        i += 1
    raise SystemExit(f"{name}: unbalanced literal")


if __name__ == "__main__":
    path, names = sys.argv[1], sys.argv[2:]
    text = open(path, encoding="utf-8").read()
    for n in names:
        text = empty(text, n)
    open(path, "w", encoding="utf-8").write(text)
    print(f"{path}: emptied {', '.join(names)}")
