"""Write one re-runnable SQL script that brings a database up to the schema of the local copy.

Usage:  python -I kb/tools/schema_catchup.py <mysql_port> <local_db> <out.sql>
Login: root on 127.0.0.1 (MYSQL_PWD if set).

Why: production runs the API with Database__SkipInit=true, so tables and columns that DatabaseInitializer adds at
start never reach it, and the hand-written scripts missed some (2026-11-23: club_documents.IsPublicOnWebsite,
membership_dues.NotifyEmail/Currency gave 500s on live). The local copy has had the initializer run, so its schema is
what the code expects.

The script only ADDS: a table when it is missing (CREATE TABLE IF NOT EXISTS, from SHOW CREATE TABLE), a column when it
is missing (same definition as local), a secondary index when no index of that name exists. It never drops, renames,
or changes an existing column, and touches no data. Safe to run twice. Run it on the target with a backup first.
"""
import subprocess, sys

PORT, DB, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"


def unescape(field):
    # batch mode escapes \n, \t, \\ and \0 so one row stays on one line
    out, i = [], 0
    while i < len(field):
        if field[i] == "\\" and i + 1 < len(field):
            out.append({"n": "\n", "t": "\t", "0": "\0", "\\": "\\"}.get(field[i + 1], field[i + 1]))
            i += 2
        else:
            out.append(field[i])
            i += 1
    return "".join(out)


def q(sql):
    r = subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-B", "-e", sql],
                       capture_output=True, text=True, encoding="utf-8", check=True)
    return [[unescape(f) for f in line.split("\t")] for line in r.stdout.splitlines()]


def lit(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'"


tables = [t for (t,) in q(f"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='{DB}' "
                          "AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")]
out = [
    f"-- Schema catch-up generated from the local copy `{DB}` by kb/tools/schema_catchup.py. Adds only what is missing:",
    "-- tables, columns, secondary indexes. Never drops or changes anything; safe to run twice. Back up first.",
    "SET NAMES utf8mb4;",
    "SET @old_fk := @@FOREIGN_KEY_CHECKS; SET FOREIGN_KEY_CHECKS = 0;",
    "DROP PROCEDURE IF EXISTS row_catchup_exec;",
    "DELIMITER //",
    "CREATE PROCEDURE row_catchup_exec(IN missing INT, IN ddl TEXT)",
    "BEGIN",
    "  IF missing = 0 THEN",
    "    SET @ddl = ddl; PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;",
    "  END IF;",
    "END //",
    "DELIMITER ;",
    "",
]
for t in tables:
    create = q(f"SHOW CREATE TABLE `{t}`")[0][1]
    out.append(create.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS", 1) + ";")

cols = q(f"""SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT,'\\\\N'), EXTRA,
                    IFNULL(CHARACTER_SET_NAME,''), IFNULL(COLLATION_NAME,''), COLUMN_KEY
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{DB}' ORDER BY TABLE_NAME, ORDINAL_POSITION""")
for t, c, ctype, nullable, default, extra, cs, coll, key in cols:
    if t not in tables or key == "PRI":
        continue  # a primary-key column only exists with its table
    d = f"`{c}` {ctype}"
    if cs:
        d += f" CHARACTER SET {cs} COLLATE {coll}"
    d += " NULL" if nullable == "YES" else " NOT NULL"
    if default != "\\N":
        # an expression default (CURRENT_TIMESTAMP, (uuid())) is written as is; a value is quoted, numbers too
        d += f" DEFAULT {default}" if "DEFAULT_GENERATED" in extra else f" DEFAULT {lit(default)}"
    extra_clean = extra.replace("DEFAULT_GENERATED", "").strip()
    if extra_clean and "auto_increment" not in extra_clean.lower():
        d += " " + extra_clean
    ddl = f"ALTER TABLE `{t}` ADD COLUMN {d}"
    out.append(f"CALL row_catchup_exec((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
               f"AND TABLE_NAME = {lit(t)} AND COLUMN_NAME = {lit(c)}), {lit(ddl)});")

idx = q(f"""SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(CONCAT('`', COLUMN_NAME, '`',
                    IF(SUB_PART IS NULL, '', CONCAT('(', SUB_PART, ')'))) ORDER BY SEQ_IN_INDEX), MAX(INDEX_TYPE)
            FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='{DB}' AND INDEX_NAME <> 'PRIMARY'
            GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME""")
for t, name, non_unique, columns, itype in idx:
    if t not in tables:
        continue
    kind = "FULLTEXT INDEX" if itype == "FULLTEXT" else ("INDEX" if non_unique == "1" else "UNIQUE INDEX")
    ddl = f"ALTER TABLE `{t}` ADD {kind} `{name}` ({columns})"
    out.append(f"CALL row_catchup_exec((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
               f"AND TABLE_NAME = {lit(t)} AND INDEX_NAME = {lit(name)}), {lit(ddl)});")

out += ["", "DROP PROCEDURE IF EXISTS row_catchup_exec;", "SET FOREIGN_KEY_CHECKS = @old_fk;", ""]
open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(out))
print(f"{len(tables)} tables, {len(cols)} columns, {len(idx)} indexes -> {OUT}")
