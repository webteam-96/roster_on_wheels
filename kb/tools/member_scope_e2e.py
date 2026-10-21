"""Member edits and district-modules writes are scoped (2026-10-21).

    python kb/tools/member_scope_e2e.py [api_base] [mysql_port]
Dev database only. Gives samuel.tubman@monrovia.demo (club admin of the first demo club) a random password through
the normal reset flow, then checks that he can edit a member of his club but not a member of another club, and
that he cannot change district citation settings. Nothing is written to a record: refused calls stop before saving,
and the allowed edit sends the member's own values back.
"""
import json
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PORT = sys.argv[2] if len(sys.argv) > 2 else "3317"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
ADMIN = "samuel.tubman@monrovia.demo"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", "row_local", "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
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


mid = int(sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId='{ADMIN}' AND isdeleted=0"))
club = int(sql(f"SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={mid} AND fk_role_id=2 AND IsActive=1 AND isdeleted=0 AND fk_club_id>0 LIMIT 1"))
district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}"))
own = sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND cm.IsActive=1 AND cm.isdeleted=0 "
          f"AND cm.fk_member_master_profile_id<>{mid} LIMIT 1")
other = sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.IsActive=1 AND cm.isdeleted=0 AND cm.fk_member_master_profile_id<>{mid} "
            f"AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club} AND IsActive=1 AND isdeleted=0) LIMIT 1")

password = "Row-" + secrets.token_urlsafe(12) + "9a"
call("POST", "/api/mobile/auth/forgot-password", {"email": ADMIN})
tok = sql(f"SELECT Token FROM password_reset_tokens WHERE fk_member_master_profile_id={mid} ORDER BY created_date DESC LIMIT 1")
call("POST", "/api/auth/reset-password", {"token": tok, "newPassword": password, "confirmPassword": password})
admin = call("POST", "/api/auth/login", {"email": ADMIN, "password": password})[1].get("token", "")
check("the club admin signs in", bool(admin))

if own:
    s, m = call("GET", f"/api/members/{own}", token=admin)
    s, b = call("PUT", f"/api/members/{own}", m, admin)
    check("a club admin edits a member of their club", s != 403, (s, b))
if other:
    s, m = call("GET", f"/api/members/{other}", token=admin)
    s, b = call("PUT", f"/api/members/{other}", m, admin)
    check("a club admin cannot edit a member of another club", s == 403, (s, b))
s, b = call("POST", f"/api/district-modules/{district}/citation/categories", {"categoryName": "e2e"}, admin)
check("a club admin cannot change district citation settings", s == 403, (s, b))

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
