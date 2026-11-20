"""Invoices and statements (gap #7): dues invoices (batch, idempotent), product line items, recorded payments split
across invoices, balances, statements, PDFs, email / resend, void, QuickBooks IIF + CSV, member view, access checks,
and meal charges (price per meeting / default, diners from attendance, guests on the host, billing monthly or onto the
open invoice, no dues payment rows for paid meals, member's meals in the app).

    python -I kb/tools/invoices_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET          the API's JwtSettings__Secret (tokens are minted here, no password needed)
  ROW_E2E_FAKE_BREVO_PORT     port of the fake Brevo server this script starts (default 5213)

Start the API with Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email and Brevo__ApiKey=<anything>: no email
leaves the machine. Local copies only. Uses club 341 (admin 1068, member 999). Everything created is removed at the end.
"""
import base64, hashlib, hmac, json, os, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pymysql

API, PORT, DB = sys.argv[1].rstrip('/'), int(sys.argv[2]), sys.argv[3]
assert DB != 'row_production', 'never against production'
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5213'))
CLUB, ADMIN, MEMBER, OTHER_CLUB = 341, 1068, 999, 342

sent = []


class Brevo(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        sent.append(body)
        out = json.dumps({'messageId': f'<e2e-{len(sent)}@fake>'}).encode()
        self.send_response(201); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)

    def log_message(self, *a): pass


srv = ThreadingHTTPServer(('127.0.0.1', BREVO_PORT), Brevo)
threading.Thread(target=srv.serve_forever, daemon=True).start()


def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


ADM, MEM = token(ADMIN, "Admin"), token(MEMBER, "Member")


def call(method, path, body=None, tok=ADM, raw=False):
    h = {"Authorization": f"Bearer {tok}"}
    data = None
    if body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        out, status = e.read(), e.code
    if raw: return status, out
    try: return status, json.loads(out or b"{}")
    except ValueError: return status, out


passed, failed = 0, 0


def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print(f"PASS {name}")
    else: failed += 1; print(f"FAIL {name} {detail}")


db = pymysql.connect(host='127.0.0.1', port=PORT, user='root', database=DB, autocommit=True)
cur = db.cursor()


def q(sql, *a):
    cur.execute(sql, a); return cur.fetchall()


B = f"/api/clubs/{CLUB}/invoices"
inv_start = q("SELECT COALESCE(MAX(pk_invoice_id),0) FROM dues_invoices")[0][0]
rec_start = q("SELECT COALESCE(MAX(pk_receipt_id),0) FROM invoice_receipts")[0][0]
# Items-invoice payments post to the club ledger (ClubLedgerInvoiceListener); remove those and a chart this run made.
chart_existed = q("SELECT COUNT(*) FROM acct_accounts WHERE fk_club_id=%s", CLUB)[0][0] > 0
year_id = q("SELECT pk_year_id FROM rotary_year_master ORDER BY IsCurrent DESC, pk_year_id DESC LIMIT 1")[0][0]
meetings = []
default_existed = bool(q("SELECT 1 FROM meal_prices WHERE fk_club_id=%s AND fk_attendance_id=0", CLUB))
counter_existed = bool(q("SELECT 1 FROM dues_invoice_counters WHERE fk_club_id=%s", CLUB))
log_start = q("SELECT COALESCE(MAX(pk_id),0) FROM email_log")[0][0]
cur.execute("""INSERT INTO membership_dues (fk_district_id, fk_club_id, RotaryYear, Purpose, Fees1Text, isdeleted, created_date)
               VALUES ((SELECT fk_district_id FROM club_master WHERE pk_club_id=%s), %s, '2026-27', 'E2E invoices', 'Annual', 0, NOW())""", (CLUB, CLUB))
dues = cur.lastrowid
for m, amt in ((ADMIN, 100), (MEMBER, 200)):
    cur.execute("""INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount, isdeleted)
                   VALUES (%s, %s, %s, 0, 0, 0)""", (dues, m, amt))
other_member = q("""SELECT fk_member_master_profile_id FROM club_members WHERE IsActive=1 AND fk_member_master_profile_id NOT IN
                    (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id=%s) LIMIT 1""", CLUB)[0][0]
