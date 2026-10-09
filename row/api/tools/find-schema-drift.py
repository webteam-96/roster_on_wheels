"""Find columns the RIZones code uses that the generated schema lacks.

Scans the C# sources for SQL string literals and collects (table, column)
pairs from:
  * INSERT INTO table (col, ...)
  * UPDATE table [alias] SET col = ..., col = ...
  * FROM / JOIN table alias ... alias.col   (within one SQL literal)
then compares them with information_schema of a database built from
database/schema.sql (+ schema-drift.sql).

  python -I tools/find-schema-drift.py <reference RotaryApi dir> <columns.tsv>

columns.tsv: "table<TAB>column" lines, e.g. from
  SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'row_verify'
"""
import os
import re
import sys
from collections import defaultdict

src_dir, columns_file = sys.argv[1], sys.argv[2]

schema = defaultdict(set)
for line in open(columns_file, encoding="utf8"):
    parts = line.rstrip("\n").split("\t")
    if len(parts) == 2:
        schema[parts[0].lower()].add(parts[1].lower())

# Verbatim (@"...") and regular ("...") C# string literals, plus $ interpolation.
LITERAL = re.compile(r'\$?@"((?:[^"]|"")*)"|\$?"((?:[^"\\]|\\.)*)"', re.S)
IDENT = r"`?([A-Za-z_][A-Za-z0-9_]*)`?"
SQL_KEYWORDS = {
    "where", "on", "set", "left", "right", "inner", "outer", "join", "cross", "group", "order", "limit", "union", "and", "or",
    "as", "using", "having", "natural", "straight_join", "for", "lock", "into", "values", "select", "with", "when", "then",
}

missing = defaultdict(set)  # (table, column) -> files


def note(table, column, path):
    t, c = table.lower(), column.lower()
    if t not in schema:
        return  # unknown table (temp tables, CTEs, other DBs) - not a column drift
    if c in schema[t] or c == "*":
        return
    missing[(t, c)].add(os.path.basename(path))


for root, _, files in os.walk(src_dir):
    if os.sep + "bin" in root or os.sep + "obj" in root:
        continue
    for name in files:
        if not name.endswith(".cs") or name in ("DatabaseInitializer.cs",):
            continue
        path = os.path.join(root, name)
        text = open(path, encoding="utf8", errors="replace").read()
        for m in LITERAL.finditer(text):
            sql = (m.group(1) if m.group(1) is not None else m.group(2)) or ""
            if not re.search(r"\b(select|insert|update|delete)\b", sql, re.I):
                continue
            sql = re.sub(r"\{[^{}]*\}", " ", sql)  # interpolation holes
            # INSERT INTO t (a, b)
            for im in re.finditer(r"insert\s+(?:ignore\s+)?into\s+" + IDENT + r"\s*\(([^)]*)\)", sql, re.I):
                for col in im.group(2).split(","):
                    col = col.strip().strip("`")
                    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", col):
                        note(im.group(1), col, path)
            # UPDATE t [alias] SET a = ..., b = ...
            for um in re.finditer(r"update\s+" + IDENT + r"(?:\s+(?!set\b)" + IDENT + r")?\s+set\s+(.*?)(?:\bwhere\b|$)", sql, re.I | re.S):
                table = um.group(1)
                for am in re.finditer(r"(?:^|,)\s*(?:" + IDENT + r"\.)?" + IDENT + r"\s*=", um.group(3)):
                    note(table, am.group(2), path)
            # alias map from FROM / JOIN / UPDATE
            aliases = {}
            for fm in re.finditer(r"\b(?:from|join|update)\s+" + IDENT + r"(?:\s+(?:as\s+)?" + IDENT + r")?", sql, re.I):
                table, alias = fm.group(1), fm.group(2)
                if table.lower() in SQL_KEYWORDS:
                    continue
                aliases[table.lower()] = table
                if alias and alias.lower() not in SQL_KEYWORDS:
                    aliases[alias.lower()] = table
            for am in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\.`?([A-Za-z_][A-Za-z0-9_]*)`?", sql):
                a, col = am.group(1).lower(), am.group(2)
                if a in aliases:
                    note(aliases[a], col, path)
            # Single-table SELECT (no JOIN, no sub-select): bare columns in the select list and WHERE comparisons.
            sm = re.fullmatch(r"\s*select\s+(.*?)\s+from\s+" + IDENT + r"(?:\s+(?:as\s+)?" + IDENT + r")?\s*(?:where\s+(.*?))?\s*(?:order\s+by.*|group\s+by.*|limit.*)?;?\s*", sql, re.I | re.S)
            if sm and not re.search(r"\bjoin\b|\(\s*select\b|\bunion\b", sql, re.I):
                table = sm.group(2)
                depth, item, items = 0, "", []
                for ch in sm.group(1):
                    depth += ch == "("
                    depth -= ch == ")"
                    if ch == "," and depth == 0:
                        items.append(item)
                        item = ""
                    else:
                        item += ch
                items.append(item)
                for it in items:
                    bare = re.fullmatch(r"\s*`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+(?:as\s+)?[A-Za-z_][A-Za-z0-9_]*)?\s*", it, re.I)
                    if bare and bare.group(1).lower() not in SQL_KEYWORDS | {"distinct", "null", "true", "false"}:
                        note(table, bare.group(1), path)
                for wm in re.finditer(r"(?<![.@\w])`?([A-Za-z_][A-Za-z0-9_]*)`?\s*(?:=|<>|!=|\bin\b|\bis\b|>=|<=)", sm.group(4) or "", re.I):
                    if wm.group(1).lower() not in SQL_KEYWORDS | {"not", "null"}:
                        note(table, wm.group(1), path)

for (t, c), where in sorted(missing.items()):
    print(f"{t}\t{c}\t{', '.join(sorted(where))}")
print(f"-- {len(missing)} missing column(s)", file=sys.stderr)
