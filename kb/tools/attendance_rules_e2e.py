"""Attendance rules: makeups (member logs, officer approves), leave, exemptions, standing (gap #5, 2026-11-19).

    python -I kb/tools/attendance_rules_e2e.py <api_base> <mysql_port> <database>

Environment: ROW_E2E_ADMIN_ID (club admin, default 1068), ROW_E2E_MEMBER_ID (ordinary member of the same club,
default 999), ROW_E2E_PASSWORD (both accounts' password in the local copy). When ROW_E2E_PASSWORD is not set, the
script puts a random password on both accounts for the second it takes to sign in, then puts their own hashes,
failed-login counts and last-login dates back. Local copies only, never production.

Adds two meetings to the admin's club in the current Rotary year and checks: a member's self-logged makeup waits
(not counted) until an officer approves it, then counts; a duplicate makeup for the same meeting is refused; a
member cannot approve, cannot see others' rows, cannot log into another club; a member withdraws only pending
makeups; leave and exemptions take meetings out of the count; settings validate; another club's admin and anonymous
callers are refused. Extras: closing a meeting locks its attendance and makeups until reopened (both audited);
member-type rules (honorary own figure only); every attendance read refuses a member of another club (same
district and other district) and answers the club's member and manager; the rule of 85 list, CSV and PDF; the sign-in sheet PDF. Every row it
adds is deleted at the end, except the audit_log rows of closing and reopening (audit_log is never erased).
"""
import json, os, secrets, subprocess, sys, urllib.error, urllib.request
from datetime import date, timedelta

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
ADMIN = int(os.environ.get('ROW_E2E_ADMIN_ID', '1068'))
MEMBER = int(os.environ.get('ROW_E2E_MEMBER_ID', '999'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, raw.decode(errors="replace")


def raw(path, token):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def email(member_id):
    return sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={member_id}")


def web_login(member_id, password):
    s, b = call("POST", "/api/auth/login", {"email": email(member_id), "password": password})
    return (b or {}).get("token") if s == 200 else None


def app_login(member_id, password):
    s, b = call("POST", "/api/mobile/auth/login", {"email": email(member_id), "password": password})
    return ((b or {}).get("token") or ((b or {}).get("data") or {}).get("token")) if s == 200 else None


club = int(sql(f"SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={ADMIN} AND fk_role_id=2 "
               "AND IsActive=1 AND isdeleted=0 AND fk_club_id>0 LIMIT 1"))
district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}"))
# Ordinary members (no role but Member) with a login: one of another club in the same district, one of another district.
plain = ("m.isdeleted=0 AND IFNULL(m.EmailId,'')<>'' AND cm.IsActive=1 AND cm.isdeleted=0 "
         "AND EXISTS(SELECT 1 FROM member_credentials k WHERE k.fk_member_master_profile_id=m.pk_member_master_profile_id AND k.IsActive=1) "
         "AND NOT EXISTS(SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id=m.pk_member_master_profile_id "
         "AND r.fk_role_id<>1 AND r.IsActive=1 AND r.isdeleted=0) "
         f"AND NOT EXISTS(SELECT 1 FROM club_members x WHERE x.fk_member_master_profile_id=m.pk_member_master_profile_id AND x.fk_club_id={club} AND x.isdeleted=0)")
# Same district: every login there belongs to a club officer, so allow roles that reach only their own club
# (no SuperAdmin, no district-level role, no AG assignment to this club).
near = plain.split(" AND NOT EXISTS(SELECT 1 FROM member_roles")[0] + (
    " AND NOT EXISTS(SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id=m.pk_member_master_profile_id AND r.IsActive=1 "
    "AND r.isdeleted=0 AND (r.fk_role_id NOT IN (1,2) OR (r.fk_role_id=2 AND IFNULL(r.fk_club_id,0) IN (0," + str(club) + "))))"
    " AND NOT EXISTS(SELECT 1 FROM district_ag g WHERE g.fk_member_id=m.pk_member_master_profile_id AND g.isdeleted=0)"
    f" AND NOT EXISTS(SELECT 1 FROM club_members x WHERE x.fk_member_master_profile_id=m.pk_member_master_profile_id AND x.fk_club_id={club} AND x.isdeleted=0)")
NEIGHBOUR = int(sql("SELECT m.pk_member_master_profile_id FROM member_master_profile m JOIN club_members cm ON cm.fk_member_master_profile_id="
                    f"m.pk_member_master_profile_id JOIN club_master c ON c.pk_club_id=cm.fk_club_id WHERE c.fk_district_id={district} AND {near} LIMIT 1") or 0)
OUTSIDER = int(sql("SELECT m.pk_member_master_profile_id FROM member_master_profile m JOIN club_members cm ON cm.fk_member_master_profile_id="
                   f"m.pk_member_master_profile_id JOIN club_master c ON c.pk_club_id=cm.fk_club_id WHERE c.fk_district_id<>{district} AND {plain} LIMIT 1"))

password = os.environ.get("ROW_E2E_PASSWORD")
# The neighbour and outsider never have a known password: they always get the temporary one.
temp_ids = [x for x in (NEIGHBOUR, OUTSIDER) if x] + ([] if password else [ADMIN, MEMBER])
import bcrypt  # temporary passwords
cols = ("PasswordHash, FailedLoginAttempts, IFNULL(LockoutEndTime,'NULL'), IFNULL(LastLoginDate,'NULL'), IsTemporaryPassword, "
        "IFNULL(modified_date,'NULL')")
saved = {m: sql(f"SELECT {cols} FROM member_credentials WHERE fk_member_master_profile_id={m}").split("\t") for m in temp_ids}
temp = secrets.token_urlsafe(16) + "a1A!"
hashed = bcrypt.hashpw(temp.encode(), bcrypt.gensalt(11)).decode()
pw = lambda m: temp if m in temp_ids else password
try:
    for m in temp_ids:
        sql(f"UPDATE member_credentials SET PasswordHash='{hashed}', IsTemporaryPassword=0 WHERE fk_member_master_profile_id={m}")
    admin_token, member_token = web_login(ADMIN, pw(ADMIN)), app_login(MEMBER, pw(MEMBER))
    neighbour_token = (app_login(NEIGHBOUR, temp) or web_login(NEIGHBOUR, temp)) if NEIGHBOUR else None
    outsider_token = app_login(OUTSIDER, temp)
finally:
    for m, (h, f, l, d, t, md) in saved.items():
        lv = "NULL" if l == "NULL" else f"'{l}'"
        dv = "NULL" if d == "NULL" else f"'{d}'"
        sql(f"UPDATE member_credentials SET PasswordHash='{h}', FailedLoginAttempts={f}, LockoutEndTime={lv}, "
            f"LastLoginDate={dv}, IsTemporaryPassword={t}, modified_date={'NULL' if md == 'NULL' else repr(md)} "
            f"WHERE fk_member_master_profile_id={m}")
codes = (bool(admin_token), bool(member_token), bool(outsider_token), bool(neighbour_token))
print(f"accounts: admin {ADMIN}, member {MEMBER}, same-district other club {NEIGHBOUR or 'none'}, other district {OUTSIDER}")
check("admin, member and outsiders sign in", all(codes[:3]) and (neighbour_token or not NEIGHBOUR), codes)
if not (admin_token and member_token and outsider_token):
    sys.exit(1)

other = int(sql(f"SELECT pk_club_id FROM club_master WHERE IsActive=1 AND isdeleted=0 AND pk_club_id<>{club} AND pk_club_id NOT IN "
                f"(SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={ADMIN} AND IsActive=1 AND isdeleted=0 "
                f"AND fk_club_id IS NOT NULL) AND fk_district_id NOT IN (SELECT IFNULL(fk_district_id,0) FROM member_roles WHERE "
                f"fk_member_master_profile_id={ADMIN} AND IsActive=1 AND isdeleted=0) LIMIT 1"))
year = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1"))
today = date.today()
d1, d2 = today - timedelta(days=9), today - timedelta(days=2)
base = f"/api/clubs/{club}/attendance"
start = sql("SELECT UTC_TIMESTAMP()")
meetings = []
try:
    for d in (d1, d2):
        meetings.append(int(sql(f"INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, EventDateTime, created_by) "
                                f"VALUES ({club}, {year}, 'E2E attendance rules', '{d} 10:00:00', -55); SELECT LAST_INSERT_ID();")))
    m1, m2 = meetings

    def me(token=member_token):
        s, b = call("GET", f"{base}/standing?yearId={year}", token=token)
        rows = [r for r in (b or {}).get("members", []) if r["memberId"] == MEMBER]
        return s, b, rows[0] if rows else None

    s, b, row = me()
    check("member reads standing, own row only", s == 200 and row is not None and len(b["members"]) == 1, (s, b))
    counted0, made0 = row["counted"], row["madeUp"]
    check("both new meetings count against the member", counted0 >= 2, row)

    s, b = call("GET", f"{base}/missed?yearId={year}", token=member_token)
    ids = [m["id"] for m in b] if s == 200 else []
    check("missed meetings list both new meetings", m1 in ids and m2 in ids, (s, b))

    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": club, "makeupDate": str(today), "makeupType": "other_club",
                                                       "note": "E2E", "missedAttendanceId": m2}, member_token)
    check("member logs a makeup, it waits", s == 200 and b.get("status") == "pending", (s, b))
    mk = b.get("id") if s == 200 else 0
    _, _, row = me()
    check("pending makeup does not count", row["madeUp"] == made0, row)

    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": club, "makeupDate": str(today), "makeupType": "online",
                                                       "missedAttendanceId": m2}, member_token)
    check("second makeup for the same meeting refused", s == 400, (s, b))
    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": club, "makeupDate": str(today + timedelta(days=5)),
                                                       "makeupType": "online"}, member_token)
    check("makeup in the future refused", s == 400, (s, b))
    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": club, "makeupDate": str(today), "makeupType": "party"}, member_token)
    check("unknown makeup type refused", s == 400, (s, b))
    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": other, "makeupDate": str(today), "makeupType": "online"}, member_token)
    check("member cannot log a makeup in another club", s == 403, (s, b))

    s, b = call("POST", f"{base}/makeups/{mk}/review", {"approve": True}, member_token)
    check("member cannot approve", s == 403, (s, b))
    s, b = call("GET", f"{base}/makeups?yearId={year}&status=pending", token=admin_token)
    check("officer sees the waiting makeup", s == 200 and any(m["id"] == mk for m in b), (s, b))
    s, b = call("GET", f"{base}/makeups?yearId={year}&status=bogus", token=admin_token)
    check("bad status filter refused", s == 400, (s, b))
    s, b = call("POST", f"{base}/makeups/{mk}/review", {"approve": True}, admin_token)
    check("officer approves", s == 200, (s, b))
    s, b = call("POST", f"{base}/makeups/{mk}/review", {"approve": False}, admin_token)
    check("a reviewed makeup cannot be reviewed again", s == 409, (s, b))
    _, _, row = me()
    check("approved makeup counts", row["madeUp"] == made0 + 1, row)
    s, b = call("DELETE", f"/api/attendance/my-makeups/{mk}", token=member_token)
    check("member cannot withdraw an approved makeup", s == 404, (s, b))

    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": club, "makeupDate": str(d1), "makeupType": "online"}, member_token)
    mk2 = b.get("id") if s == 200 else 0
    s, b = call("GET", f"{base}/makeups?yearId={year}", token=member_token)
    check("member sees only own makeups", s == 200 and b and all(m["memberId"] == MEMBER for m in b), (s, b))
    s, b = call("DELETE", f"/api/attendance/my-makeups/{mk2}", token=member_token)
    check("member withdraws a pending makeup", s == 200, (s, b))
    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": club, "makeupDate": str(d1), "makeupType": "online"}, member_token)
    mk3 = b.get("id") if s == 200 else 0
    s, b = call("POST", f"{base}/makeups/{mk3}/review", {"approve": False, "note": "E2E no proof"}, admin_token)
    check("officer rejects", s == 200, (s, b))
    _, _, row = me()
    check("rejected makeup does not count", row["madeUp"] == made0 + 1, row)

    s, b = call("POST", f"{base}/leaves", {"memberId": MEMBER, "fromDate": str(d1), "toDate": str(d1), "reason": "E2E"}, admin_token)
    check("officer grants leave", s == 200, (s, b))
    _, _, row = me()
    check("meeting on leave leaves the count", row["counted"] == counted0 - 1 and row["excused"] >= 1, row)
    s, b = call("POST", f"{base}/leaves", {"memberId": MEMBER, "fromDate": str(d2), "toDate": str(d1)}, admin_token)
    check("leave ending before it starts refused", s == 400, (s, b))
    s, b = call("POST", f"{base}/leaves", {"memberId": MEMBER, "fromDate": str(d1), "toDate": str(d2)}, member_token)
    check("member cannot grant leave", s == 403, (s, b))

    s, b = call("PUT", f"{base}/exemptions", {"memberId": MEMBER, "reason": "Rule of 85"}, admin_token)
    check("officer exempts the member", s == 200, (s, b))
    _, _, row = me()
    check("exempt member is not counted", row["exempt"] and row["counted"] == 0 and row["percent"] is None, row)
    s, b = call("GET", f"{base}/exemptions", token=admin_token)
    ex = [e["id"] for e in b if e["memberId"] == MEMBER] if s == 200 else []
    s, b = call("DELETE", f"{base}/exemptions/{ex[0] if ex else 0}", token=admin_token)
    check("officer removes the exemption", s == 200, (s, b))
    s, b = call("PUT", f"{base}/exemptions", {"memberId": MEMBER, "reason": ""}, admin_token)
    check("exemption without a reason refused", s == 400, (s, b))

    s, b = call("PUT", f"{base}/settings", {"makeupWindowDays": 95}, admin_token)
    check("makeup window over 90 days refused", s == 400, (s, b))
    s, b = call("PUT", f"{base}/settings", {"makeupWindowDays": 14}, member_token)
    check("member cannot change settings", s == 403, (s, b))

    s, b = call("GET", f"/api/clubs/{other}/attendance/standing?yearId={year}", token=admin_token)
    check("admin of another club refused", s == 403, (s, b))
    s, b = call("GET", f"{base}/standing?yearId={year}")
    check("anonymous refused", s == 401, (s, b))
    s, b = call("GET", f"{base}/standing?yearId={year}", token=admin_token)
    check("officer sees every member", s == 200 and len(b["members"]) > 1 and "rule85" in b["members"][0], (s, str(b)[:200]))

    # ── scope of every attendance read (IDOR fix 2026-11-20) ──
    reads = [f"{base}/members", f"{base}?yearId={year}", f"{base}/{m1}", f"{base}/years",
             f"/api/clubs/{club}/club-report/attendance-matrix?yearId={year}", f"{base}/standing?yearId={year}",
             f"{base}/makeups?yearId={year}", f"{base}/missed?yearId={year}", f"{base}/meetings?yearId={year}",
             f"{base}/leaves?yearId={year}", f"{base}/exemptions", f"{base}/settings", f"{base}/member-type-rules"]
    for path in reads:
        label = path.split("?")[0].replace(base, "attendance").replace(f"/api/clubs/{club}/", "")
        s1, _, _ = raw(path, member_token)
        s2, _, _ = raw(path, admin_token)
        check(f"{label}: club member and manager get 200", s1 == 200 and s2 == 200, (s1, s2))
        s3, _, _ = raw(path, outsider_token)
        s4, _, _ = raw(path, neighbour_token) if neighbour_token else (403, "", b"")
        check(f"{label}: other-district member and same-district other-club member get 403", s3 == 403 and s4 == 403, (s3, s4))
    s, _, _ = raw(f"{base}/members", None)
    check("member list refused without a login", s == 401, s)
    foreign = sql(f"SELECT pk_attendance_id FROM club_attendance WHERE fk_club_id<>{club} AND isdeleted=0 LIMIT 1")
    s, _, _ = raw(f"{base}/{foreign or 0}", member_token)
    check("another club's meeting cannot be read through this club", s == 404, s)

    # ── close and reopen a meeting (audited) ──
    s, b = call("POST", f"{base}/{m2}/close", token=member_token)
    check("member cannot close a meeting", s == 403, (s, b))
    s, b = call("POST", f"{base}/{m2}/close", token=admin_token)
    check("officer closes a meeting", s == 200 and b.get("closed") is True, (s, b))
    s, b = call("POST", f"{base}/{m2}/close", token=admin_token)
    check("closing twice refused", s == 409, (s, b))
    audit = int(sql(f"SELECT COUNT(*) FROM audit_log WHERE action='Close' AND entity_type='club_attendance' AND entity_id={m2}"))
    check("closing is in the audit log", audit >= 1, audit)
    s, b = call("DELETE", f"{base}/{m2}", token=admin_token)
    check("a closed meeting cannot be deleted", s == 409, (s, b))
    s, b = call("POST", "/api/attendance/my-makeups", {"clubId": club, "makeupDate": str(today), "makeupType": "online",
                                                       "missedAttendanceId": m2}, member_token)
    check("no makeup for a closed meeting", s == 409, (s, b))
    s, b = call("DELETE", f"{base}/makeups/{mk}", token=admin_token)
    check("a makeup covering a closed meeting cannot be deleted", s == 409, (s, b))
    s, b = call("GET", f"{base}/meetings?yearId={year}", token=member_token)
    check("meeting list shows it closed", s == 200 and any(m["id"] == m2 and m["closed"] for m in b), (s, str(b)[:200]))
    s, b = call("GET", f"{base}/missed?yearId={year}", token=member_token)
    check("missed list shows it closed", s == 200 and any(m["id"] == m2 and m["closed"] for m in b), (s, b))
    s, b = call("POST", f"{base}/{m2}/reopen", token=admin_token)
    check("officer reopens", s == 200 and b.get("closed") is False, (s, b))
    audit = int(sql(f"SELECT COUNT(*) FROM audit_log WHERE action='Reopen' AND entity_type='club_attendance' AND entity_id={m2}"))
    check("reopening is in the audit log", audit >= 1, audit)
    s, b = call("POST", f"{base}/{m2}/reopen", token=admin_token)
    check("reopening an open meeting refused", s == 409, (s, b))

    # ── member-type rules ──
    s, b = call("GET", f"{base}/member-type-rules", token=admin_token)
    hon = [r for r in b if r["memberType"] == "honorary"] if s == 200 else []
    check("honorary members excluded by default", hon and hon[0]["rule"] == "excluded", (s, b))
    s, b = call("PUT", f"{base}/member-type-rules", {"memberType": "honorary", "rule": "own_only"}, member_token)
    check("member cannot change member-type rules", s == 403, (s, b))
    s, b = call("PUT", f"{base}/member-type-rules", {"memberType": "honorary", "rule": "sometimes"}, admin_token)
    check("unknown rule refused", s == 400, (s, b))
    s, b = call("PUT", f"{base}/member-type-rules", {"memberType": "nobody", "rule": "counted"}, admin_token)
    check("unknown member type refused", s == 400, (s, b))
    s, b = call("PUT", f"{base}/member-type-rules", {"memberType": "honorary", "rule": "own_only"}, admin_token)
    check("officer sets honorary to own figure only", s == 200, (s, b))
    honorary = int(sql(f"SELECT COUNT(*) FROM club_members WHERE fk_club_id={club} AND IsActive=1 AND isdeleted=0 AND IsHonoraryMember=1"))
    s, b = call("GET", f"{base}/standing?yearId={year}", token=admin_token)
    hrows = [m for m in b["members"] if m["memberType"] == "honorary"] if s == 200 else []
    check("honorary members listed, outside the club total" if honorary else "club has no honorary member (rule saved only)",
          (len(hrows) >= 1 and all(not m["inClubTotal"] for m in hrows)) if honorary else s == 200, (honorary, hrows[:2]))

    # ── rule of 85 report ──
    s, b = call("GET", f"{base}/rule85", token=admin_token)
    check("officer reads the rule of 85 list", s == 200 and isinstance(b, list) and all(r["age"] + r["years"] >= 85 for r in b), (s, b))
    s, ctype, body = raw(f"{base}/rule85?format=csv", admin_token)
    check("rule of 85 CSV", s == 200 and "text/csv" in ctype and body.decode("utf-8-sig").startswith("Member,Age"), (s, ctype))
    s, ctype, body = raw(f"{base}/rule85?format=pdf", admin_token)
    check("rule of 85 PDF", s == 200 and body[:4] == b"%PDF", (s, ctype))
    s, _, _ = raw(f"{base}/rule85?format=xml", admin_token)
    check("unknown report format refused", s == 400, s)
    s, _, _ = raw(f"{base}/rule85", member_token)
    check("member cannot read the rule of 85 list", s == 403, s)

    # ── sign-in sheet ──
    s, ctype, body = raw(f"{base}/{m1}/sign-in-sheet", admin_token)
    check("sign-in sheet PDF", s == 200 and body[:4] == b"%PDF" and len(body) > 2000, (s, ctype, len(body)))
    s, _, _ = raw(f"{base}/{m1}/sign-in-sheet", member_token)
    check("member cannot print the sign-in sheet", s == 403, s)
    foreign = sql(f"SELECT pk_attendance_id FROM club_attendance WHERE fk_club_id<>{club} AND isdeleted=0 LIMIT 1")
    s, _, _ = raw(f"{base}/{foreign or 0}/sign-in-sheet", admin_token)
    check("another club's meeting is not found", s == 404, s)
