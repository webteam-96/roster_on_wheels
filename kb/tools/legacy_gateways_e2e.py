"""Cashfree and Razorpay are off on ROW: their routes answer 404 for everyone, whatever the settings, and online payment
never falls back to them.

    python -I kb/tools/legacy_gateways_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET. With ROW_E2E_NO_PROVIDER=1 the API runs with Payments__Provider unset and fake Cashfree
and Razorpay addresses (port 5396, default), and the script checks nothing reaches them. Local copies only.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
assert "production" not in DB, "local copies only"
SECRET = os.environ['ROW_E2E_JWT_SECRET']
NO_PROVIDER = os.environ.get("ROW_E2E_NO_PROVIDER") == "1"
FAKE_PORT = int(os.environ.get("ROW_E2E_FAKE_GATEWAY_PORT", "5396"))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0
gateway_calls = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:200]}"), flush=True)
    fails += 0 if ok else 1


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Fake(BaseHTTPRequestHandler):
    def _any(self):
        gateway_calls.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"order_status":"PAID","id":"order_x","cf_order_id":"1","payment_session_id":"s"}')

    do_GET = do_POST = _any

    def log_message(self, *a):
        pass


if NO_PROVIDER:
    threading.Thread(target=HTTPServer(("127.0.0.1", FAKE_PORT), Fake).serve_forever, daemon=True).start()

admin = sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
SA = token(admin, ["SuperAdmin"])
print("mode:", "Payments:Provider unset" if NO_PROVIDER else "Payments:Provider set")

ROUTES = [
    ("GET", "/api/cashfree-kyc"), ("POST", "/api/cashfree-kyc/send-otp"), ("POST", "/api/cashfree-kyc/verify-and-save"),
    ("DELETE", "/api/cashfree-kyc/1"), ("PUT", "/api/cashfree-kyc/1/toggle-active"), ("GET", "/api/cashfree-kyc/1/detail"),
    ("POST", "/api/cashfree-kyc/refresh-all"), ("POST", "/api/cashfree-kyc/sync/x"), ("POST", "/api/cashfree-kyc/1/refresh"),
    ("GET", "/api/admin/razorpay-route-accounts"), ("POST", "/api/admin/razorpay-route-accounts"),
    ("POST", "/api/admin/razorpay-route-accounts/send-otp"), ("PUT", "/api/admin/razorpay-route-accounts/1"),
    ("POST", "/api/admin/razorpay-route-accounts/1/refresh"), ("POST", "/api/admin/razorpay-route-accounts/refresh-all"),
    ("DELETE", "/api/admin/razorpay-route-accounts/1"),
    ("GET", "/api/admin/club-websites/pricing/route-account"), ("PUT", "/api/admin/club-websites/pricing/route-account"),
    ("POST", "/api/public/membership-dues/webhook"), ("POST", "/api/public/event-payment/webhook"),
    ("POST", "/api/public/club-dues/webhook"), ("POST", "/api/wallet/webhook"), ("POST", "/api/website-billing/webhook"),
]
for method, path in ROUTES:
    for label, tok in (("anonymous", None), ("SuperAdmin", SA)):
        code, _ = call(method, path, tok, {} if method != "GET" else None)
        check(f"{method} {path}, {label}: 404", code == 404, code)

# The forged webhook replay: an unpaid row stays unpaid.
_club, _member = sql("""SELECT cm.fk_club_id, cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.isdeleted=0
    JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0
    WHERE cm.IsActive=1 AND cm.isdeleted=0 LIMIT 1""").split()
_district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={_club}")
_year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1")
_dues = sql(f"INSERT INTO membership_dues (fk_club_id,fk_district_id,RotaryYear,Purpose,OnlineSurchargePercent,ModeOfPayment,IsFees1,IsActive,isdeleted) VALUES ({_club},{_district},'{_year}','e2e-legacy',0,3,1,1,0); SELECT LAST_INSERT_ID();")
_fee = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id,fk_member_profile_id,AnnualAmount,Semi1Amount,Semi2Amount) VALUES ({_dues},{_member},100,0,0); SELECT LAST_INSERT_ID();")
_oid = f"DUES{_dues}_12345678901234567890"
_pay = sql(f"INSERT INTO membership_dues_payments (fk_membership_dues_id,fk_member_fee_id,fk_member_profile_id,FeeType,Amount,IsPaid,IsOnline,PaymentStatus,TransactionId,isdeleted) VALUES ({_dues},{_fee},{_member},1,100,0,1,'ACTIVE','{_oid}',0); SELECT LAST_INSERT_ID();")
_link = sql(f"INSERT INTO event_payment_links (Title,fk_club_id,FormType,IsActive,isdeleted) VALUES ('e2e-legacy',{_club},1,1,0); SELECT LAST_INSERT_ID();")
_eoid = f"EVT{_link}_12345678901234567890"
_epay = sql(f"INSERT INTO event_payment_members (fk_payment_link_id,fk_member_profile_id,MemberName,Amount,IsPaid,IsOnline,PaymentStatus,CfOrderId) VALUES ({_link},{_member},'x',100,0,1,'ACTIVE','{_eoid}'); SELECT LAST_INSERT_ID();")
try:
    forged = lambda o: {"data": {"order": {"order_id": o, "order_status": "PAID"}}}
    check("forged dues webhook: 404", call("POST", "/api/public/membership-dues/webhook", None, forged(_oid))[0] == 404)
    check("forged dues webhook: row stays unpaid", sql(f"SELECT IsPaid FROM membership_dues_payments WHERE pk_id={_pay}") == "0")
    check("forged event webhook: 404", call("POST", "/api/public/event-payment/webhook", None, forged(_eoid))[0] == 404)
    check("forged event webhook: row stays unpaid", sql(f"SELECT IsPaid FROM event_payment_members WHERE pk_id={_epay}") == "0")
finally:
    sql(f"DELETE FROM membership_dues_payments WHERE pk_id={_pay}")
    sql(f"DELETE FROM membership_dues_member_fees WHERE pk_id={_fee}")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id={_dues}")
    sql(f"DELETE FROM event_payment_members WHERE pk_id={_epay}")
    sql(f"DELETE FROM event_payment_links WHERE pk_id={_link}")

# A campaign can be created with no vendor accounts, which is what the create form now sends.
def post_form(path, fields):
    boundary = "e2elegacyboundary"
    crlf = chr(13) + chr(10)
    data = "".join(f'--{boundary}{crlf}Content-Disposition: form-data; name="{k}"{crlf}{crlf}{v}{crlf}' for k, v in fields.items()) + f"--{boundary}--{crlf}"
    req = urllib.request.Request(API + path, data=data.encode(), method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": f"Bearer {SA}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


code, out = post_form("/api/membership-dues", {"fkDistrictId": _district, "fkClubId": _club, "rotaryYear": _year, "purpose": "e2e-legacy-form", "modeOfPayment": 3,
                                               "isFees1": "true", "fees1Text": "Annual", "isFees2": "false", "isFees3": "false", "defaultCategoryType": "Regular",
                                               "defaultAnnualAmount": 100, "defaultSemi1Amount": 0, "defaultSemi2Amount": 0, "onlineSurchargePercent": 0, "amountType": 1, "vendorsJson": "[]"})
_new = sql("SELECT pk_membership_dues_id FROM membership_dues WHERE Purpose='e2e-legacy-form' ORDER BY 1 DESC LIMIT 1")
check("dues can be created with no vendor accounts", code == 200 and bool(_new), (code, out[:160]))
if _new:
    check("those dues have no vendor rows", sql(f"SELECT COUNT(*) FROM membership_dues_vendors WHERE fk_membership_dues_id={_new}") == "0")
    sql(f"DELETE FROM membership_dues_member_fees WHERE fk_membership_dues_id={_new}")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id={_new}")

code, body = call("GET", "/api/features", SA)
keys = {f.get("key"): f for f in json.loads(body)} if code == 200 else {}
check("the feature list marks it skipped, so the admin hides its pages", keys.get("legacy_gateways", {}).get("kind") == "skipped", keys.get("legacy_gateways"))

if NO_PROVIDER:
    # Every way to start an online payment refuses, before any row or gateway call.
    club, member = sql("""SELECT cm.fk_club_id, cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.isdeleted=0
        JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0
        WHERE cm.IsActive=1 AND cm.isdeleted=0 LIMIT 1""").split()
    for label, path, body_ in (
        ("wallet top-up", "/api/wallet/create-order", {"scope": "club", "clubId": int(club), "creditType": "email", "credits": 100}),
        ("website purchase", "/api/website-billing/create-order", {"clubId": int(club)}),
        ("club dues officer", f"/api/club-dues/officer/1/pay?clubId={club}", {}),
    ):
        code, out = call("POST", path, SA, body_)
        refused = code == 400 and b"not available yet" in out if label != "club dues officer" else code in (400, 403, 404)
        check(f"{label}: no online payment without a checkout gateway", refused and b"razorpay" not in out.lower(), (code, out[:120]))
    check("nothing reached the old gateways", gateway_calls == [], gateway_calls)

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
