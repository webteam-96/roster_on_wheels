"""Smoke suite: runs every kb/tools/*_e2e.py against one API and database and prints one line per script.

    python -I kb/tools/smoke_all.py <api_base> <mysql_port> <database> [name-filter]
JWT secret from ROW_E2E_JWT_SECRET, as the scripts need. Local copies only, never production. Exit code 1 when any
script fails, so it can gate a deploy. Each script cleans up after itself; they run one at a time because several
switch platform features on and off.

Start the API for a full run with (2026-10-26, all 31 PASS):
    JwtSettings__Secret=$ROW_E2E_JWT_SECRET  VolunteerReminders__Enabled=true
    Brevo__ApiUrl=http://127.0.0.1:5198/v3/smtp/email  Brevo__ApiKey=<anything>  Brevo__WebhookSecret=<x>
    Comms__DnsServers__0=127.0.0.1:5397  Api__BaseUrl=http://127.0.0.1:5000
and ROW_E2E_BREVO_WEBHOOK_SECRET=<x> here. Brevo and DNS are fake servers the communication script starts, so no
email leaves the machine.
"""
import pathlib, subprocess, sys, time

api, port, db = sys.argv[1], sys.argv[2], sys.argv[3]
only = sys.argv[4] if len(sys.argv) > 4 else ""
here = pathlib.Path(__file__).resolve().parent
failed = []
start = time.time()
for script in sorted(here.glob("*_e2e.py")):
    if only not in script.name:
        continue
    t = time.time()
    try:
        run = subprocess.run([sys.executable, "-I", str(script), api, port, db],
                             capture_output=True, text=True, timeout=900)
        out = (run.stdout + run.stderr).strip().splitlines()
        ok = run.returncode == 0
        last = out[-1] if out else "(no output)"
        fails = [line for line in out if line.startswith("FAIL")]
    except subprocess.TimeoutExpired:
        ok, last, fails = False, "timed out after 15 minutes", []
    print(f"{'PASS' if ok else 'FAIL'}  {script.name:40} {time.time() - t:6.1f}s  {last[:90]}", flush=True)
    for line in fails[:5]:
        print(f"        {line[:150]}")
    if not ok:
        failed.append(script.name)

print(f"\n{'ALL PASS' if not failed else str(len(failed)) + ' FAILED: ' + ', '.join(failed)}"
      f"  ({time.time() - start:.0f}s)")
sys.exit(1 if failed else 0)
