"""End-to-end check of the mobile email + password sign-in (ROW, 2026-10-19).

    python -I kb/tools/mobile_password_login_e2e.py <api_base> <mysql_port> <database>
Local copies only, never production. Picks one plain member (no admin role, no password yet) by query, gives him a
known password through a reset token written straight to the database (so no email is sent to him), signs in, and
afterwards puts everything back: his credentials, reset token, the test device session and the sign-in counters on
his profile (and the change-log rows those writes added). Run it at most once a minute: it ends by exhausting the
sign-in rate limit for this IP.
"""
import json, secrets, subprocess, sys, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
GENERIC = "Invalid email or password."
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except ValueError:
            return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


mid, email = sql(
    "SELECT m.pk_member_master_profile_id, m.EmailId FROM member_master_profile m "
    "JOIN club_members cm ON cm.fk_member_master_profile_id=m.pk_member_master_profile_id AND cm.IsActive=1 AND cm.isdeleted=0 "
    "WHERE m.isdeleted=0 AND m.EmailId LIKE '%_@_%' "
    "AND NOT EXISTS (SELECT 1 FROM member_credentials c WHERE c.fk_member_master_profile_id=m.pk_member_master_profile_id) "
    "AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id=m.pk_member_master_profile_id "
    "AND r.fk_role_id<>1 AND r.IsActive=1 AND r.isdeleted=0) "
    "AND (SELECT COUNT(*) FROM member_master_profile x WHERE x.EmailId=m.EmailId AND x.isdeleted=0)=1 "
    "ORDER BY 1 LIMIT 1").split("\t")
log_mark = sql("SELECT IFNULL(MAX(pk_change_id), 0) FROM member_change_log")
BAK = "e2e_mobile_login_profile_bak"
sql(f"DROP TABLE IF EXISTS {BAK}; CREATE TABLE {BAK} AS SELECT pk_member_master_profile_id, MobileLoginCount, LastImei, "
    f"LastDeviceToken, LastDeviceName, FirstMobileVisit, LastMobileVisit FROM member_master_profile WHERE pk_member_master_profile_id={mid}")
reset = secrets.token_urlsafe(32)
password = "Row-" + secrets.token_urlsafe(12) + "9a"
try:
    s, b = post("/api/mobile/auth/login", {"email": email, "password": "Whatever1!"})
    check("member without a password is refused with the generic message", s == 401 and b.get("message") == GENERIC, (s, b))

    s, b = post("/api/mobile/auth/login", {"email": "nobody@example.org", "password": "Whatever1!"})
    check("unknown email gives the same reply", s == 401 and b.get("message") == GENERIC, (s, b))

    s, b = post("/api/mobile/auth/forgot-password", {"email": "nobody@example.org"})
    check("forgot-password does not reveal unknown emails", s == 200, (s, b))

    # the token forgot-password would have emailed, written here so the real member gets no mail
    sql(f"INSERT INTO password_reset_tokens (fk_member_master_profile_id, Token, ExpiryDate) VALUES ({mid}, '{reset}', NOW() + INTERVAL 1 HOUR)")
    s, b = post("/api/auth/reset-password", {"token": reset, "newPassword": password, "confirmPassword": password})
    check("reset creates the member's first password", s == 200, (s, b))

    s, b = post("/api/mobile/auth/login", {"email": email, "password": password, "imei": "e2e-device", "deviceName": "Android"})
    check("member signs in with email + password", s == 200 and b.get("token") and b.get("accessibleClubs"), (s, sorted(b)))

    s, b = post("/api/mobile/auth/login", {"email": email, "password": "wrong"})
    check("wrong password is refused", s == 401, (s, b))
    attempts = sql(f"SELECT FailedLoginAttempts FROM member_credentials WHERE fk_member_master_profile_id={mid} AND IsActive=1")
    check("wrong password counts toward lockout", attempts == "1", attempts)

    codes = [post("/api/mobile/auth/login", {"email": "rate@example.org", "password": "x"})[0] for _ in range(12)]
    check("rate limit answers 429 within a minute", 429 in codes, codes)
finally:
    sql(f"DELETE FROM member_credentials WHERE fk_member_master_profile_id={mid}; "
        f"DELETE FROM password_reset_tokens WHERE fk_member_master_profile_id={mid} AND Token='{reset}'; "
        f"DELETE FROM member_device_sessions WHERE fk_member_master_profile_id={mid} AND imei='e2e-device'; "
        f"UPDATE member_master_profile m JOIN {BAK} b ON b.pk_member_master_profile_id=m.pk_member_master_profile_id "
        "SET m.MobileLoginCount=b.MobileLoginCount, m.LastImei=b.LastImei, m.LastDeviceToken=b.LastDeviceToken, "
        "m.LastDeviceName=b.LastDeviceName, m.FirstMobileVisit=b.FirstMobileVisit, m.LastMobileVisit=b.LastMobileVisit; "
        f"DROP TABLE {BAK}; DELETE FROM member_change_log WHERE fk_member_master_profile_id={mid} AND pk_change_id>{log_mark}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
