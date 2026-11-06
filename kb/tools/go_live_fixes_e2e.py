"""Temporary-password lock (web and app sign-in), paid dues cannot be deleted, bad paging, plain quote dates, API headers.

    python -I kb/tools/go_live_fixes_e2e.py <api_base> <mysql_port> <database>

Needs ROW_E2E_EMAIL and ROW_E2E_PASSWORD: a member of the local copy who can sign in. Local copies only, never
production: it changes that member's password for a moment and puts the old hash back at the end.
"""
import json, os, subprocess, sys, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
EMAIL, PASSWORD = os.environ['ROW_E2E_EMAIL'], os.environ['ROW_E2E_PASSWORD']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
NEW = 'Row-E2e-New-77!'
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q], capture_output=True, text=True, check=True).stdout.strip()


def call(method, path, tok=None, body=None):
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, json.dumps(body).encode() if body is not None else None, headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')
        try:
            return e.code, json.loads(raw), dict(e.headers)
        except ValueError:
            return e.code, raw, dict(e.headers)


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (f"  {str(detail)[:200]}" if detail and not ok else ""))
    if not ok:
        fails += 1


def web_login(password):
    return call("POST", "/api/auth/login", None, {"identifier": EMAIL, "email": EMAIL, "password": password})


member = sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId='{EMAIL}' AND isdeleted=0 LIMIT 1")
old_hash = sql(f"SELECT PasswordHash FROM member_credentials WHERE fk_member_master_profile_id={member} AND isdeleted=0 LIMIT 1")
md = None
try:
    sql(f"UPDATE member_credentials SET IsTemporaryPassword=1 WHERE fk_member_master_profile_id={member}")
    st, r, _ = web_login(PASSWORD)
    check("web: temporary password signs in and says so", st == 200 and r["isTemporaryPassword"] is True, r)
    tok = r["token"]
    st, r, _ = call("GET", "/api/clubs", tok)
    check("web: every other API refuses the temporary session", st == 403 and r.get("code") == "PASSWORD_CHANGE_REQUIRED", (st, r))
    st, _, _ = call("POST", "/api/i18n/translate", tok, {"target": "fr", "q": ["Hi"]})
    check("web: translation still answers", st == 200)
    st, _, _ = call("GET", "/api/health", tok)
    check("web: health still answers", st == 200)
    st, r, _ = call("POST", "/api/mobile/auth/login-password", None, {"email": EMAIL, "password": PASSWORD, "imei": "e2e-temp"})
    if st == 404:
        st, r, _ = call("POST", "/api/mobile/auth/login", None, {"email": EMAIL, "password": PASSWORD, "imei": "e2e-temp"})
    check("app: temporary password says it must change", st == 200 and r.get("mustChangePassword") is True, (st, r))
    if st == 200:
        st2, r2, _ = call("GET", "/api/clubs", r["token"])
        check("app: the temporary session is refused too", st2 == 403 and r2.get("code") == "PASSWORD_CHANGE_REQUIRED", (st2, r2))
    st, r, _ = call("POST", "/api/auth/change-password", tok, {"currentPassword": PASSWORD, "newPassword": NEW, "confirmPassword": NEW})
    check("password change works from the temporary session", st == 200, (st, r))
    st, r, _ = web_login(NEW)
    check("new password: not temporary", st == 200 and r["isTemporaryPassword"] is False, r)
    good = r["token"]
    st, _, _ = call("GET", "/api/clubs?page=1&pageSize=1", good)
    check("new session works", st == 200)

    st, _, _ = call("GET", "/api/clubs?page=-1&pageSize=5", good)
    check("page=-1 is treated as page 1", st == 200, st)
    st, _, _ = call("GET", "/api/clubs?page=1&pageSize=-5", good)
    check("pageSize=-5 is not a server error", st == 200, st)

    _, _, h = call("GET", "/api/health")
    low = {k.lower(): v for k, v in h.items()}
    for k in ("x-content-type-options", "x-frame-options", "referrer-policy", "content-security-policy"):
        check(f"header {k}", k in low, low)

    club = sql("SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND fk_district_id>0 ORDER BY pk_club_id LIMIT 1")
    st, q, _ = call("GET", f"/api/website-billing/quote?clubId={club}", good)
    check("website quote date has no server offset", st == 200 and "+" not in str(q["newEndDate"]) and not str(q["newEndDate"]).endswith("Z"), q)

    district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
    md = sql(f"INSERT INTO membership_dues (fk_club_id, fk_district_id, RotaryYear, Purpose, IsActive, isdeleted) VALUES ({club},{district},'2026-27','e2e-fix',1,0); SELECT LAST_INSERT_ID();")
    st, r, _ = call("DELETE", f"/api/membership-dues/{md}", good)
    check("dues without payments can be deleted", st == 200, (st, r))
    sql(f"UPDATE membership_dues SET isdeleted=0 WHERE pk_membership_dues_id={md}")
    sql(f"INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id, Amount, FeeType, IsPaid, isdeleted) VALUES ({md},0,{member},1,1,1,0)")
    st, r, _ = call("DELETE", f"/api/membership-dues/{md}", good)
    check("dues with a payment cannot be deleted", st == 409, (st, r))
    check("and stay in place", sql(f"SELECT isdeleted FROM membership_dues WHERE pk_membership_dues_id={md}") == "0")
finally:
    sql(f"UPDATE member_credentials SET PasswordHash='{old_hash}', IsTemporaryPassword=0 WHERE fk_member_master_profile_id={member}")
    if md:
        sql(f"DELETE FROM membership_dues_payments WHERE fk_membership_dues_id={md}; DELETE FROM membership_dues WHERE pk_membership_dues_id={md};")
print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
