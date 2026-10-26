"""Which tables does the code create that the production database does not have yet? Read-only.

    python -I kb/tools/prod_schema_catchup.py [local_port] [local_db]
Compares the tables in row_prod_copy (built by the API's DatabaseInitializer, so it has everything the code needs)
with production's. Production details come from row/.env (PROD_DB_*, ROW_PROD_DB_PASSWORD) and are never printed.
It only runs SELECTs on information_schema; nothing is written anywhere. The API's start with
Database__SkipInit=false adds the missing tables on the next deploy.
"""
import pathlib, subprocess, sys

MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
local_port = sys.argv[1] if len(sys.argv) > 1 else "3317"
local_db = sys.argv[2] if len(sys.argv) > 2 else "row_prod_copy"
env = {}
for line in (pathlib.Path(__file__).resolve().parents[2] / "row" / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

Q = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"


def tables(args, password):
    run = subprocess.run([MYSQL, *args, "-N", "-e", Q], capture_output=True, text=True,
                         env={"MYSQL_PWD": password, "SYSTEMROOT": "C:\\Windows"}, timeout=60)
    if run.returncode != 0:
        sys.exit("query failed: " + run.stderr.strip().splitlines()[-1][:200])
    return {t.strip().lower() for t in run.stdout.split()}


local = tables(["-uroot", "-h127.0.0.1", f"-P{local_port}", local_db], "")
prod = tables([f"-u{env['PROD_DB_USER']}", f"-h{env['PROD_DB_HOST']}", f"-P{env['PROD_DB_PORT']}", env["PROD_DB_NAME"]],
              env["ROW_PROD_DB_PASSWORD"])
missing, extra = sorted(local - prod), sorted(prod - local)
print(f"code / local copy: {len(local)} tables, production: {len(prod)} tables")
print(f"missing on production ({len(missing)}):", ", ".join(missing) or "none")
print(f"on production only ({len(extra)}):", ", ".join(extra) or "none")