finally:
    if meetings:
        ids = ",".join(map(str, meetings))
        sql(f"DELETE FROM club_attendance_makeups WHERE fk_club_id={club} AND (fk_missed_attendance_id IN ({ids}) OR "
            f"(fk_member_id={MEMBER} AND created_date >= '{start}'))")
        sql(f"DELETE FROM club_member_leaves WHERE fk_club_id={club} AND fk_member_id={MEMBER} AND created_date >= '{start}'")
        sql(f"DELETE FROM club_member_attendance_exemptions WHERE fk_club_id={club} AND fk_member_id={MEMBER} AND created_date >= '{start}'")
        sql(f"DELETE FROM club_attendance_closures WHERE fk_attendance_id IN ({ids})")
        sql(f"DELETE FROM club_attendance_member_type_rules WHERE fk_club_id={club} AND modified_date >= '{start}'")
        sql(f"DELETE FROM club_attendance WHERE pk_attendance_id IN ({ids})")
    left = sql(f"SELECT (SELECT COUNT(*) FROM club_attendance WHERE created_by=-55) + (SELECT COUNT(*) FROM club_attendance_makeups "
               f"WHERE created_date >= '{start}') + (SELECT COUNT(*) FROM club_member_leaves WHERE created_date >= '{start}') "
               f"+ (SELECT COUNT(*) FROM club_attendance_closures WHERE closed_date >= '{start}') "
               f"+ (SELECT COUNT(*) FROM club_attendance_member_type_rules WHERE modified_date >= '{start}')")
    check("test rows cleaned up", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
