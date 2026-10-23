"""Club / district writes are limited to people who manage that club or district (ROW security fix 2026-10-19).

    python kb/tools/scope_write_guard_e2e.py [api_base] [mysql_port]
Dev database only: makes samuel.tubman@monrovia.demo a club admin of the first demo club and gives him a password.
"""
import json
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


club, other = [int(x) for x in sql("SELECT pk_club_id FROM club_master WHERE isdeleted=0 ORDER BY 1 LIMIT 2").split()]
district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}"))
mid = sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId='{ADMIN}'")
sql(f"UPDATE member_roles SET IsActive=0 WHERE fk_member_master_profile_id={mid} AND fk_role_id=2")
sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, AssignedBy) VALUES ({mid}, 2, {club}, {mid})")
call("POST", "/api/mobile/auth/forgot-password", {"email": ADMIN})
tok = sql(f"SELECT Token FROM password_reset_tokens WHERE fk_member_master_profile_id={mid} ORDER BY 1 DESC LIMIT 1")
call("POST", "/api/auth/reset-password", {"token": tok, "newPassword": "RowAdmin#2026", "confirmPassword": "RowAdmin#2026"})

admin = call("POST", "/api/auth/login", {"email": ADMIN, "password": "RowAdmin#2026"})[1].get("token", "")
member = call("POST", "/api/mobile/auth/login", {"email": "grace.johnson@monrovia.demo", "password": "RowDemo@2026"})[1].get("token", "")
sa = call("POST", "/api/auth/login", {"email": "naren@kaizeninfotech.com", "password": "Admin@123"})[1].get("token", "")
check("test accounts signed in", admin and member and sa, (bool(admin), bool(member), bool(sa)))

meeting = {"eventName": "guard e2e", "description": "x", "eventDateTime": "2026-10-22T18:00:00", "memberIds": []}
s, b = call("POST", f"/api/clubs/{club}/attendance", meeting, member)
check("a plain member cannot write club records", s == 403, (s, b))
s, b = call("POST", f"/api/clubs/{club}/attendance", meeting, admin)
check("the club's admin can", s == 200, (s, b))
own = b.get("id")
s, b = call("POST", f"/api/clubs/{other}/attendance", meeting, admin)
check("a club admin cannot write another club", s == 403, (s, b))
s, b = call("POST", f"/api/clubs/{other}/attendance", meeting, sa)
check("SuperAdmin can write any club", s == 200, (s, b))
sa_id = b.get("id")
s, b = call("PUT", f"/api/districts/{district}/weblinks/999999", {"title": "x"}, admin)
check("a club admin cannot write district records", s == 403, (s, b))
s, b = call("GET", f"/api/clubs/{other}/attendance?yearId=0", token=member)
check("reads are not affected", s == 200, (s, b))
s, b = call("POST", f"/api/clubs/{club}/attendance", meeting)
check("no token still gets 401", s == 401, (s, b))

s, b = call("PUT", "/api/area-of-focus/reorder", {}, member)
check("a plain member cannot change master data", s == 403, (s, b))
s, b = call("PUT", "/api/area-of-focus/reorder", {}, admin)
check("a club admin cannot change master data", s == 403, (s, b))
s, b = call("PUT", "/api/area-of-focus/reorder", {}, sa)
check("SuperAdmin passes the guard on master data", s != 403, (s, b))
s, b = call("POST", "/api/mass-email/image", {}, member)
check("a plain member cannot upload mass-email media", s == 403, (s, b))
s, b = call("POST", "/api/mass-email/image", {}, admin)
check("a club admin passes the guard for mass-email media", s != 403, (s, b))

for cid, aid, t in [(club, own, admin), (other, sa_id, sa)]:
    if aid:
        call("DELETE", f"/api/clubs/{cid}/attendance/{aid}", token=t)
print(f"\n{fails} failed")
sys.exit(1 if fails else 0)
