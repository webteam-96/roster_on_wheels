"""Club / district reads are limited to that club's or district's members and managers (ROW security fix 2026-10-22).

    python -I kb/tools/scope_read_guard_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Read-only: it signs
tokens for existing members and writes nothing. Local copies only, never production.
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


def get(path, tok):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


# Two clubs in different districts, a plain member and a club admin of the first, and the SuperAdmin.
club, district = [int(x) for x in sql(
    "SELECT c.pk_club_id, c.fk_district_id FROM club_master c JOIN member_roles r ON r.fk_club_id=c.pk_club_id "
    "AND r.fk_role_id=2 AND r.IsActive=1 ORDER BY 1 LIMIT 1").split()]
other, other_district = [int(x) for x in sql(
    f"SELECT pk_club_id, fk_district_id FROM club_master WHERE fk_district_id<>{district} AND IFNULL(isdeleted,0)=0 "
    "ORDER BY 1 LIMIT 1").split()]
admin = int(sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={club} AND fk_role_id=2 AND IsActive=1 LIMIT 1"))
plain = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND cm.IsActive=1 "
                "AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles "
                "WHERE fk_role_id<>1 AND IsActive=1) LIMIT 1"))
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 LIMIT 1"))
t_plain, t_admin, t_sa = token(plain, "Member"), token(admin, "Admin"), token(sa, "SuperAdmin")

own, foreign = f"/api/clubs/{club}/attendance/members", f"/api/clubs/{other}/attendance/members"
check("member reads own club", get(own, t_plain) == 200, get(own, t_plain))
check("member cannot read another club", get(foreign, t_plain) == 403, get(foreign, t_plain))
check("club admin cannot read another club", get(foreign, t_admin) == 403, get(foreign, t_admin))
check("SuperAdmin reads any club", get(foreign, t_sa) == 200, get(foreign, t_sa))

own_d, foreign_d = f"/api/districts/{district}/district-events", f"/api/districts/{other_district}/district-events"
check("member reads own district", get(own_d, t_plain) == 200, get(own_d, t_plain))
check("member cannot read another district", get(foreign_d, t_plain) == 403, get(foreign_d, t_plain))
check("SuperAdmin reads any district", get(foreign_d, t_sa) == 200, get(foreign_d, t_sa))

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
