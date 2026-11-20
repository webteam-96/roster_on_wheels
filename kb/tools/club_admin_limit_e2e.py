"""Club admin limit (owner decision 2026-11-19): a club has at most N active Club Admins (system_settings
'ClubAdminMaxPerClub', default 3; SuperAdmins and district roles not counted). A grant past the limit is refused with
409 on every API path: Club Admin "Make admin" (assign-role, also used by the app), Club Leadership save and
Make Admin (SuperAdmin), and executive sign-in. The SuperAdmin report lists clubs already over the limit.

    python -I kb/tools/club_admin_limit_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). No email is sent:
every refused path is refused before any mail, and the one allowed grant (assign-role) sends none. Writes test rows
to the given LOCAL database only and removes them at the end (admin roles and admin years made for the test members,
one RI officer row, sign-in codes, the setting row if it did not exist). audit_log rows stay (append-only).
Needs club 341 (club admin 1068) to have fewer than 3 counted admins; the script fills it to exactly 3.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request, datetime

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(v) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        payload, status = e.read(), e.code
    try:
        return status, json.loads(payload) if payload else None
    except ValueError:
        return status, payload.decode(errors="replace")


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def msg(r):
    return r[1].get("message", "") if isinstance(r[1], dict) else str(r[1])


COUNTED = ("mr.fk_role_id=2 AND mr.fk_club_id={c} AND mr.IsActive=1 AND mr.isdeleted=0 AND NOT EXISTS (SELECT 1 FROM "
           "member_roles s WHERE s.fk_member_master_profile_id=mr.fk_member_master_profile_id AND s.fk_role_id=3 "
           "AND s.IsActive=1 AND s.isdeleted=0)")


def admins(c):
    return one(f"SELECT COUNT(DISTINCT mr.fk_member_master_profile_id) FROM member_roles mr WHERE {COUNTED.format(c=c)}")


def admin_rows(m):
    return one(f"SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id={m} AND fk_role_id=2 AND isdeleted=0")


# ── People and places ────────────────────────────────────────────────────────────────────────────────────────
CLUB, CLUB_ADMIN = 341, 1068  # Colombo West
district = one(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}")
sa = one("SELECT mr.fk_member_master_profile_id FROM member_roles mr WHERE mr.fk_role_id=3 AND mr.IsActive=1 "
         "AND mr.isdeleted=0 ORDER BY mr.fk_member_master_profile_id LIMIT 1")
year = one("SELECT pk_year_id FROM rotary_year_master WHERE CURDATE() BETWEEN StartDate AND EndDate AND IFNULL(isdeleted,0)=0 LIMIT 1")
before = admins(CLUB)
need = 3 - (before or 0)
# Plain members of the club only: a unique email, a numeric RotaryId, never an Admin / SuperAdmin / AG, one club.
cands = [int(x) for x in sql(f"""
    SELECT m.pk_member_master_profile_id FROM club_members cm
    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
    WHERE cm.fk_club_id = {CLUB} AND cm.IsActive = 1 AND IFNULL(cm.isdeleted,0) = 0
      AND m.EmailId LIKE '%@%' AND m.RotaryId REGEXP '^[0-9]+$'
      AND (SELECT COUNT(*) FROM member_master_profile x WHERE x.EmailId = m.EmailId AND x.isdeleted = 0) = 1
      AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND r.fk_role_id IN (2, 3, 6))
      AND (SELECT COUNT(*) FROM club_members o WHERE o.fk_member_master_profile_id = m.pk_member_master_profile_id
           AND IFNULL(o.isdeleted,0) = 0) = 1
    ORDER BY m.pk_member_master_profile_id LIMIT {max(need, 0) + 1}""").split()]
assert before is not None and 1 <= need <= 2 and len(cands) == need + 1, f"club {CLUB} has {before} admins; need 1-2 below 3"
fillers, fourth = cands[:-1], cands[-1]
everyone = ",".join(str(x) for x in cands)
email4 = sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={fourth}")
ri4 = sql(f"SELECT RotaryId FROM member_master_profile WHERE pk_member_master_profile_id={fourth}")
free_year = one(f"""SELECT y.pk_year_id FROM rotary_year_master y WHERE IFNULL(y.isdeleted,0)=0 AND NOT EXISTS (
    SELECT 1 FROM board_of_directors b JOIN designation_master d ON d.pk_designation_id=b.fk_designation_id
    WHERE b.fk_club_id={CLUB} AND b.fk_year_id=y.pk_year_id AND b.isdeleted=0
      AND d.designation_name IN ('Club President','Club Secretary'))
    ORDER BY y.StartDate DESC LIMIT 1""")
SA, CA = token(sa, "SuperAdmin"), token(CLUB_ADMIN, "Admin")
print(f"club {CLUB} ({before} admins), district {district}, SuperAdmin {sa}, fillers {fillers}, fourth {fourth}, "
      f"year {year}, free year {free_year}")

role_pk = one("SELECT IFNULL(MAX(pk_member_role_id),0) FROM member_roles")
years_pk = one("SELECT IFNULL(MAX(pk_member_admin_year_id),0) FROM member_admin_years")
bod_pk = one("SELECT IFNULL(MAX(pk_board_director_id),0) FROM board_of_directors")
setting_before = sql("SELECT SettingValue FROM system_settings WHERE SettingKey='ClubAdminMaxPerClub'") or None
today = datetime.date.today()
ry_start = datetime.date(today.year if today.month >= 7 else today.year - 1, 7, 1)


def cleanup():
    sql(f"DELETE FROM member_roles WHERE pk_member_role_id > {role_pk} AND fk_member_master_profile_id IN ({everyone})")
    sql(f"DELETE FROM member_admin_years WHERE pk_member_admin_year_id > {years_pk} AND fk_member_master_profile_id IN ({everyone})")
    sql(f"DELETE FROM board_of_directors WHERE pk_board_director_id > {bod_pk} AND fk_member_master_profile_id = {fourth}")
    sql(f"DELETE FROM ri_club_officers WHERE fk_club_id={CLUB} AND ri_member_id={ri4} AND first_name='E2E'")
    sql(f"DELETE FROM exec_signin_codes WHERE fk_member_id={fourth}")
    if setting_before is None:
        sql("DELETE FROM system_settings WHERE SettingKey='ClubAdminMaxPerClub'")
    else:
        sql(f"UPDATE system_settings SET SettingValue='{setting_before}' WHERE SettingKey='ClubAdminMaxPerClub'")


try:
    # Setting: SuperAdmin only, validated, default 3
    check("setting: a club admin may not read it", call("GET", "/api/admin/club-admin-limit", CA)[0] == 403)
    check("setting: a club admin may not change it", call("PUT", "/api/admin/club-admin-limit", CA, {"max": 9})[0] == 403)
    st, s = call("GET", "/api/admin/club-admin-limit", SA)
    check("setting: the limit is 3 by default", st == 200 and s["max"] == 3 and s["defaultMax"] == 3, s)
    check("setting: 0 is refused", call("PUT", "/api/admin/club-admin-limit", SA, {"max": 0})[0] == 400)
    check("setting: 51 is refused", call("PUT", "/api/admin/club-admin-limit", SA, {"max": 51})[0] == 400)
    st, s = call("PUT", "/api/admin/club-admin-limit", SA, {"max": 3})
    check("setting: SuperAdmin saves 3", st == 200 and s["max"] == 3, s)

    # Fill the club to exactly 3 in SQL (the API grant would also make credentials and send a welcome email).
    for m in fillers:
        sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted, AssignedBy, "
            f"created_by, created_date) VALUES ({m}, 2, {CLUB}, 1, 0, 0, 0, NOW())")
    check("setup: the club now has 3 admins", admins(CLUB) == 3, admins(CLUB))

    # 1. Club admin "Make admin" (web directory and the app's members screens use this endpoint)
    st, r = call("POST", "/api/admin/assign-role", CA, {"memberId": fourth, "roleId": 2, "clubId": CLUB})
    check("assign-role: the 4th grant is refused with 409 and a clear message",
          st == 409 and "3 active Club Admins" in msg((st, r)), (st, r))
    check("assign-role: no role row was written", admin_rows(fourth) == 0)

    # 2. Club Leadership save (SuperAdmin): the board row is rolled back with the refused grant
    if free_year:
        st, r = call("POST", "/api/admin/club-leadership", SA, {"clubId": CLUB, "yearId": free_year, "memberId": fourth, "role": "Secretary"})
        check("club-leadership save: the 4th grant is refused with 409", st == 409 and "Club Admins" in msg((st, r)), (st, r))
        check("club-leadership save: the board row was rolled back",
              one(f"SELECT COUNT(*) FROM board_of_directors WHERE pk_board_director_id > {bod_pk} AND fk_member_master_profile_id={fourth}") == 0)
    else:
        check("club-leadership save: a year with no president or secretary to test on", False, "none found")

    # 3. Club Leadership Make Admin (SuperAdmin)
    st, r = call("POST", "/api/admin/club-leadership/make-admin", SA,
                 {"clubId": CLUB, "yearId": year, "districtId": district, "memberId": fourth, "role": "President"})
    check("club-leadership make-admin: the 4th grant is refused with 409", st == 409 and "Club Admins" in msg((st, r)), (st, r))

    # 4. Executive sign-in: a current RI officer of the club with a valid code gets no Admin seat
    sql(f"INSERT INTO ri_club_officers (fk_club_id, ri_member_id, officer_role, start_date, end_date, first_name, last_name) "
        f"VALUES ({CLUB}, {ri4}, 'Club Secretary', '{ry_start}', '{datetime.date(ry_start.year + 1, 6, 30)}', 'E2E', 'Secretary')")
    code = "424242"
    sql(f"INSERT INTO exec_signin_codes (fk_member_id, code_hash, expires_at) VALUES ({fourth}, "
        f"'{hashlib.sha256(f'{fourth}:{code}'.encode()).hexdigest()}', UTC_TIMESTAMP() + INTERVAL 10 MINUTE)")
    st, r = call("POST", "/api/auth/exec-code/verify", None, {"email": email4, "code": code})
    check("exec sign-in: the 4th seat is refused with 409", st == 409 and "Club Admins" in msg((st, r)), (st, r))

    check("after every path: still 3 admins, the 4th member holds no Admin role", admins(CLUB) == 3 and admin_rows(fourth) == 0)

    # 5. Report: clubs over the limit, left unchanged
    over = int(sql("SELECT COUNT(*) FROM (SELECT mr.fk_club_id FROM member_roles mr WHERE mr.fk_club_id>0 AND "
                   + COUNTED.format(c="mr.fk_club_id")
                   + " GROUP BY mr.fk_club_id HAVING COUNT(DISTINCT mr.fk_member_master_profile_id) > 3) t"))
    check("report: a club admin may not read it", call("GET", "/api/admin/club-admin-limit/report", CA)[0] == 403)
    st, rep = call("GET", "/api/admin/club-admin-limit/report", SA)
    ok = st == 200 and rep["max"] == 3 and len(rep["clubs"]) == over
    check(f"report: lists the {over} club(s) over the limit", ok, (st, str(rep)[:200]))
    if ok and rep["clubs"]:
        c = rep["clubs"][0]
        check("report: each club has its count, the admins' names and its district",
              c["adminCount"] > 3 and len(c["admins"]) == c["adminCount"] and all(a["name"] for a in c["admins"])
              and "districtNumber" in c, c)
    check(f"report: club {CLUB} (at the limit, not over) is not listed", ok and all(x["clubId"] != CLUB for x in rep["clubs"]))
    # Lowering the limit puts club 341 on the report; its admins stay.
    call("PUT", "/api/admin/club-admin-limit", SA, {"max": 2})
    st, rep = call("GET", "/api/admin/club-admin-limit/report", SA)
    check("report: at limit 2 club 341 is listed with its 3 admins, and nothing is revoked",
          st == 200 and any(x["clubId"] == CLUB and x["adminCount"] == 3 for x in rep["clubs"]) and admins(CLUB) == 3,
          str(rep)[:300])
finally:
    cleanup()
    check(f"cleanup: club {CLUB} is back to {before} admins", admins(CLUB) == before, admins(CLUB))

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
