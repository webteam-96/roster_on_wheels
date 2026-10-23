"""audit_log is append-only (ROW Wave 1, task 1), and privacy erasure still anonymises it.

    python -I kb/tools/audit_immutable_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret); the SuperAdmin is
picked by query. Local copies only, never production. Each run creates and erases its own throwaway member (real
members are left alone). What stays: the 'E2E' audit rows (audit_log is append-only by design) and the erased,
soft-deleted throwaway member (hard deletes of members are refused by a trigger); its privacy request and change-log
rows are removed.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q, ok=True):
    r = subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q], capture_output=True, text=True)
    if ok and r.returncode:
        raise RuntimeError(r.stderr)
    return r.returncode, (r.stdout + r.stderr).strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


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

sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")[1])
_, mid = sql("INSERT INTO member_master_profile (MemberName, EmailId) VALUES ('E2E Erase Me', CONCAT('e2e.erase.', UUID_SHORT(), '@example.invalid')); SELECT LAST_INSERT_ID()")
try:
    sql(f"INSERT INTO audit_log (fk_member_master_profile_id, member_name, action, entity_type, ip_address) VALUES ({mid}, 'E2E Erase Me', 'E2E', 'member', '10.0.0.2')")
    s, b = call("POST", f"/api/privacy/members/{mid}/erase", {"reason": "e2e: audit immutability"}, token(sa, "SuperAdmin"))
    check("privacy erasure still completes", s == 200 and b.get("status") == "completed", (s, b))
    _, left = sql(f"SELECT COUNT(*) FROM audit_log WHERE fk_member_master_profile_id={mid} AND member_name IS NOT NULL")
    check("erasure anonymised the member's audit rows", left == "0", left)
finally:
    sql(f"DELETE FROM privacy_requests WHERE fk_member_id={mid}; DELETE FROM member_change_log WHERE fk_member_master_profile_id={mid}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
