"""Three write guards added 2026-10-23: a member registers only their own push device token; only a SuperAdmin
changes the module masters; club id 0 is no club, so a district Admin row (fk_club_id = 0) does not pass club writes.

    python -I kb/tools/security_guards_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret). Local copies only, never production. It adds one
temporary district Admin role row and removes it at the end.
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


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


a, b = [int(x) for x in sql("SELECT pk_member_master_profile_id FROM member_master_profile "
                             "WHERE IFNULL(isdeleted,0)=0 ORDER BY pk_member_master_profile_id LIMIT 2").split()]
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 LIMIT 1"))
district = int(sql("SELECT pk_district_id FROM district_master WHERE IFNULL(isdeleted,0)=0 LIMIT 1"))
saved = sql(f"SELECT IFNULL(LastDeviceToken,'') FROM member_master_profile WHERE pk_member_master_profile_id = {b}")
role_id = None
try:
    # 1. device token: only the member themself (or a SuperAdmin)
    s = call("POST", f"/api/members/{b}/device-token", token(a, ["Member"]), {"deviceToken": "e2e-hijack"})
    check("another member's device token is refused", s == 403, s)
    check("the token was not changed", sql(f"SELECT IFNULL(LastDeviceToken,'') FROM member_master_profile "
                                          f"WHERE pk_member_master_profile_id = {b}") == saved)
    s = call("POST", f"/api/members/{a}/device-token", token(a, ["Member"]), {"deviceToken": None})
    check("own device token still accepted", s == 200, s)

    # 2. module masters: SuperAdmin only
    for method, path in [("POST", "/api/module-categories"), ("PUT", "/api/module-categories/1"),
                         ("DELETE", "/api/module-categories/999999"), ("POST", "/api/modules"),
                         ("PUT", "/api/modules/1"), ("DELETE", "/api/modules/999999")]:
        s = call(method, path, token(a, ["Member", "Admin"]), {})
        check(f"{method} {path} refused for a non-SuperAdmin", s == 403, s)
    s = call("DELETE", "/api/modules/999999", token(sa, ["SuperAdmin"]))
    check("SuperAdmin passes the guard (unknown id is not a 403)", s != 403, s)

    # 3. club id 0: a district Admin row has fk_club_id = 0 and must not open /api/clubs/0 writes
    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, fk_club_id, IsActive) "
        f"VALUES ({a}, 2, {district}, 0, 1)")
    role_id = sql("SELECT LAST_INSERT_ID()")
    s = call("POST", "/api/clubs/0/announcements", token(a, ["Admin"]), {})
    check("a district Admin cannot write to club 0", s == 403, s)
    s = call("PUT", f"/api/districts/{district}/settings-e2e-probe", token(a, ["Admin"]), {})
    check("the same district Admin still passes the district write guard", s != 403, s)
finally:
    if role_id:
        try:
            sql(f"DELETE FROM member_roles WHERE pk_member_role_id = {role_id}")
        except subprocess.CalledProcessError:  # a hard-delete trigger: retire the row instead
            sql(f"UPDATE member_roles SET IsActive = 0, isdeleted = 1 WHERE pk_member_role_id = {role_id}")
    sql(f"UPDATE member_master_profile SET LastDeviceToken = NULLIF('{saved}', '') WHERE pk_member_master_profile_id = {b}")

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
