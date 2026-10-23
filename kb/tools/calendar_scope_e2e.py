"""Mobile club and district calendars (birthdays, anniversaries, phones, emails) are limited to people who may read
that club or district (ROW security fix 2026-10-24, same rule as api/clubs/{id} reads).

    python -I kb/tools/calendar_scope_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Signs tokens for
existing members. Adds one district-admin role row and one AG row for the access checks and deletes them at the end.
Local copies only, never production.
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


def get(path, tok=None):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {tok}"} if tok else {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def check(name, path, tok, want):
    global fails
    status, body = get(path, tok)
    ok = status == want and (want != 200 or "birthdays" in (body or {}))
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {status}"))


# Clubs whose club, district and zone are active (the kill switch answers 403 otherwise).
FROM = ("club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id "
        "JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id")
LIVE = ("c.IsActive = 1 AND IFNULL(c.isdeleted, 0) = 0 AND d.IsActive = 1 AND IFNULL(d.isdeleted, 0) = 0 "
        "AND z.IsActive = 1 AND IFNULL(z.isdeleted, 0) = 0")
ELEVATED = "SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id <> 1 AND IsActive = 1 AND isdeleted = 0"

# A live club with a club Admin and a plain member (no role above Member anywhere), and the SuperAdmin.
club, district, admin, plain = [int(x) for x in sql(
    f"SELECT c.pk_club_id, c.fk_district_id, r.fk_member_master_profile_id, cm.fk_member_master_profile_id FROM {FROM} "
    "JOIN member_roles r ON r.fk_club_id = c.pk_club_id AND r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0 "
    "JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 "
    f"WHERE {LIVE} AND cm.fk_member_master_profile_id NOT IN ({ELEVATED}) ORDER BY 1, 4 LIMIT 1").split()]
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1"))
# A live club in a district where neither test member has a membership or a role.
mine = (f"SELECT IFNULL(c2.fk_district_id, 0) FROM club_members cm JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id "
        f"WHERE cm.fk_member_master_profile_id IN ({plain}, {admin}) "
        f"UNION SELECT IFNULL(fk_district_id, 0) FROM member_roles WHERE fk_member_master_profile_id IN ({plain}, {admin}) "
        f"UNION SELECT IFNULL(c3.fk_district_id, 0) FROM member_roles r3 JOIN club_master c3 ON c3.pk_club_id = r3.fk_club_id "
        f"WHERE r3.fk_member_master_profile_id IN ({plain}, {admin})")
other, other_district = [int(x) for x in sql(
    f"SELECT c.pk_club_id, c.fk_district_id FROM {FROM} WHERE {LIVE} AND c.fk_district_id NOT IN ({mine}) "
    "ORDER BY 1 LIMIT 1").split()]
t_plain, t_admin, t_sa = token(plain, "Member"), token(admin, "Admin"), token(sa, "SuperAdmin")

club_cal = lambda c: f"/api/mobile/club-calendar/{c}?month=1&year=2026"
district_cal = lambda d: f"/api/mobile/district-calendar/{d}?month=1&year=2026"

check("signed-out caller is refused", club_cal(club), None, 401)
check("member reads own club calendar", club_cal(club), t_plain, 200)
check("member cannot read another club's calendar", club_cal(other), t_plain, 403)
check("club admin reads own club calendar", club_cal(club), t_admin, 200)
check("club admin cannot read another club's calendar", club_cal(other), t_admin, 403)
check("SuperAdmin reads any club calendar", club_cal(other), t_sa, 200)
check("member reads own district calendar", district_cal(district), t_plain, 200)
check("member cannot read another district's calendar", district_cal(other_district), t_plain, 403)
check("SuperAdmin reads any district calendar", district_cal(other_district), t_sa, 200)

# Managers outside the club: a district admin of the other district, and an AG of the other club (rows removed after).
role_id = ag_id = None
try:
    role_id = sql("INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, AllClubsAccess, IsActive, isdeleted) "
                  f"VALUES ({plain}, 2, {other_district}, 1, 1, 0); SELECT LAST_INSERT_ID();")
    ag_id = sql("INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, is_active, isdeleted) "
                f"VALUES ({other_district}, {admin}, {other}, NULL, 1, 0); SELECT LAST_INSERT_ID();")
    check("district admin reads a club calendar of the district", club_cal(other), t_plain, 200)
    check("district admin reads the district calendar", district_cal(other_district), t_plain, 200)
    check("AG reads the calendar of a club assigned to them", club_cal(other), t_admin, 200)
finally:
    if role_id:
        sql(f"DELETE FROM member_roles WHERE pk_member_role_id = {int(role_id)}")
    if ag_id:
        sql(f"DELETE FROM district_ag WHERE id = {int(ag_id)}")
check("role removed: access ends", club_cal(other), t_plain, 403)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
