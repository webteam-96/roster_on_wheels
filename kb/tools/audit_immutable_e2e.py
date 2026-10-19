"""audit_log is append-only (ROW Wave 1, task 1), and privacy erasure still anonymises it.

    python kb/tools/audit_immutable_e2e.py [api_base] [mysql_port]
Dev database only: each run creates and erases its own throwaway member (demo members are left alone).
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PORT = sys.argv[2] if len(sys.argv) > 2 else "3317"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q, ok=True):
    r = subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", "row_local", "-N", "-e", q], capture_output=True, text=True)
    if ok and r.returncode:
        raise RuntimeError(r.stderr)
    return r.returncode, (r.stdout + r.stderr).strip()


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


sql("INSERT INTO audit_log (fk_member_master_profile_id, member_name, action, entity_type, details, ip_address) VALUES (NULL, 'e2e', 'E2E', 'e2e', 'row', '10.0.0.1')")
_, rid = sql("SELECT MAX(pk_audit_id) FROM audit_log WHERE action='E2E'")

code, out = sql(f"UPDATE audit_log SET action='TAMPER' WHERE pk_audit_id={rid}", ok=False)
check("changing an audit row is refused", code != 0 and "append-only" in out, out)
code, out = sql(f"DELETE FROM audit_log WHERE pk_audit_id={rid}", ok=False)
check("deleting an audit row is refused", code != 0 and "append-only" in out, out)
code, out = sql(f"UPDATE audit_log SET member_name=NULL, ip_address=NULL WHERE pk_audit_id={rid}", ok=False)
check("anonymising name and IP is allowed (erasure)", code == 0, out)

s, b = call("POST", "/api/auth/login", {"email": "naren@kaizeninfotech.com", "password": "Admin@123"})
token = b.get("token", "")
_, mid = sql("INSERT INTO member_master_profile (MemberName, EmailId) VALUES ('E2E Erase Me', CONCAT('e2e.erase.', UUID_SHORT(), '@example.invalid')); SELECT LAST_INSERT_ID()")
if mid:
    sql(f"INSERT INTO audit_log (fk_member_master_profile_id, member_name, action, entity_type, ip_address) VALUES ({mid}, 'Emmanuel Kollie', 'E2E', 'member', '10.0.0.2')")
    s, b = call("POST", f"/api/privacy/members/{mid}/erase", {"reason": "e2e: audit immutability"}, token)
    check("privacy erasure still completes", s == 200 and b.get("status") == "completed", (s, b))
    _, left = sql(f"SELECT COUNT(*) FROM audit_log WHERE fk_member_master_profile_id={mid} AND member_name IS NOT NULL")
    check("erasure anonymised the member's audit rows", left == "0", left)
else:
    print("SKIP erasure checks: demo member already erased")

print(f"\n{fails} failed")
sys.exit(1 if fails else 0)
