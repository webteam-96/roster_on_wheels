"""RIZones pull of 9-17 Nov 2026 (ROW port): dues email switch + currency, credit history / deduct, RCC + District
Goals report, OCV .xlsx, CMR Word V2, goal figures for club managers.
    python -I kb/tools/rizones_pull_1117_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret). Local copies only, never production.
Sends no email: the only send endpoint called runs with the dues' email switched OFF (it must refuse), and the
switch is put back at the end. Reads otherwise; the CMR Word V2 call uses a month that already has a report row.
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
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def js(raw):
    try: return json.loads(raw or b"null")
    except Exception: return None

def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))

sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1"))
SA = token(sa, ["SuperAdmin"])

# ── Dues: detail carries the email switch + currency; email off makes the bulk reminder refuse ──
md = sql("SELECT pk_membership_dues_id FROM membership_dues WHERE isdeleted = 0 ORDER BY pk_membership_dues_id LIMIT 1")
if md:
    st, raw = call("GET", f"/api/membership-dues/{md}", SA); d = js(raw) or {}
    check("membership dues detail has notifyEmail + currency", st == 200 and "notifyEmail" in d and "currency" in d, f"{st} {list(d)[:8]}")
    check("membership dues detail has no WhatsApp flag", "notifyWhatsApp" not in d, "notifyWhatsApp present")
    sql(f"UPDATE membership_dues SET NotifyEmail = 0 WHERE pk_membership_dues_id = {md}")
    try:
        st, raw = call("POST", f"/api/membership-dues/{md}/bulk-reminder-email", SA, {"remark": "e2e"})
        check("bulk reminder refused while email is off", st == 400 and b"switched off" in raw, f"{st} {raw[:120]}")
    finally:
        sql(f"UPDATE membership_dues SET NotifyEmail = 1 WHERE pk_membership_dues_id = {md}")
cd = sql("SELECT pk_club_dues_id FROM club_dues WHERE isdeleted = 0 ORDER BY pk_club_dues_id LIMIT 1")
if cd:
    st, raw = call("GET", f"/api/club-dues/{cd}", SA); d = js(raw) or {}
    check("district dues detail has notifyEmail + currency", st == 200 and "notifyEmail" in d and "currency" in d, f"{st} {list(d)[:8]}")

# ── Credits: history of a pack; a deduction of 0 is refused (nothing written) ──
pack = sql("SELECT pk_credit_id FROM club_credits WHERE isdeleted = 0 ORDER BY pk_credit_id DESC LIMIT 1")
if pack:
    st, raw = call("GET", f"/api/credit-management/{pack}/history", SA); h = js(raw)
    check("credit pack history answers", st == 200 and isinstance(h, dict), f"{st} {raw[:150]}")
    st, raw = call("POST", f"/api/credit-management/{pack}/deduct", SA, {"count": 0, "reason": "e2e"})
    check("deduct 0 credits is refused", st == 400, f"{st} {raw[:150]}")
    ordinary = sql("SELECT cm.fk_member_master_profile_id FROM club_members cm LEFT JOIN member_roles r ON r.fk_member_master_profile_id = cm.fk_member_master_profile_id AND r.isdeleted = 0 WHERE cm.IsActive = 1 AND r.pk_member_role_id IS NULL LIMIT 1")
    st, _ = call("GET", f"/api/credit-management/{pack}/history", token(int(ordinary), ["Member"]))
    check("credit history closed to an ordinary member", st in (401, 403), st)

# ── RCC + District Goals report: SuperAdmin gets an .xlsx, an ordinary member is refused ──
dist = sql("SELECT pk_district_id FROM district_master WHERE isdeleted = 0 AND IsActive = 1 AND DistrictNumber = '5656' LIMIT 1") \
    or sql("SELECT pk_district_id FROM district_master WHERE isdeleted = 0 AND IsActive = 1 LIMIT 1")
st, raw = call("GET", f"/api/rcc-goals/report/district/{dist}", SA)
check("RCC + District Goals district report is an .xlsx", st == 200 and raw[:2] == b"PK", f"{st} {raw[:120]}")
club = sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id = {dist} AND isdeleted = 0 AND IsActive = 1 LIMIT 1")
st, raw = call("GET", f"/api/rcc-goals/report/club/{club}", SA)
check("RCC + District Goals club report is an .xlsx", st == 200 and raw[:2] == b"PK", f"{st} {raw[:120]}")
member = sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm LEFT JOIN member_roles r ON r.fk_member_master_profile_id = cm.fk_member_master_profile_id AND r.isdeleted = 0 AND r.IsActive = 1 WHERE cm.fk_club_id = {club} AND cm.IsActive = 1 AND r.pk_member_role_id IS NULL LIMIT 1")
if member:
    st, _ = call("GET", f"/api/rcc-goals/report/club/{club}", token(int(member), ["Member"]))
    check("RCC club report closed to an ordinary member", st in (401, 403), st)

# ── OCV report is a real .xlsx now ──
year = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")
st, raw = call("GET", f"/api/clubs/{club}/ocv-gov/report/excel?yearId={year}", SA)
check("OCV Excel is an .xlsx", st == 200 and raw[:2] == b"PK", f"{st} {raw[:150]}")

# ── CMR Word V2 on a month that already has a report ──
rep = sql("SELECT fk_club_id, fk_year_id, ReportMonth FROM club_monthly_reports WHERE isdeleted = 0 ORDER BY pk_report_id DESC LIMIT 1")
if rep:
    c, y, m = rep.split("\t")
    st, raw = call("POST", f"/api/clubs/{c}/monthly-reports/word-v2/{y}/{m}", SA, {"membership": []})
    check("CMR Word V2 is a .docx", st == 200 and raw[:2] == b"PK", f"{st} {raw[:150]}")

print("\nFAILED: %d" % fails if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
