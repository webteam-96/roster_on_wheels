"""Youth programs (gap #12, 2026-11-19): RYLA and RLI participants per program year with sponsoring club and status,
the Youth Protection clearance register with expiry reminders, and the tight access rule (the appointed district youth
chair and club youth officers only; admins appoint but do not see the records).

    python -I kb/tools/youth_programs_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). The reminder check
needs the API started with YouthReminders__Enabled=true and NO mail key (Brevo__ApiKey empty): the claim is checked,
nothing is sent. Uses club 341 (club admin 1068, member 999) of the local copy; picks a chair, an outsider and a
district admin from the data. Writes test rows to the given LOCAL database only and removes them at the end
(youth_officers, youth_participants, ypp_clearances, the reminder email_log rows, the feature switch).
Never run it against production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request
from datetime import date, timedelta

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, OFFICER = 341, 1068, 999
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": [],
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None):
    h = {"Authorization": f"Bearer {tok}"}
    data = None
    if body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, None


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [{detail}]"))
    if not ok:
        fails += 1


DISTRICT = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}"))
NO_ROLE = "NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id=cm.fk_member_master_profile_id AND r.fk_role_id IN (2,3,6) AND r.IsActive=1 AND r.isdeleted=0)"
LIVE = "cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND cl.IsActive=1 AND IFNULL(cl.isdeleted,0)=0"
# the chair: an active member of another club of the district, with no admin role; the outsider: a member of another district
CHAIR, OTHER_CLUB = map(int, sql(f"""SELECT cm.fk_member_master_profile_id, cm.fk_club_id FROM club_members cm JOIN club_master cl ON cl.pk_club_id=cm.fk_club_id
    WHERE {LIVE} AND cl.fk_district_id={DISTRICT} AND cm.fk_club_id<>{CLUB} AND {NO_ROLE} LIMIT 1""").split())
OUTSIDER, OUT_DISTRICT = map(int, sql(f"""SELECT cm.fk_member_master_profile_id, cl.fk_district_id FROM club_members cm JOIN club_master cl ON cl.pk_club_id=cm.fk_club_id
    WHERE {LIVE} AND cl.fk_district_id<>{DISTRICT} AND {NO_ROLE} LIMIT 1""").split())
DADMIN = sql(f"""SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=2 AND fk_district_id={DISTRICT}
    AND (fk_club_id IS NULL OR fk_club_id=0) AND IsActive=1 AND isdeleted=0 LIMIT 1""")
# no district admin in the district: a SuperAdmin manages every district (ScopeWriteGuardMiddleware.AllowedAsync)
DADMIN = DADMIN or sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
DADMIN = int(DADMIN) if DADMIN else None
T_ADMIN, T_OFF, T_CHAIR, T_OUT = token(ADMIN), token(OFFICER), token(CHAIR), token(OUTSIDER)
CLUB_B, DIST_B = f"/api/youth/clubs/{CLUB}", f"/api/youth/districts/{DISTRICT}"
started = sql("SELECT NOW()")  # email_log.sent_at is the server clock
prior_flag = sql("SELECT enabled FROM platform_features WHERE feature_key='youth_programs'")
print(f"district {DISTRICT}, chair {CHAIR} (club {OTHER_CLUB}), outsider {OUTSIDER}, district admin {DADMIN}")

try:
    # ===== feature switch =====
    sql("INSERT INTO platform_features (feature_key, enabled) VALUES ('youth_programs', 0) ON DUPLICATE KEY UPDATE enabled=0")
    time.sleep(31)  # FeatureGate caches the switches for 30 s
    s, _ = call("GET", "/api/youth/years", T_OFF)
    check("module off: API answers 404", s == 404, s)
    sql("UPDATE platform_features SET enabled=1 WHERE feature_key='youth_programs'")
    time.sleep(31)
    s, years = call("GET", "/api/youth/years", T_OFF)
    check("module on: program years listed", s == 200 and any(y["isCurrent"] for y in years), (s, years))
    year = next(y["id"] for y in years if y["isCurrent"])

    # ===== appointments =====
    for who, tok in (("ordinary member", T_OFF), ("club admin before appointing themself", T_ADMIN)):
        s, _ = call("GET", f"{CLUB_B}/participants?yearId={year}", tok)
        check(f"{who} cannot read participants", s == 403, s)
    s, _ = call("POST", f"{CLUB_B}/officers", T_OFF, {"memberId": OFFICER})
    check("a member cannot appoint themself", s == 403, s)
    s, _ = call("POST", f"{CLUB_B}/officers", T_ADMIN, {"memberId": OUTSIDER})
    check("club officer must be a member of the club", s == 400, s)
    s, _ = call("POST", f"{CLUB_B}/officers", T_ADMIN, {"memberId": OFFICER})
    check("club admin appoints the club youth officer", s == 204, s)
    s, offs = call("GET", f"{CLUB_B}/officers", T_ADMIN)
    check("appointment listed", s == 200 and [o["memberId"] for o in offs] == [OFFICER], offs)
    s, _ = call("POST", f"{DIST_B}/officers", T_ADMIN, {"memberId": CHAIR})
    check("a club admin cannot appoint the district youth chair", s == 403, s)
    if DADMIN:
        s, _ = call("POST", f"{DIST_B}/officers", token(DADMIN), {"memberId": CHAIR})
        check("district admin or SuperAdmin appoints the district youth chair", s == 204, s)
        s, _ = call("GET", f"{DIST_B}/participants?yearId={year}", token(DADMIN))
        check("district admin or SuperAdmin (not chair) cannot read participants", s == 403, s)
    else:
        print("NOTE no district admin in this district: chair appointed directly in the database")
        sql(f"INSERT INTO youth_officers (fk_district_id, fk_club_id, fk_member_id, created_by, created_date) VALUES ({DISTRICT}, 0, {CHAIR}, {ADMIN}, UTC_TIMESTAMP())")

    # ===== participants =====
    s, err = call("POST", f"{CLUB_B}/participants", T_OFF, {"program": "ryla", "yearId": year, "fullName": "E2E Youth", "contactEmail": "nope"})
    check("bad contact email refused", s == 400, (s, err))
    s, _ = call("POST", f"{CLUB_B}/participants", T_OFF, {"program": "xyz", "yearId": year, "fullName": "E2E Youth"})
    check("unknown program refused", s == 400, s)
    s, _ = call("POST", f"{CLUB_B}/participants", T_OFF, {"program": "ryla", "yearId": 999999, "fullName": "E2E Youth"})
    check("unknown year refused", s == 400, s)
    s, p1 = call("POST", f"{CLUB_B}/participants", T_OFF, {"program": "ryla", "yearId": year, "fullName": "E2E Youth One", "contactEmail": "e2e-youth@example.invalid"})
    check("officer adds a RYLA participant (applied)", s == 200 and p1["status"] == "applied" and p1["sponsorClubId"] == CLUB, (s, p1))
    s, p2 = call("POST", f"{CLUB_B}/participants", T_OFF, {"program": "rli", "yearId": year, "fullName": "E2E Youth Two"})
    check("officer adds an RLI participant", s == 200 and p2["program"] == "rli", (s, p2))
    s, lst = call("GET", f"{CLUB_B}/participants?yearId={year}&program=rli", T_OFF)
    check("program filter", s == 200 and [p["id"] for p in lst] == [p2["id"]], lst)
    s, _ = call("PUT", f"{CLUB_B}/participants/{p1['id']}/status", T_OFF, {"status": "approved"})
    check("club officer cannot approve (the chair decides)", s == 400, s)
    s, p = call("PUT", f"{CLUB_B}/participants/{p2['id']}/status", T_OFF, {"status": "withdrawn"})
    check("club officer withdraws a participant", s == 200 and p["status"] == "withdrawn", (s, p))
    s, _ = call("GET", f"/api/youth/clubs/{OTHER_CLUB}/participants?yearId={year}", T_OFF)
    check("officer cannot read another club (IDOR)", s == 403, s)
    s, lst = call("GET", f"{DIST_B}/participants?yearId={year}", T_CHAIR)
    ids = [p["id"] for p in lst] if s == 200 else []
    check("chair sees the district's participants", p1["id"] in ids and p2["id"] in ids, (s, ids))
    for step in ("approved", "attended", "completed"):
        s, p = call("PUT", f"{DIST_B}/participants/{p1['id']}/status", T_CHAIR, {"status": step})
        check(f"chair moves the participant to {step}", s == 200 and p["status"] == step, (s, p))
    s, _ = call("PUT", f"{DIST_B}/participants/{p1['id']}/status", T_CHAIR, {"status": "approved"})
    check("no going back from completed", s == 400, s)
    s, _ = call("GET", f"/api/youth/districts/{OUT_DISTRICT}/participants?yearId={year}", T_CHAIR)
    check("chair cannot read another district (IDOR)", s == 403, s)
    s, _ = call("PUT", f"/api/youth/districts/{OUT_DISTRICT}/participants/{p1['id']}/status", T_OUT, {"status": "declined"})
    check("outsider cannot change a participant", s == 403, s)

    # ===== clearances =====
    today = date.today()
    soon = (today + timedelta(days=30)).isoformat()
    s, _ = call("PUT", f"{CLUB_B}/clearances/{OFFICER}", T_OFF, {"trainingDate": (today + timedelta(days=2)).isoformat()})
    check("training date in the future refused", s == 400, s)
    s, _ = call("PUT", f"{CLUB_B}/clearances/{OFFICER}", T_OFF, {"checkDate": today.isoformat(), "expiryDate": today.isoformat()})
    check("expiry must follow the check", s == 400, s)
    s, _ = call("PUT", f"{CLUB_B}/clearances/{OUTSIDER}", T_OFF, {"trainingDate": today.isoformat()})
    check("officer cannot record a member of another club", s == 404, s)
    s, c = call("PUT", f"{CLUB_B}/clearances/{OFFICER}", T_OFF,
                {"trainingDate": (today - timedelta(days=300)).isoformat(), "checkDate": (today - timedelta(days=300)).isoformat(), "expiryDate": soon})
    check("officer records a clearance expiring in 30 days (expiring)", s == 200 and c["state"] == "expiring", (s, c))
    s, lst = call("GET", f"{CLUB_B}/clearances", T_OFF)
    check("club register lists every member with a state", s == 200 and len(lst) > 1 and any(x["memberId"] == OFFICER and x["state"] == "expiring" for x in lst), s)
    s, lst = call("GET", f"{DIST_B}/clearances", T_CHAIR)
    check("chair sees the district register", s == 200 and any(x["memberId"] == OFFICER for x in lst), s)
    s, _ = call("GET", f"{CLUB_B}/clearances", T_ADMIN)
    check("club admin (not the officer) cannot read the register", s == 403, s)
    s, me = call("GET", "/api/youth/me", T_OFF)
    check("the app: my clearance and my officer role", s == 200 and len(me["clearances"]) == 1 and me["clearances"][0]["state"] == "expiring"
          and any(o["clubId"] == CLUB for o in me["officerOf"]), me)

    # ===== expiry reminder (claimed; no mail key, nothing is sent) =====
    claimed = ""
    for _ in range(15):
        claimed = sql(f"SELECT reminder_sent_for FROM ypp_clearances WHERE fk_district_id={DISTRICT} AND fk_member_id={OFFICER}")
        if claimed and claimed != "NULL":
            break
        time.sleep(6)
    check("expiry reminder claimed for this expiry date", claimed == soon, claimed)
    s, c = call("PUT", f"{CLUB_B}/clearances/{OFFICER}", T_OFF,
                {"trainingDate": today.isoformat(), "checkDate": today.isoformat(), "expiryDate": (today + timedelta(days=1000)).isoformat()})
    check("renewal clears the state", s == 200 and c["state"] == "cleared", (s, c))

    # ===== removal =====
    s, _ = call("DELETE", f"{CLUB_B}/officers/{OFFICER}", T_ADMIN)
    check("club admin removes the officer", s == 204, s)
    s, _ = call("GET", f"{CLUB_B}/participants?yearId={year}", T_OFF)
    check("removed officer loses access at once", s == 403, s)
finally:
    sql(f"DELETE FROM youth_participants WHERE fk_sponsor_club_id={CLUB} AND full_name LIKE 'E2E Youth%'")
    sql(f"DELETE FROM youth_officers WHERE (fk_district_id={DISTRICT} AND fk_club_id=0 AND fk_member_id={CHAIR}) OR (fk_club_id={CLUB} AND fk_member_id={OFFICER})")
    sql(f"DELETE FROM ypp_clearances WHERE fk_district_id={DISTRICT} AND fk_member_id={OFFICER}")
    sql(f"DELETE FROM email_log WHERE subject LIKE 'Your Youth Protection clearance%' AND sent_at >= '{started}'")
    if prior_flag:
        sql(f"UPDATE platform_features SET enabled={prior_flag} WHERE feature_key='youth_programs'")
    else:
        sql("DELETE FROM platform_features WHERE feature_key='youth_programs'")
    left = sql(f"SELECT (SELECT COUNT(*) FROM youth_participants WHERE full_name LIKE 'E2E Youth%') + (SELECT COUNT(*) FROM ypp_clearances WHERE fk_member_id={OFFICER})")
    check("cleanup left no test rows", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
