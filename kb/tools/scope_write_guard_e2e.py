"""Club / district writes are limited to people who manage that club or district (ROW security fix 2026-10-19).

    python -I kb/tools/scope_write_guard_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). A club admin, a plain
member of the same club and the SuperAdmin are picked by query. Local copies only, never production. The two
attendance records it creates are deleted through the API and then removed for good.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def sign(member_id, roles):
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


admin_id, club = [int(x) for x in sql("SELECT fk_member_master_profile_id, fk_club_id FROM member_roles WHERE fk_role_id=2 AND IsActive=1 "
                                       "AND isdeleted=0 AND fk_club_id>0 ORDER BY 1 LIMIT 1").split()]
district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}"))
other = int(sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND pk_club_id NOT IN (SELECT fk_club_id FROM member_roles "
                f"WHERE fk_member_master_profile_id={admin_id} AND IsActive=1 AND isdeleted=0 AND fk_club_id IS NOT NULL) "
                f"AND pk_club_id NOT IN (SELECT fk_club_id FROM district_ag WHERE fk_member_id={admin_id} AND is_active=1 AND isdeleted=0) "
                "ORDER BY 1 LIMIT 1"))
member_id = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND cm.IsActive=1 "
                    "AND cm.isdeleted=0 AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles "
                    "WHERE fk_role_id<>1 AND IsActive=1 AND isdeleted=0) LIMIT 1"))
sa_id = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
admin, member, sa = sign(admin_id, "Admin"), sign(member_id, "Member"), sign(sa_id, "SuperAdmin")

meeting = {"eventName": "guard e2e", "description": "x", "eventDateTime": "2026-10-22T18:00:00", "memberIds": []}
own = sa_rec = None
try:
    s, b = call("POST", f"/api/clubs/{club}/attendance", meeting, member)
    check("a plain member cannot write club records", s == 403, (s, b))
    s, b = call("POST", f"/api/clubs/{club}/attendance", meeting, admin)
    check("the club's admin can", s == 200, (s, b))
    own = b.get("id")
    s, b = call("POST", f"/api/clubs/{other}/attendance", meeting, admin)
    check("a club admin cannot write another club", s == 403, (s, b))
    s, b = call("POST", f"/api/clubs/{other}/attendance", meeting, sa)
    check("SuperAdmin can write any club", s == 200, (s, b))
    sa_rec = b.get("id")
    s, b = call("PUT", f"/api/districts/{district}/weblinks/999999", {"title": "x"}, admin)
    check("a club admin cannot write district records", s == 403, (s, b))
    s, b = call("GET", f"/api/clubs/{club}/attendance?yearId=0", token=member)
    check("reads of the member's own club are not affected", s == 200, (s, b))
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
finally:
    for cid, aid, t in [(club, own, admin), (other, sa_rec, sa)]:
        if aid:  # the API only soft-deletes; the test rows go for good
            call("DELETE", f"/api/clubs/{cid}/attendance/{aid}", token=t)
            sql(f"DELETE FROM club_attendance WHERE pk_attendance_id={int(aid)} AND fk_club_id={cid} AND EventName='guard e2e'")
print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