try:
    # Access
    s, _ = call("GET", B, tok=MEM)
    check("plain member cannot read club invoices", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{OTHER_CLUB}/invoices", tok=ADM)
    check("admin cannot read another club", s == 403, s)

    # Dues invoices, batch + idempotent
    s, r = call("POST", f"{B}/generate-dues", {"duesId": dues, "feeType": 1, "issueDate": "2026-11-01", "dueDate": "2026-11-30"})
    check("generate dues invoices for the cycle", s == 200 and r.get('created') == 2, (s, r))
    s, r = call("POST", f"{B}/generate-dues", {"duesId": dues, "feeType": 1, "issueDate": "2026-11-01", "dueDate": "2026-11-30"})
    check("generating again creates nothing twice", s == 200 and r.get('created') == 0, (s, r))
    s, r = call("POST", f"{B}/generate-dues", {"duesId": dues, "feeType": 1, "issueDate": "2026-11-30", "dueDate": "2026-11-01"})
    check("due date before issue date is refused", s == 400, (s, r))

    # Products
    s, r = call("POST", f"{B}/products", {"name": "E2E Dinner", "unitAmount": 25.5})
    check("add product", s == 200 and r.get('id'), (s, r)); prod = r.get('id')
    s, r = call("POST", f"{B}/products", {"name": "", "unitAmount": 5})
    check("product without a name is refused", s == 400, (s, r))
    s, r = call("GET", f"{B}/products?activeOnly=true")
    check("products list has it", s == 200 and any(p['id'] == prod for p in r), (s, r))

    # Item invoices, batch
    lines = [{"productId": prod, "quantity": 2, "unitAmount": 25.5}, {"description": "E2E Raffle", "quantity": 1, "unitAmount": 10}]
    s, r = call("POST", B, {"memberIds": [MEMBER, ADMIN], "issueDate": "2026-11-02", "dueDate": "2026-12-02", "lines": lines, "notes": "E2E"})
    check("batch item invoice for 2 members", s == 200 and r.get('created') == 2, (s, r))
    s, r = call("POST", B, {"memberIds": [other_member], "issueDate": "2026-11-02", "dueDate": "2026-12-02", "lines": lines})
    check("invoice for a member outside the club is refused", s == 400, (s, r))
    s, r = call("POST", B, {"memberIds": [MEMBER], "issueDate": "2026-11-02", "dueDate": "2026-12-02", "lines": []})
    check("invoice with no lines is refused", s == 400, (s, r))

    s, inv = call("GET", f"{B}?memberId={MEMBER}")
    check("member filter lists dues + item invoice", s == 200 and len(inv) == 2, (s, inv))
    dues_inv = next(i for i in inv if i['kind'] == 'dues'); item_inv = next(i for i in inv if i['kind'] == 'items')
    check("item invoice total 61.00 from product + free line", item_inv['amount'] == 61.0, item_inv)
    s, d = call("GET", f"{B}/{item_inv['id']}")
    check("invoice detail has 2 lines with product", s == 200 and len(d['lines']) == 2 and d['lines'][0]['productId'] == prod, d)
    s, pdf = call("GET", f"{B}/{item_inv['id']}/pdf", raw=True)
    check("invoice PDF", s == 200 and pdf[:4] == b'%PDF', s)
    s, _ = call("GET", f"/api/clubs/{OTHER_CLUB}/invoices/{item_inv['id']}", tok=ADM)
    check("invoice under another club id is refused", s in (403, 404), s)

    # Recorded payments
    s, r = call("POST", f"{B}/receipts", {"memberId": MEMBER, "receiptDate": "2026-11-05", "method": "cheque", "reference": "E2E-CHQ-1",
                                          "amount": 300, "splits": [{"invoiceId": dues_inv['id'], "amount": 50}]})
    check("part payment of a dues invoice is refused", s == 400, (s, r))
    s, r = call("POST", f"{B}/receipts", {"memberId": MEMBER, "receiptDate": "2026-11-05", "method": "cheque", "amount": 10})
    check("cheque without a number is refused", s == 400, (s, r))
    s, r = call("POST", f"{B}/receipts", {"memberId": MEMBER, "receiptDate": "2026-11-05", "method": "cheque", "reference": "E2E-CHQ-1", "amount": 300})
    check("one cheque applied across two invoices", s == 200 and r.get('id'), (s, r))
    s, inv = call("GET", f"{B}?memberId={MEMBER}")
    check("both invoices now paid", all(i['status'] == 'paid' for i in inv), inv)
    dp = q("SELECT COUNT(*) FROM membership_dues_payments WHERE fk_membership_dues_id=%s AND fk_member_profile_id=%s AND IsPaid=1 AND PaidSource='Invoice'", dues, MEMBER)[0][0]
    check("dues module sees the dues fee as paid", dp == 1, dp)
    s, r = call("POST", f"{B}/receipts", {"memberId": ADMIN, "receiptDate": "2026-11-06", "method": "cash", "amount": 20,
                                          "splits": [{"invoiceId": [i for i in call('GET', f'{B}?memberId={ADMIN}')[1] if i['kind'] == 'items'][0]['id'], "amount": 20}]})
    check("cash part payment of an item invoice", s == 200, (s, r))

    s, bal = call("GET", f"{B}/balances")
    b999 = next((b for b in bal if b['memberId'] == MEMBER), None); b1068 = next((b for b in bal if b['memberId'] == ADMIN), None)
    check("balances: member 999 has 39.00 credit", b999 and b999['outstanding'] == 0 and b999['credit'] == 39, b999)
    check("balances: member 1068 owes 141.00", b1068 and b1068['outstanding'] == 141, b1068)
    s, st = call("GET", f"{B}/members/{MEMBER}/statement?from=2026-11-01&to=2026-11-30")
    check("statement closes at -39.00 (credit)", s == 200 and st['closing'] == -39 and st['charges'] == 261 and st['payments'] == 300, st)
    s, pdf = call("GET", f"{B}/members/{MEMBER}/statement/pdf?from=2026-11-01&to=2026-11-30", raw=True)
    check("statement PDF", s == 200 and pdf[:4] == b'%PDF', s)

    # Void
    s, r = call("POST", f"{B}/{dues_inv['id']}/void", {"reason": "E2E"})
    check("paid invoice cannot be voided", s == 409, (s, r))
    adm_dues = [i for i in call('GET', f'{B}?memberId={ADMIN}')[1] if i['kind'] == 'dues'][0]
    s, r = call("POST", f"{B}/{adm_dues['id']}/void", {"reason": "E2E wrong amount"})
    check("open invoice voided", s == 200, (s, r))

    # Email + resend
    s, r = call("POST", f"{B}/email", {"invoiceIds": [item_inv['id'], adm_dues['id']]})
    check("email sends live invoice, skips void", s == 200 and r['sent'] == 1 and r['skipped'] == 1, (s, r))
    s, r = call("POST", f"{B}/email", {"invoiceIds": [item_inv['id']]})
    check("resend", s == 200 and r['sent'] == 1, (s, r))
    check("fake Brevo got 2 mails with a PDF attachment", len(sent) == 2 and all(m.get('attachment') for m in sent), len(sent))
    cnt = q("SELECT email_count FROM dues_invoices WHERE pk_invoice_id=%s", item_inv['id'])[0][0]
    check("email count recorded", cnt == 2, cnt)

    # QuickBooks
    s, iif = call("GET", f"{B}/export/quickbooks?format=iif&from=2026-11-01&to=2026-11-30", raw=True)
    t = iif.decode()
    check("IIF has invoice and payment transactions", s == 200 and "TRNS\tINVOICE" in t and "TRNS\tPAYMENT" in t and "E2E-CHQ-1" in t, t[:300])
    check("IIF leaves out the void invoice", adm_dues['invoiceNo'] not in t)
    s, csv = call("GET", f"{B}/export/quickbooks?format=csv-invoices&from=2026-11-01&to=2026-11-30", raw=True)
    check("QBO invoices CSV", s == 200 and csv.decode().startswith("InvoiceNo,Customer,InvoiceDate,DueDate,Item,Amount"), csv[:100])
    s, csv = call("GET", f"{B}/export/quickbooks?format=csv-payments&from=2026-11-01&to=2026-11-30", raw=True)
    c = csv.decode()
    check("QBO payments CSV has the cheque split and credit", s == 200 and c.count("E2E-CHQ-1") == 3, c)
    s, _ = call("GET", f"{B}/export/quickbooks?format=xls")
    check("unknown export format refused", s == 400, s)

    # Meal charges
    for name, when in (("E2E meal meeting", "2026-11-10 19:00:00"), ("E2E meal meeting 2", "2026-10-15 19:00:00")):
        cur.execute("INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, EventDateTime, isdeleted) VALUES (%s,%s,%s,%s,0)", (CLUB, year_id, name, when))
        meetings.append(cur.lastrowid)
    m1, m2 = meetings
    q("INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id) VALUES (%s,%s),(%s,%s)", m1, MEMBER, m1, ADMIN)
    M = f"{B}/meals"
    s, r = call("PUT", f"{M}/meetings/{m1}", {"diners": [{"memberId": MEMBER, "ate": True}]})
    check("meals without any price are refused", s == 400, (s, r))
    s, r = call("PUT", f"{M}/settings", {"defaultPrice": 15})
    check("set club default meal price", s == 200, (s, r))
    s, r = call("GET", f"{M}/meetings/{m1}")
    att = {x['memberId'] for x in r.get('members', []) if x['attended']} if s == 200 else set()
    check("meeting lists its attendees", att == {MEMBER, ADMIN}, (s, att))
    s, r = call("PUT", f"{M}/meetings/{m1}", {"diners": [{"memberId": other_member, "ate": True}]})
    check("diner outside the club is refused", s == 400, (s, r))
    s, r = call("PUT", f"{M}/meetings/{m1}", {"price": 20, "diners": [{"memberId": MEMBER, "ate": True, "guests": ["E2E Guest"]}, {"memberId": ADMIN, "ate": True}]})
    check("mark diners with a guest at meeting price 20", s == 200 and r.get('meals') == 3, (s, r))
    s, r = call("PUT", f"{M}/meetings/{m1}", {"diners": [{"memberId": MEMBER, "ate": True, "guests": ["E2E Guest"]}, {"memberId": ADMIN, "ate": True}]})
    check("saving again keeps 3 meals (no duplicates)", s == 200 and r.get('meals') == 3 and q("SELECT COUNT(*) FROM meal_charges WHERE fk_attendance_id=%s", m1)[0][0] == 3, (s, r))
    s, r = call("POST", f"{M}/bill", {"month": "2026-11", "mode": "open", "issueDate": "2026-11-30", "dueDate": "2026-12-15"})
    check("bill onto open invoice: 1 new (999 had none open), 1 added (1068)", s == 200 and r.get('invoicesCreated') == 1 and r.get('invoicesUpdated') == 1 and r.get('chargesBilled') == 3, (s, r))
    s, r = call("POST", f"{M}/bill", {"month": "2026-11", "mode": "open", "issueDate": "2026-11-30", "dueDate": "2026-12-15"})
    check("billing again bills nothing", s == 200 and r.get('chargesBilled') == 0, (s, r))
    adm_items = [i for i in call('GET', f'{B}?memberId={ADMIN}')[1] if i['kind'] == 'items' and i['status'] != 'void'][0]
    check("1068's open invoice grew by 20 and stays part paid", adm_items['amount'] == 81 and adm_items['status'] == 'part_paid', adm_items)
    meal_inv = [i for i in call('GET', f'{B}?memberId={MEMBER}')[1] if i['notes'] == 'Meals 2026-11'][0]
    s, d = call("GET", f"{B}/{meal_inv['id']}")
    check("999 meal invoice 40.00 with own meal + named guest line", meal_inv['amount'] == 40 and any('Guest meal (E2E Guest)' in l['description'] for l in d['lines']), d)
    s, r = call("PUT", f"{M}/meetings/{m1}", {"diners": [{"memberId": ADMIN, "ate": True}]})
    check("removing a billed diner is refused", s == 409, (s, r))
    dues_rows_before = q("SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_profile_id=%s AND PaidSource='Invoice'", MEMBER)[0][0]
    s, r = call("POST", f"{B}/receipts", {"memberId": MEMBER, "receiptDate": "2026-11-20", "method": "bank", "reference": "E2E-MEAL-1", "amount": 40,
                                          "splits": [{"invoiceId": meal_inv['id'], "amount": 40}]})
    check("pay the meal invoice", s == 200, (s, r))
    dues_rows_after = q("SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_profile_id=%s AND PaidSource='Invoice'", MEMBER)[0][0]
    check("a paid meal writes no dues payment row", dues_rows_after == dues_rows_before, (dues_rows_before, dues_rows_after))
    s, r = call("PUT", f"{M}/meetings/{m2}", {"diners": [{"memberId": ADMIN, "ate": True}]})
    s, r = call("POST", f"{M}/bill", {"month": "2026-10", "mode": "monthly", "issueDate": "2026-10-31", "dueDate": "2026-11-15"})
    check("monthly mode makes a new invoice at the default price", s == 200 and r.get('invoicesCreated') == 1 and r.get('invoicesUpdated') == 0, (s, r))
    oct_inv = [i for i in call('GET', f'{B}?memberId={ADMIN}')[1] if i['notes'] == 'Meals 2026-10'][0]
    check("October meal invoice is 15.00", oct_inv['amount'] == 15, oct_inv)
    call("POST", f"{B}/{oct_inv['id']}/void", {"reason": "E2E"})
    s, mt = call("GET", f"{M}/meetings?from=2026-10-01&to=2026-10-31")
    check("voiding the invoice releases its meals for billing again", s == 200 and any(m['attendanceId'] == m2 and m['diners'] == 1 and m['billed'] == 0 for m in mt), mt)
    s, meals = call("GET", "/api/my/invoices/meals", tok=MEM)
    check("member sees own meal charges (meal + guest)", s == 200 and len(meals) == 2 and all(m['billed'] and m['invoiceNo'] for m in meals), (s, meals))
    s, _ = call("GET", f"{M}/charges", tok=MEM)
    check("plain member cannot read club meal charges", s == 403, s)

    # Member's own view (the app)
    s, mine = call("GET", "/api/my/invoices", tok=MEM)
    check("member sees own invoices", s == 200 and {i['id'] for i in mine['invoices']} >= {dues_inv['id'], item_inv['id']}, (s, mine))
    s, _ = call("GET", f"/api/my/invoices/{adm_dues['id']}/pdf", tok=MEM)
    check("member cannot open another member's invoice", s == 404, s)
    s, pdf = call("GET", f"/api/my/invoices/{item_inv['id']}/pdf", tok=MEM, raw=True)
    check("member opens own invoice PDF", s == 200 and pdf[:4] == b'%PDF', s)
    s, pdf = call("GET", "/api/my/invoices/statement/pdf", tok=MEM, raw=True)
    check("member statement PDF", s == 200 and pdf[:4] == b'%PDF', s)
finally:
    if meetings:
        q("DELETE FROM meal_charges WHERE fk_attendance_id IN %s", meetings)
        q("DELETE FROM meal_prices WHERE fk_club_id=%s AND fk_attendance_id IN %s", CLUB, meetings + ([] if default_existed else [0]))
        q("DELETE FROM club_attendance_members WHERE fk_attendance_id IN %s", meetings)
        q("DELETE FROM club_attendance WHERE pk_attendance_id IN %s", meetings)
    q("""DELETE l FROM acct_journal_lines l JOIN acct_journal_entries e ON e.pk_entry_id = l.fk_entry_id
         WHERE e.fk_club_id=%s AND e.source_type='invoice_receipt' AND CAST(e.source_id AS UNSIGNED) > %s""", CLUB, rec_start)
    q("DELETE FROM acct_journal_entries WHERE fk_club_id=%s AND source_type='invoice_receipt' AND CAST(source_id AS UNSIGNED) > %s", CLUB, rec_start)
    if not chart_existed and not q("SELECT COUNT(*) FROM acct_journal_entries WHERE fk_club_id=%s", CLUB)[0][0]:
        q("DELETE FROM acct_accounts WHERE fk_club_id=%s", CLUB)
    q("DELETE FROM invoice_receipts WHERE fk_club_id=%s AND pk_receipt_id > %s", CLUB, rec_start)
    q("DELETE FROM dues_invoices WHERE fk_club_id=%s AND pk_invoice_id > %s", CLUB, inv_start)
    inv_ids = [r[0] for r in q("SELECT pk_invoice_id FROM dues_invoices WHERE fk_club_id=%s AND (fk_membership_dues_id=%s OR notes='E2E')", CLUB, dues)]
    rec_ids = [r[0] for r in q("SELECT DISTINCT fk_receipt_id FROM invoice_receipt_allocations WHERE fk_invoice_id IN %s", inv_ids or [0])]
    rec_ids += [r[0] for r in q("SELECT pk_receipt_id FROM invoice_receipts WHERE fk_club_id=%s AND (reference='E2E-CHQ-1' OR receipt_date IN ('2026-11-05','2026-11-06')) AND fk_member_profile_id IN (%s,%s)", CLUB, MEMBER, ADMIN)]
    if rec_ids: q("DELETE FROM invoice_receipts WHERE pk_receipt_id IN %s", rec_ids)
    if inv_ids: q("DELETE FROM dues_invoices WHERE pk_invoice_id IN %s", inv_ids)
    q("DELETE FROM membership_dues_payments WHERE fk_membership_dues_id=%s", dues)
    q("DELETE FROM membership_dues_member_fees WHERE fk_membership_dues_id=%s", dues)
    q("DELETE FROM membership_dues WHERE pk_membership_dues_id=%s", dues)
    q("DELETE FROM invoice_products WHERE fk_club_id=%s AND name='E2E Dinner'", CLUB)
    if not counter_existed: q("DELETE FROM dues_invoice_counters WHERE fk_club_id=%s", CLUB)
    q("DELETE FROM email_log WHERE pk_id > %s AND fk_club_id=%s AND email_type='Invoice'", log_start, CLUB)
    srv.shutdown()
    left = q("SELECT COUNT(*) FROM dues_invoices WHERE fk_membership_dues_id=%s", dues)[0][0]
    print(f"cleanup: {left} invoices left for the test dues")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
