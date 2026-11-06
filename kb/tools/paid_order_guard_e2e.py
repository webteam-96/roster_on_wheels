"""Payment status routes: an order only ever settles or reads its own row (dues and event).

    python -I kb/tools/paid_order_guard_e2e.py <api_base> <mysql_port> <database>

Works in both payment modes and tells them apart by ROW_E2E_LEGACY_CASHFREE:
- unset: the API runs with Payments__Provider=simulated (the smoke suite's setting).
- 1: the API runs with Payments__Provider unset and CashfreePayment__BaseUrl=http://127.0.0.1:<port>/ (default port 5396).
  This script answers there as a fake Cashfree that says every order is PAID, and checks it is never asked.
Local copies only, never production. Adds rows titled 'e2e-paid-order', soft-deletes the member fees' parents at the end.
The status route allows 30 calls a minute per IP. The last check spends that allowance, then waits a minute to give it back.
"""
import json, os, secrets, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
assert "production" not in DB, "local copies only"
LEGACY = os.environ.get("ROW_E2E_LEGACY_CASHFREE") == "1"
CF_PORT = int(os.environ.get("ROW_E2E_FAKE_CASHFREE_PORT", "5396"))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TITLE = "e2e-paid-order"
fails = 0
gateway_calls = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:220]}"), flush=True)
    fails += 0 if ok else 1


class FakeCashfree(BaseHTTPRequestHandler):
    def do_GET(self):
        gateway_calls.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"order_status": "PAID"}).encode())

    def log_message(self, *a):
        pass


if LEGACY:
    threading.Thread(target=HTTPServer(("127.0.0.1", CF_PORT), FakeCashfree).serve_forever, daemon=True).start()


def get(path):
    try:
        with urllib.request.urlopen(API + path, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def order_id(prefix, owner):
    return f"{prefix}{owner}_" + "".join(secrets.choice("0123456789") for _ in range(20))


club, victim, payer = sql("""SELECT a.fk_club_id, a.fk_member_master_profile_id, b.fk_member_master_profile_id
    FROM club_members a JOIN club_members b ON b.fk_club_id = a.fk_club_id AND b.fk_member_master_profile_id <> a.fk_member_master_profile_id
    JOIN member_master_profile ma ON ma.pk_member_master_profile_id = a.fk_member_master_profile_id
    JOIN member_master_profile mb ON mb.pk_member_master_profile_id = b.fk_member_master_profile_id
    JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
    WHERE a.IsActive=1 AND a.isdeleted=0 AND b.IsActive=1 AND b.isdeleted=0 AND ma.isdeleted=0 AND mb.isdeleted=0
      AND COALESCE(a.IsHonoraryMember,0)=0 AND COALESCE(b.IsHonoraryMember,0)=0 LIMIT 1""").split()
victim_name = sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={victim}")
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1")


def new_dues():
    return sql(f"""INSERT INTO membership_dues (fk_club_id, fk_district_id, RotaryYear, Purpose, OnlineSurchargePercent, ModeOfPayment, IsFees1, IsActive, isdeleted)
        VALUES ({club},{district},'{year}','{TITLE}',0,3,1,1,0); SELECT LAST_INSERT_ID();""")


dues, other_dues = new_dues(), new_dues()
fee_v = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount) VALUES ({dues},{victim},100,0,0); SELECT LAST_INSERT_ID();")
fee_p = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount) VALUES ({dues},{payer},100,0,0); SELECT LAST_INSERT_ID();")
fee_o = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount) VALUES ({other_dues},{payer},100,0,0); SELECT LAST_INSERT_ID();")


def dues_row(fee, member, owner, paid=0):
    oid = order_id("DUES", owner)
    pk = sql(f"""INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id, FeeType, Amount, IsPaid, IsOnline, PaymentStatus, TransactionId, isdeleted)
        VALUES ({owner},{fee},{member},1,100,{paid},1,'{'PAID' if paid else 'ACTIVE'}','{oid}',0); SELECT LAST_INSERT_ID();""")
    return pk, oid


def new_link():
    return sql(f"INSERT INTO event_payment_links (Title, fk_club_id, FormType, IsActive, isdeleted) VALUES ('{TITLE}',{club},1,1,0); SELECT LAST_INSERT_ID();")


link, other_link = new_link(), new_link()


def event_row(owner, member, name, paid=0):
    oid = order_id("EVT", owner)
    pk = sql(f"""INSERT INTO event_payment_members (fk_payment_link_id, fk_member_profile_id, MemberName, Amount, IsPaid, IsOnline, PaymentStatus, CfOrderId)
        VALUES ({owner},{member},'{name}',100,{paid},1,'{'PAID' if paid else 'ACTIVE'}','{oid}'); SELECT LAST_INSERT_ID();""")
    return pk, oid


def dues_paid(pk):
    return sql(f"SELECT IsPaid FROM membership_dues_payments WHERE pk_id={pk}")


def event_paid(pk):
    return sql(f"SELECT IsPaid FROM event_payment_members WHERE pk_id={pk}")


def leaks(body, name):
    text = json.dumps(body)
    return name in text or (body or {}).get("amount") is not None


def dues_verify(oid, pk, owner=None):
    return get(f"/api/public/membership-dues/{owner or dues}/verify-payment?orderId={urllib.parse.quote(oid, safe='')}&paymentId={pk}")


