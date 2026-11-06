"""Payment webhooks: the payload proves nothing. Dues and event rows turn paid only when Cashfree itself confirms the order.

    python -I kb/tools/webhook_guard_e2e.py <api_base> <mysql_port> <database>

Modes, by environment (start the API to match):
- default: API with Payments__Provider=simulated (the smoke suite's setting). Every Cashfree webhook is ignored.
- ROW_E2E_LEGACY_CASHFREE=1: API with Payments__Provider unset, CashfreePayment__BaseUrl=http://127.0.0.1:<port>/ (default
  port 5396), CashfreePayment__ClientSecret=<ROW_E2E_CF_SECRET>. This script answers there as a fake Cashfree.
- also ROW_E2E_ENFORCE_SIGNATURE=1: the API has Payments__Webhook__EnforceSignature=true as well.
Local copies only, never production. Adds rows titled 'e2e-webhook', removes them at the end.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
assert "production" not in DB, "local copies only"
LEGACY = os.environ.get("ROW_E2E_LEGACY_CASHFREE") == "1"
ENFORCE = os.environ.get("ROW_E2E_ENFORCE_SIGNATURE") == "1"
CF_SECRET = os.environ.get("ROW_E2E_CF_SECRET", "e2e-cf-secret")
CF_PORT = int(os.environ.get("ROW_E2E_FAKE_CASHFREE_PORT", "5396"))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TITLE = "e2e-webhook"
fails = 0
orders, asked = {}, []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:220]}"), flush=True)
    fails += 0 if ok else 1


class FakeCashfree(BaseHTTPRequestHandler):
    def do_GET(self):
        order_id = self.path.rsplit('/', 1)[-1]
        asked.append(order_id)
        answer = orders.get(order_id)
        code = answer.get("_http", 200) if answer else 404
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({k: v for k, v in (answer or {"message": "not found"}).items() if k != "_http"}).encode())

    def log_message(self, *a):
        pass


if LEGACY:
    threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", CF_PORT), FakeCashfree).serve_forever, daemon=True).start()


def post(path, order_id, signed=False, headers=None):
    body = json.dumps({"data": {"order": {"order_id": order_id, "order_status": "PAID", "order_amount": 1}}}).encode()
    h = {"Content-Type": "application/json", **(headers or {})}
    if signed:
        stamp = str(int(time.time()))
        h["x-webhook-timestamp"] = stamp
        h["x-webhook-signature"] = base64.b64encode(hmac.new(CF_SECRET.encode(), stamp.encode() + body, hashlib.sha256).digest()).decode()
    req = urllib.request.Request(API + path, data=body, method="POST", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


DUES, EVENT = "/api/public/membership-dues/webhook", "/api/public/event-payment/webhook"
club, member = sql("""SELECT cm.fk_club_id, cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.isdeleted=0
    JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0
    WHERE cm.IsActive=1 AND cm.isdeleted=0 LIMIT 1""").split()
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1")
dues = sql(f"INSERT INTO membership_dues (fk_club_id,fk_district_id,RotaryYear,Purpose,OnlineSurchargePercent,ModeOfPayment,IsFees1,IsActive,isdeleted) VALUES ({club},{district},'{year}','{TITLE}',0,3,1,1,0); SELECT LAST_INSERT_ID();")
fee = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id,fk_member_profile_id,AnnualAmount,Semi1Amount,Semi2Amount) VALUES ({dues},{member},100,0,0); SELECT LAST_INSERT_ID();")
link = sql(f"INSERT INTO event_payment_links (Title,fk_club_id,FormType,IsActive,isdeleted) VALUES ('{TITLE}',{club},1,1,0); SELECT LAST_INSERT_ID();")
dues_rows, event_rows = [], []


def new_id(prefix, owner):
    return f"{prefix}{owner}_" + "".join(secrets.choice("0123456789") for _ in range(20))


def dues_row():
    oid = new_id("DUES", dues)
    pk = sql(f"""INSERT INTO membership_dues_payments (fk_membership_dues_id,fk_member_fee_id,fk_member_profile_id,FeeType,Amount,IsPaid,IsOnline,PaymentStatus,TransactionId,isdeleted)
        VALUES ({dues},{fee},{member},1,100,0,1,'ACTIVE','{oid}',0); SELECT LAST_INSERT_ID();""")
    dues_rows.append(pk)
    return pk, oid


def event_row():
    oid = new_id("EVT", link)
    pk = sql(f"""INSERT INTO event_payment_members (fk_payment_link_id,fk_member_profile_id,MemberName,Amount,IsPaid,IsOnline,PaymentStatus,CfOrderId)
        VALUES ({link},{member},'x',100,0,1,'ACTIVE','{oid}'); SELECT LAST_INSERT_ID();""")
    event_rows.append(pk)
    return pk, oid


FLOWS = (("dues", DUES, dues_row, "membership_dues_payments"), ("event", EVENT, event_row, "event_payment_members"))


def paid(table, pk):
    return sql(f"SELECT IsPaid FROM {table} WHERE pk_id={pk}")


def good(oid, **over):
    return {"order_id": oid, "order_status": "PAID", "order_amount": 100.00, "order_currency": "INR", **over}


mode = "Payments:Provider set" if not LEGACY else ("Provider unset, signature enforced" if ENFORCE else "Provider unset, signature log-only")
print(f"mode: {mode}")
try:
    if not LEGACY:
        for name, path, make, table in FLOWS:
            pk, oid = make()
            post(path, oid)
            check(f"{name}: forged webhook, row stays unpaid", paid(table, pk) == "0", paid(table, pk))
            post(path, oid, signed=True)
            check(f"{name}: even signed, a Cashfree webhook settles nothing here", paid(table, pk) == "0")

    if LEGACY and not ENFORCE:
        for name, path, make, table in FLOWS:
            # The replay: Cashfree has never heard of it.
            pk, oid = make()
            code = post(path, oid)
            check(f"{name}: forged webhook, Cashfree does not know the order, row stays unpaid", code == 200 and paid(table, pk) == "0", (code, paid(table, pk)))
            check(f"{name}: and we did ask Cashfree", oid in asked, asked[-2:])
            # Cashfree knows the order, but it does not add up.
            for label, answer in (("order still ACTIVE", {"order_status": "ACTIVE"}), ("different amount", {"order_amount": 1.00}),
                                  ("different currency", {"order_currency": "USD"}), ("Cashfree answers about another order", {"order_id": "OTHER"})):
                pk, oid = make()
                orders[oid] = good(oid, **answer)
                post(path, oid)
                check(f"{name}: {label}, row stays unpaid", paid(table, pk) == "0", paid(table, pk))
            # Cashfree is down: not paid, and the webhook asks to be sent again.
            pk, oid = make()
            orders[oid] = {"_http": 500}
            code = post(path, oid)
            check(f"{name}: Cashfree down, answers 502 so it retries, row stays unpaid", code == 502 and paid(table, pk) == "0", (code, paid(table, pk)))
            # An order id naming no row is not even looked up.
            before = len(asked)
            check(f"{name}: unknown order id, nothing asked", post(path, new_id("DUES" if name == "dues" else "EVT", 1)) == 200 and len(asked) == before)
            # Genuine, signature absent: log-only must not block a real payment.
            pk, oid = make()
            orders[oid] = good(oid)
            code = post(path, oid)
            check(f"{name}: genuine webhook, Cashfree confirms, row is paid", code == 200 and paid(table, pk) == "1", (code, paid(table, pk)))
            check(f"{name}: marked as coming from the webhook", sql(f"SELECT PaidSource, IsWebhookReceived FROM {table} WHERE pk_id={pk}").split() == ["Webhook", "1"])
            # Idempotent.
            stamp = sql(f"SELECT PaymentDate FROM {table} WHERE pk_id={pk}")
            before = len(asked)
            time.sleep(1.1)
            post(path, oid)
            check(f"{name}: a repeat changes nothing and asks nothing", sql(f"SELECT PaymentDate FROM {table} WHERE pk_id={pk}") == stamp and len(asked) == before)
            # A wrong signature is logged, not refused, while the setting is off.
            pk, oid = make()
            orders[oid] = good(oid)
            code = post(path, oid, headers={"x-webhook-signature": "bad", "x-webhook-timestamp": "1"})
            check(f"{name}: log-only, a wrong signature does not block", code == 200 and paid(table, pk) == "1", (code, paid(table, pk)))

    if LEGACY and ENFORCE:
        for name, path, make, table in FLOWS:
            pk, oid = make()
            orders[oid] = good(oid)
            check(f"{name}: enforced, no signature, 401, row stays unpaid", post(path, oid) == 401 and paid(table, pk) == "0")
            code = post(path, oid, headers={"x-webhook-signature": "bad", "x-webhook-timestamp": "1"})
            check(f"{name}: enforced, wrong signature, 401, row stays unpaid", code == 401 and paid(table, pk) == "0", code)
            code = post(path, oid, signed=True)
            check(f"{name}: enforced, right signature, Cashfree confirms, row is paid", code == 200 and paid(table, pk) == "1", (code, paid(table, pk)))

    if LEGACY and ENFORCE:
        # Fixed vector, computed with Node using the formula in Cashfree's SDK (PGVerifyWebhookSignature, api.ts):
        # base64(HMAC-SHA256(timestamp + rawBody)) with the client secret. Cashfree's docs publish no vector of their own.
        body = b'{"data":{"order":{"order_id":"DUES0_1","order_status":"PAID"}}}'


        def raw(signature):
            req = urllib.request.Request(API + DUES, data=body, method="POST", headers={"Content-Type": "application/json", "x-webhook-timestamp": "1617695238078", "x-webhook-signature": signature})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.status
            except urllib.error.HTTPError as e:
                return e.code


        check("signature vector: timestamp + raw body is accepted", raw("WsjeK04wKn8bCIOyQ2oM32BRce1ZUBZAkcNxtoGToO0=") == 200)
        check("signature vector: the timestamp.body form is refused", raw("VNW5GAvEOoQ8GzHZkZgRwFaTYXzyncZ3h4z0i5iplPc=") == 401)

    # Club dues: its own Razorpay webhook checks a signature and refuses without one.
    check("club dues: forged webhook refused", post("/api/public/club-dues/webhook", "order_x") == 401)
finally:
    time.sleep(2)  # fire-and-forget work on the settled rows
    if dues_rows:
        sql(f"DELETE FROM membership_dues_payments WHERE pk_id IN ({','.join(dues_rows)})")
    if event_rows:
        sql(f"DELETE FROM event_payment_members WHERE pk_id IN ({','.join(event_rows)})")
    sql(f"DELETE FROM membership_dues_member_fees WHERE pk_id={fee}")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id={dues}")
    sql(f"DELETE FROM event_payment_links WHERE pk_id={link}")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
