"""One-time move of ROW's stored times from India time (IST, UTC+5:30) to UTC (user decision 2026-11-17).

Until 2026-11-17 the API wrote server-local time: the IIS server and the shared MySQL server run on India time.
The new code writes UTC (RowDb runs every session in UTC; DateTime.UtcNow). This script shifts the existing rows
so old and new rows agree. Deploy the new code and run this in the same maintenance window, with the API and
workers STOPPED (rows written by old code after the shift would be IST again).

    python -I row/database/maintenance/utc_migration.py --host H --port P --user U --db D            # dry run
    python -I row/database/maintenance/utc_migration.py --host H --port P --user U --db D --apply    # changes data

The password comes from the ROW_MIGRATION_DB_PASSWORD environment variable (never the command line).
Take a backup first (mysqldump --single-transaction --routines --triggers ...); restoring it is the rollback.

What it does:
  * every DATETIME column of every base table is shifted by -5:30, except
      - date-only columns: every non-null value is at midnight (birthdays, Rotary-year bounds, report months);
      - zero / pre-1000 dates, and any value at exactly midnight (a date, as the API treats it), left as they are;
  * one UPDATE per table assigns every shifted column and every other ON UPDATE CURRENT_TIMESTAMP column, so
    none of them is stamped with "now";
  * UPDATE triggers on those tables (member change log, project audit, the append-only audit_log guard) are
    dropped for the shift and always recreated afterwards, from their own definitions;
  * all row updates run in one transaction, with a marker table (row_utc_migration) so it can never run twice.
Assumption: the existing rows were written in India time. Values that arrived as true UTC from outside (none known)
would end up 5:30 early.
"""
import argparse, os, sys
import pymysql

SHIFT = "INTERVAL 330 MINUTE"
MARKER = "row_utc_migration"


def connect(a):
    pw = os.environ.get("ROW_MIGRATION_DB_PASSWORD", "")
    return pymysql.connect(host=a.host, port=a.port, user=a.user, password=pw, database=a.db,
                           autocommit=False, connect_timeout=15, read_timeout=3600, write_timeout=3600)


def q(cur, sql, args=None):
    cur.execute(sql, args)
    return cur.fetchall()


def plan(cur, db):
    cols = q(cur, """SELECT c.TABLE_NAME, c.COLUMN_NAME FROM information_schema.COLUMNS c
                     JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
                     WHERE c.TABLE_SCHEMA = %s AND c.DATA_TYPE = 'datetime' AND t.TABLE_TYPE = 'BASE TABLE'
                     ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION""", (db,))
    shift, date_only, empty = {}, [], []
    for t, c in cols:
        n = q(cur, f"SELECT COUNT(*), SUM(TIME(`{c}`) <> '00:00:00') FROM `{t}` WHERE `{c}` >= '1000-01-01'")[0]
        if not n[0]:
            empty.append(f"{t}.{c}")            # no values: shift anyway is harmless, skip to keep the UPDATE small
        elif not n[1]:
            date_only.append(f"{t}.{c}")
        else:
            shift.setdefault(t, []).append(c)
    # ON UPDATE CURRENT_TIMESTAMP columns not shifted (all NULL, or dates) must still be assigned, or MySQL stamps
    # "now" into them on every row the UPDATE changes.
    keep = {}
    for t, c in q(cur, """SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
                          WHERE TABLE_SCHEMA = %s AND EXTRA LIKE '%%on update%%'""", (db,)):
        if t in shift and c not in shift[t]:
            keep.setdefault(t, []).append(c)
    triggers = q(cur, """SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS
                         WHERE TRIGGER_SCHEMA = %s AND EVENT_MANIPULATION = 'UPDATE'""", (db,))
    triggers = [(n, t) for n, t in triggers if t in shift]
    return shift, keep, date_only, empty, triggers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True); ap.add_argument("--port", type=int, default=3306)
    ap.add_argument("--user", required=True); ap.add_argument("--db", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    conn = connect(a); cur = conn.cursor()
    q(cur, "SET SESSION time_zone = '+00:00'")
    q(cur, "SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'")   # tolerate legacy zero dates while updating
    if q(cur, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s", (a.db, MARKER))[0][0]:
        sys.exit(f"{MARKER} exists: this database was already moved to UTC. Nothing done.")
    others = q(cur, "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB = %s AND ID <> CONNECTION_ID()", (a.db,))[0][0]

    shift, keep, date_only, empty, triggers = plan(cur, a.db)
    ncols = sum(len(v) for v in shift.values())
    print(f"Database {a.db}: shift {ncols} columns in {len(shift)} tables by -5:30; "
          f"{len(date_only)} date-only and {len(empty)} empty columns left as they are.")
    print(f"UPDATE triggers dropped and recreated: {', '.join(n for n, _ in triggers) or 'none'}")
    print(f"Other sessions on this database now: {others} (stop the API and workers first)")
    print("Date-only (not shifted): " + ", ".join(date_only))
    if not a.apply:
        print("\nDry run: nothing changed. Re-run with --apply.")
        return
    if others:
        sys.exit("Other sessions are connected to this database. Stop the API and workers, then run again.")

    # (name, sql_mode it was created with, CREATE statement)
    ddl = [(n, r[1], r[2]) for n, _ in triggers for r in [q(cur, f"SHOW CREATE TRIGGER `{n}`")[0]]]
    # DDL commits implicitly, so all of it happens outside the one data transaction below.
    q(cur, f"CREATE TABLE `{MARKER}` (moved_at DATETIME NOT NULL, columns_shifted INT NOT NULL)")
    for n, _, _ in ddl:
        q(cur, f"DROP TRIGGER `{n}`")
    ok = False
    try:
        for t, cs in shift.items():
            # Midnight values are dates (the API treats them so too): only values with a time of day move.
            sets = ", ".join(f"`{c}` = IF(`{c}` >= '1000-01-01' AND TIME(`{c}`) <> '00:00:00', `{c}` - {SHIFT}, `{c}`)" for c in cs)
            sets += "".join(f", `{c}` = `{c}`" for c in keep.get(t, []))
            cur.execute(f"UPDATE `{t}` SET {sets}")
            print(f"  {t}: {cur.rowcount} rows")
        cur.execute(f"INSERT INTO `{MARKER}` VALUES (UTC_TIMESTAMP(), %s)", (ncols,))
        conn.commit()
        ok = True
    except Exception:
        conn.rollback()
        raise
    finally:
        for n, mode, body in ddl:
            q(cur, "SET SESSION sql_mode = %s", (mode,))
            # Recreated without the DEFINER clause, so it runs as the user running this script.
            cur.execute("CREATE TRIGGER" + body.split("TRIGGER", 1)[1])
        if not ok:
            q(cur, f"DROP TABLE `{MARKER}`")   # the data was rolled back; allow a fresh run
        conn.commit()
    print(f"Done: {ncols} columns moved to UTC; {len(ddl)} triggers recreated.")


if __name__ == "__main__":
    main()