def event_verify(oid, pk, owner=None):
    return get(f"/api/public/event-payment/{owner or link}/verify-payment?orderId={urllib.parse.quote(oid, safe='')}&memberPaymentId={pk}")


print(f"mode: {'Payments:Provider unset, fake Cashfree' if LEGACY else 'Payments:Provider set'}")
ev_name = "Victim " + secrets.token_hex(3)
v_pk, v_oid = dues_row(fee_v, victim, dues)
p_pk, p_oid = dues_row(fee_p, payer, dues, paid=1)
o_pk, o_oid = dues_row(fee_o, payer, other_dues)
ev_pk, ev_oid = event_row(link, victim, ev_name)
evp_pk, evp_oid = event_row(link, payer, "Payer", paid=1)
evo_pk, evo_oid = event_row(other_link, payer, "Payer")

try:
    # The exploit: another member's real paid order, used against the victim's row.
    code, body = dues_verify(p_oid, v_pk)
    check("dues exploit: answer says not paid", code == 200 and body["isSuccess"] is False, body)
    check("dues exploit: no name or amount", not leaks(body, victim_name), body)
    check("dues exploit: victim row stays IsPaid=0", dues_paid(v_pk) == "0", dues_paid(v_pk))
    code, body = event_verify(evp_oid, ev_pk)
    check("event exploit: answer says not paid", code == 200 and body["isSuccess"] is False, body)
    check("event exploit: no name or amount", not leaks(body, ev_name), body)
    check("event exploit: victim row stays IsPaid=0", event_paid(ev_pk) == "0", event_paid(ev_pk))

    # A row of another campaign, even with its own order.
    code, body = dues_verify(o_oid, o_pk)
    check("dues: an order of other dues fails its format here, row stays unpaid", body["isSuccess"] is False and dues_paid(o_pk) == "0", body)
    code, body = event_verify(evo_oid, evo_pk)
    check("event: an order of another link fails its format here, row stays unpaid", body["isSuccess"] is False and event_paid(evo_pk) == "0", body)

    # Rejected before the gateway is asked: tampering and made-up formats.
    gateway_calls.clear()
    for bad in ("x/../y", "../../v1/secret", f"DUES{dues}_123", f"DUES{dues}_{'1' * 20}/settlements", f"DUES{dues}_{'1' * 20}\n"):
        code, body = dues_verify(bad, v_pk)
        check(f"dues format refused: {bad!r}", body["isSuccess"] is False, body)
    code, body = dues_verify(order_id("DUES", dues), v_pk)
    check("dues: well-formed but not this row's order is refused", body["isSuccess"] is False and dues_paid(v_pk) == "0", body)
    check("no refused call reached the gateway", gateway_calls == [], gateway_calls)

    # The owner's real order keeps working, and a repeat changes nothing.
    code, body = dues_verify(p_oid, p_pk)
    check("the payer's own paid order still reads as paid, with the name", body["isSuccess"] is True and body["memberName"], body)
    before = sql(f"SELECT PaymentDate, PaidSource FROM membership_dues_payments WHERE pk_id={p_pk}")
    dues_verify(p_oid, p_pk)
    check("reading a paid row does not update it", sql(f"SELECT PaymentDate, PaidSource FROM membership_dues_payments WHERE pk_id={p_pk}") == before)
    code, body = event_verify(evp_oid, evp_pk)
    check("the event payer's own paid order still reads as paid", body["isSuccess"] is True, body)

    # With or without a gateway set, the status route only reads: it never settles a row, not even with its own order.
    gateway_calls.clear()
    code, body = dues_verify(v_oid, v_pk)
    check("dues: the status route never settles, even its own order", body["isSuccess"] is False and dues_paid(v_pk) == "0", body)
    code, body = event_verify(ev_oid, ev_pk)
    check("event: the status route never settles, even its own order", body["isSuccess"] is False and event_paid(ev_pk) == "0", body)
    check("nothing reached the old gateway", gateway_calls == [], gateway_calls)

    # Rate limit.
    codes = [dues_verify("nope", v_pk)[0] for _ in range(35)]
    check("status route is limited: 429 within 35 more calls", 429 in codes, codes[-3:])
    req = urllib.request.Request(API + "/api/public/club-dues/1/verify-payment", data=b"{}", method="POST", headers={"Content-Type": "application/json"})
    try:
        club_code = urllib.request.urlopen(req, timeout=30).status
    except urllib.error.HTTPError as e:
        club_code = e.code
    check("club dues verify-payment shares the limit: 429 now", club_code == 429, club_code)
    time.sleep(61)  # give the allowance back: the next script in the suite uses this route
finally:
    time.sleep(2)  # fire-and-forget work on the settled rows
    sql(f"DELETE FROM membership_dues_payments WHERE pk_id IN ({v_pk},{p_pk},{o_pk})")
    sql(f"DELETE FROM membership_dues_member_fees WHERE pk_id IN ({fee_v},{fee_p},{fee_o})")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id IN ({dues},{other_dues})")
    sql(f"DELETE FROM event_payment_members WHERE pk_id IN ({ev_pk},{evp_pk},{evo_pk})")
    sql(f"DELETE FROM event_payment_links WHERE pk_id IN ({link},{other_link})")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
