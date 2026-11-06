"""Which test features each environment allows. Production ignores them even when they are switched on in settings.

    python -I kb/tools/dev_only_e2e.py <api_base> <mysql_port> <database>

              simulator   API docs   detailed errors   demo password
Development   yes         yes        yes               allowed
Staging       yes         no         no                allowed
Production    no          no         no                refused

JWT secret from ROW_E2E_JWT_SECRET. The suite runs it against a Development API with Payments__Provider=simulated. Set
ROW_E2E_EXPECT=staging or production against an API started with that ASPNETCORE_ENVIRONMENT, Payments__Provider=simulated,
Payments__AllowSimulatedInProduction=true and Swagger__Enabled=true. Local copies only. Rows titled 'e2e-devonly' are removed.
It renames a table for one request to cause a server error, and renames it back.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
assert "production" not in DB, "local copies only"
SECRET = os.environ['ROW_E2E_JWT_SECRET']
EXPECT = os.environ.get("ROW_E2E_EXPECT", "development")
assert EXPECT in ("development", "staging", "production")
SIMULATOR, DOCS, DETAILS = EXPECT != "production", EXPECT == "development", EXPECT == "development"
BANNED = EXPECT == "production"
# Bcrypt of the demo password that is already public in this repo's docs. Used only to prove Production refuses it.
DEMO_PASSWORD, DEMO_HASH = "Admin@123", "$2b$10$grNI842PqfhrQmPwfPAWn.DbboJiLjpsY5cjnY/ndNjh8b6zeavC."
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:200]}"), flush=True)
    fails += 0 if ok else 1


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def payer(dues, member):
    p = b64(json.dumps({"d": dues, "m": member, "e": int(time.time()) + 600}, separators=(',', ':')).encode())
    return f"{p}.{b64(hmac.new(SECRET.encode(), p.encode(), hashlib.sha256).digest())}"


def call(method, path, body=None, headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


print("expecting:", EXPECT)
club, member = sql("""SELECT cm.fk_club_id, cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.isdeleted=0
    JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0
    WHERE cm.IsActive=1 AND cm.isdeleted=0 AND COALESCE(cm.IsHonoraryMember,0)=0 LIMIT 1""").split()
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1")
dues = sql(f"INSERT INTO membership_dues (fk_club_id,fk_district_id,RotaryYear,Purpose,OnlineSurchargePercent,ModeOfPayment,IsFees1,IsActive,isdeleted) VALUES ({club},{district},'{year}','e2e-devonly',0,3,1,1,0); SELECT LAST_INSERT_ID();")
fee = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id,fk_member_profile_id,AnnualAmount,Semi1Amount,Semi2Amount) VALUES ({dues},{member},100,0,0); SELECT LAST_INSERT_ID();")
token = "e2edevonly" + secrets.token_hex(8)
session = sql(f"""INSERT INTO payment_checkout_sessions (session_token,gateway,flow,flow_ref,merchant_order_id,amount,currency,description,return_url,cancel_url,status,expires_at,created_date)
    VALUES ('{token}','simulated','membership_dues',0,'e2e-devonly-{token}',1,'USD','e2e','http://x/','http://x/','open',DATE_ADD(NOW(), INTERVAL 1 HOUR),NOW()); SELECT LAST_INSERT_ID();""")

demo = None
try:
    code, out = call("POST", f"/api/public/membership-dues/{dues}/pay", {"feeType": 1}, {"X-Payer-Token": payer(int(dues), int(member))})
    if SIMULATOR:
        check("simulated payment works", code == 200 and json.loads(out).get("checkout"), (code, out[:160]))
    else:
        check("simulated payment refused", code == 400 and b"not available yet" in out, (code, out[:160]))

    code, out = call("POST", f"/api/public/payments/checkout/{token}/simulate", {"outcome": "cancelled"})
    if SIMULATOR:
        check("a simulated session can be completed", code == 200, (code, out[:120]))
    else:
        check("a simulated session cannot be completed", code == 404, (code, out[:120]))
        check("and the session is untouched", sql(f"SELECT status FROM payment_checkout_sessions WHERE pk_id={session}") == "open")

    code, _ = call("GET", "/swagger/index.html")
    check("API docs " + ("served" if DOCS else "404"), code == (200 if DOCS else 404), code)

    sql("RENAME TABLE event_payment_otp TO event_payment_otp_e2e_hidden")
    try:
        code, out = call("POST", f"/api/public/membership-dues/{dues}/send-otp", {"memberProfileId": int(member)})
    finally:
        sql("RENAME TABLE event_payment_otp_e2e_hidden TO event_payment_otp")
    check("a server error answers 500", code == 500, (code, out[:160]))
    if DETAILS:
        check("the error shows its detail", b"event_payment_otp" in out, out[:160])
    else:
        check("the error shows no detail", b"event_payment_otp" not in out and b"MySql" not in out and b"Something went wrong" in out, out[:160])
    # The published demo password. Production refuses it at every door, even when it is really this member's password.
    demo_email = f"demo.{secrets.token_hex(4)}@example.invalid"
    demo = sql(f"INSERT INTO member_master_profile (MemberName, EmailId) VALUES ('e2e-devonly', '{demo_email}'); SELECT LAST_INSERT_ID();")
    sql(f"INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive, isdeleted) VALUES ({club},{demo},1,0)")
    sql(f"INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES ({demo}, '{DEMO_HASH}', 0)")
    # Web sign-in is for admins, so without this role every attempt fails for another reason.
    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, fk_club_id, IsActive, isdeleted, created_date) VALUES ({demo}, 2, {district}, {club}, 1, 0, NOW())")
    code, out = call("POST", "/api/auth/login", {"identifier": demo_email, "email": demo_email, "password": DEMO_PASSWORD})
    check("demo password, web sign-in: " + ("refused as a wrong password" if BANNED else "allowed"),
          (code == 401 and b"permission" not in out) if BANNED else code == 200, (code, out[:120]))
    code, out = call("POST", "/api/mobile/auth/login", {"email": demo_email, "password": DEMO_PASSWORD})
    check("demo password, app sign-in: " + ("refused" if BANNED else "allowed"), code == (401 if BANNED else 200), (code, out[:120]))


    def reset_to(password):
        tok = secrets.token_urlsafe(24)
        sql(f"INSERT INTO password_reset_tokens (fk_member_master_profile_id, Token, ExpiryDate) VALUES ({demo}, '{tok}', NOW() + INTERVAL 1 HOUR)")
        return call("POST", "/api/auth/reset-password", {"token": tok, "newPassword": password, "confirmPassword": password})


    if BANNED:
        code, out = reset_to(DEMO_PASSWORD)
        check("demo password cannot be set by reset", code == 400 and b"not allowed" in out, (code, out[:120]))
    good = "Row-" + secrets.token_urlsafe(12) + "9a"
    code, out = reset_to(good)
    check("any other password can be set", code == 200, (code, out[:120]))
    code, out = call("POST", "/api/auth/login", {"identifier": demo_email, "email": demo_email, "password": good})
    check("and signs in", code == 200, (code, out[:120]))
finally:
    sql(f"DELETE FROM payment_checkout_sessions WHERE pk_id={session}")
    sql(f"DELETE FROM payment_checkout_sessions WHERE merchant_order_id LIKE 'DUES{dues}\\_%'")
    sql(f"DELETE FROM membership_dues_payments WHERE fk_membership_dues_id={dues}")
    sql(f"DELETE FROM membership_dues_member_fees WHERE pk_id={fee}")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id={dues}")
    if demo:
        sql(f"UPDATE club_members SET isdeleted=1, IsActive=0 WHERE fk_member_master_profile_id={demo}")
        sql(f"UPDATE member_roles SET isdeleted=1, IsActive=0 WHERE fk_member_master_profile_id={demo}")
        sql(f"UPDATE member_master_profile SET isdeleted=1 WHERE pk_member_master_profile_id={demo}")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
