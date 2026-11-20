"""Club accounts (gap agent 2026-11-19): starter chart, treasurer's quick entries, balanced manual entries,
reversal instead of edit, profit and loss, balance sheet, budget vs actual, CSV / Excel / PDF exports, automatic
posting of paid membership dues (and reversal when the payment is deleted), and who may see a club's books.

    python -I kb/tools/club_accounts_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Uses club 341
(admin 1068, ordinary member 999) and an admin of another club. Writes to the given LOCAL database only and removes
what it created at the end (acct_* rows of the test clubs when they had none before, the test dues, fee and
payment rows). audit_log
rows stay: that table is append-only by design. Never run it against production.
"""
import base64, datetime, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, PLAIN = 341, 1068, 999
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(v) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {tok}"} if tok else {}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, rtype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, rtype = e.read(), e.code, e.headers.get("Content-Type", "")
    if "json" in rtype and payload:
        return status, json.loads(payload)
    return status, payload


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


# ── People ──────────────────────────────────────────────────────────────────────────────────────────────────────
other_club, other_admin = [int(x) for x in sql(
    "SELECT r.fk_club_id, r.fk_member_master_profile_id FROM member_roles r WHERE r.fk_role_id=2 AND r.IsActive=1 "
    f"AND r.isdeleted=0 AND r.fk_club_id NOT IN (0,{CLUB}) AND NOT EXISTS (SELECT 1 FROM member_roles y "
    "WHERE y.fk_member_master_profile_id=r.fk_member_master_profile_id AND y.IsActive=1 AND y.isdeleted=0 "
    f"AND (y.fk_role_id IN (3,4,7) OR y.fk_club_id={CLUB} OR (y.fk_role_id=2 AND IFNULL(y.fk_club_id,0)=0))) "
    "ORDER BY 1 LIMIT 1").split()]
t_admin, t_plain, t_other = token(ADMIN, "Admin"), token(PLAIN, "Member"), token(other_admin, "Admin")
had_books = {c: one(f"SELECT COUNT(*) FROM acct_accounts WHERE fk_club_id={c}") > 0 for c in (CLUB, other_club)}
start_entry = one("SELECT IFNULL(MAX(pk_entry_id),0) FROM acct_journal_entries")
year = one("SELECT pk_year_id FROM rotary_year_master WHERE CURDATE() BETWEEN StartDate AND EndDate AND IFNULL(isdeleted,0)=0 LIMIT 1")
today = datetime.date.today().isoformat()
B = f"/api/clubs/{CLUB}/accounts"
dues_id = None

try:
    # ── Access ──────────────────────────────────────────────────────────────────────────────────────────────────
    check("no token is 401", call("GET", B + "/summary", None)[0] == 401)
    check("ordinary member is refused", call("GET", B + "/summary", t_plain)[0] == 403)
    check("another club's admin is refused", call("GET", B + "/summary", t_other)[0] == 403)

    # ── Chart ───────────────────────────────────────────────────────────────────────────────────────────────────
    s, accts = call("GET", B, t_admin)
    check("admin gets the chart", s == 200 and isinstance(accts, list), accts)
    by_code = {a["code"]: a for a in accts}
    check("starter chart seeded", all(c in by_code for c in ("1000", "4000", "4100", "5100", "3000")), list(by_code))
    bank, donations, meals, funds = by_code["1000"]["id"], by_code["4100"]["id"], by_code["5100"]["id"], by_code["3000"]["id"]
    bank0 = by_code["1000"]["balance"]
    s, r = call("POST", B + "/chart", t_admin, {"code": "1000", "name": "Dup", "type": "asset", "isBank": False})
    check("duplicate code refused", s == 400, r)
    s, r = call("POST", B + "/chart", t_admin, {"code": "1300", "name": "Bad", "type": "money", "isBank": False})
    check("unknown type refused", s == 400, r)
    s, sav = call("POST", B + "/chart", t_admin, {"code": "1001", "name": "Savings", "type": "asset", "isBank": True,
                                                   "bankName": "e2e Bank", "accountLast4": "4321"})
    check("bank account created", s == 200 and sav["isBank"] and sav["accountLast4"] == "4321", sav)
    s, r = call("POST", B + "/chart", t_admin, {"code": "1002", "name": "X", "type": "asset", "isBank": True, "accountLast4": "12345678"})
    check("full account number refused", s == 400, r)
    s, r = call("PUT", f"{B}/chart/{by_code['4000']['id']}", t_admin,
                {"code": "4000", "name": "Membership dues", "type": "income", "isBank": False, "isActive": False})
    check("dues account cannot be switched off", s == 400, r)

    # ── Entries ─────────────────────────────────────────────────────────────────────────────────────────────────
    s, e_in = call("POST", B + "/journal/quick", t_admin, {"kind": "in", "entryDate": today, "categoryAccountId": donations,
                                                          "bankAccountId": bank, "amount": 500.00, "memo": "e2e donation"})
    check("quick money in", s == 200 and e_in["total"] == 500, e_in)
    s, e_out = call("POST", B + "/journal/quick", t_admin, {"kind": "out", "entryDate": today, "categoryAccountId": meals,
                                                           "bankAccountId": bank, "amount": 120.25, "memo": "e2e meeting dinner"})
    check("quick money out", s == 200 and e_out["total"] == 120.25, e_out)
    s, r = call("POST", B + "/journal/quick", t_admin, {"kind": "in", "categoryAccountId": meals, "bankAccountId": bank,
                                                       "amount": 5, "memo": "wrong side"})
    check("money in to an expense account refused", s == 400, r)
    s, r = call("POST", B + "/journal", t_admin, {"entryDate": today, "memo": "unbalanced", "lines": [
        {"accountId": bank, "debit": 100, "credit": 0}, {"accountId": funds, "debit": 0, "credit": 99.99}]})
    check("unbalanced entry refused", s == 400 and "equal" in r.get("message", ""), r)
    s, r = call("POST", B + "/journal", t_admin, {"entryDate": today, "memo": "foreign", "lines": [
        {"accountId": bank, "debit": 10, "credit": 0}, {"accountId": 2147483000, "debit": 0, "credit": 10}]})
    check("account outside the club refused", s == 400, r)
    s, opening = call("POST", B + "/journal", t_admin, {"entryDate": today, "memo": "e2e opening balance", "lines": [
        {"accountId": bank, "debit": 1000, "credit": 0}, {"accountId": sav["id"], "debit": 250.50, "credit": 0},
        {"accountId": funds, "debit": 0, "credit": 1250.50}]})
    check("balanced three-line entry", s == 200 and len(opening["lines"]) == 3 and opening["total"] == 1250.5, opening)

    s, rev = call("POST", f"{B}/journal/{e_out['id']}/reverse", t_admin, {"entryDate": today})
    check("entry reversed", s == 200 and rev["reversesEntryId"] == e_out["id"], rev)
    check("reversal mirrors the lines", sorted((l["accountId"], l["debit"], l["credit"]) for l in rev["lines"]) ==
          sorted((l["accountId"], l["credit"], l["debit"]) for l in e_out["lines"]), rev)
    check("second reversal refused", call("POST", f"{B}/journal/{e_out['id']}/reverse", t_admin, {})[0] == 400)
    check("reversal of a reversal refused", call("POST", f"{B}/journal/{rev['id']}/reverse", t_admin, {})[0] == 400)
    check("posted entries cannot be edited", call("PUT", f"{B}/journal/{e_in['id']}", t_admin, {"memo": "x"})[0] in (404, 405))
    check("posted entries cannot be deleted", call("DELETE", f"{B}/journal/{e_in['id']}", t_admin)[0] in (404, 405))
    s, got = call("GET", f"{B}/journal/{e_out['id']}", t_admin)
    check("original shows who reversed it", s == 200 and got["reversedByEntryId"] == rev["id"], got)
    check("another club cannot read this entry through its own books",
          call("GET", f"/api/clubs/{other_club}/accounts/journal/{e_in['id']}", t_other)[0] == 404)

    # ── Automatic posting of paid dues ──────────────────────────────────────────────────────────────────────────
    district = one(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}")
    dues_id = one(f"INSERT INTO membership_dues (fk_district_id, fk_club_id, RotaryYear, Purpose, isdeleted) "
                  f"VALUES ({district}, {CLUB}, '2026-27', 'e2e-accounts dues', 0); SELECT LAST_INSERT_ID();")
    pay_id = one(f"INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_profile_id, fk_member_fee_id, FeeType, "
                 f"Amount, IsPaid, PaymentStatus, PaymentDate, isdeleted) VALUES ({dues_id}, {PLAIN}, 0, 1, 333.33, 1, 'PAID', "
                 f"UTC_TIMESTAMP(), 0); SELECT LAST_INSERT_ID();")
    s, summ = call("GET", B + "/summary", t_admin)
    check("summary loads", s == 200 and summ["yearLabel"], summ)
    q = f"FROM acct_journal_entries WHERE fk_club_id={CLUB} AND source_type='membership_dues_payment' AND source_id='{pay_id}'"
    check("paid dues posted automatically", one("SELECT COUNT(*) " + q) == 1)
    call("GET", B + "/summary", t_admin)
    check("posting is idempotent", one("SELECT COUNT(*) " + q) == 1)
    dues_entry = one("SELECT pk_entry_id " + q)
    s, de = call("GET", f"{B}/journal/{dues_entry}", t_admin)
    check("dues entry credits Membership dues 333.33",
          s == 200 and any(l["code"] == "4000" and l["credit"] == 333.33 for l in de["lines"]), de)
    sql(f"UPDATE membership_dues_payments SET isdeleted=1 WHERE pk_id={pay_id}")
    call("GET", B + "/summary", t_admin)
    check("deleted dues payment is reversed", one(f"SELECT COUNT(*) FROM acct_journal_entries WHERE reverses_entry_id={dues_entry}") == 1)

    # ── Reports ─────────────────────────────────────────────────────────────────────────────────────────────────
    s, accts = call("GET", B, t_admin)
    bank_now = {a["code"]: a for a in accts}["1000"]["balance"]
    check("bank balance = before + 500 + 1000 (dinner and dues reversed)", round(bank_now - bank0, 2) == 1500.00, bank_now - bank0)
    s, pl = call("GET", f"{B}/reports/profit-loss?from={today}&to={today}", t_admin)
    inc = {l["code"]: l["amount"] for l in pl["income"]}
    check("P&L shows the donation, nets out the reversed items", s == 200 and inc.get("4100", 0) >= 500 and
          not any(l["code"] == "5100" and l["amount"] != 0 for l in pl["expenses"]), pl)
    s, bs = call("GET", f"{B}/reports/balance-sheet?asOf={today}", t_admin)
    check("balance sheet balances", s == 200 and bs["balanced"] and bs["totalAssets"] == bs["totalLiabilities"] + bs["totalEquity"], bs)

    s, r = call("PUT", f"{B}/budget/{year}", t_admin, {"lines": [{"accountId": donations, "amount": 400}, {"accountId": meals, "amount": 300}]})
    check("budget saved", s == 204, r)
    s, r = call("PUT", f"{B}/budget/{year}", t_admin, {"lines": [{"accountId": bank, "amount": 10}]})
    check("budget on an asset account refused", s == 400, r)
    s, bva = call("GET", f"{B}/reports/budget?yearId={year}", t_admin)
    lines = {l["code"]: l for l in bva["report"]["lines"]} if s == 200 else {}
    check("budget vs actual", s == 200 and lines.get("4100", {}).get("budget") == 400 and lines["4100"]["variance"] >= 100
          and lines.get("5100", {}).get("budget") == 300, bva)

    for fmt, sig in (("csv", b"\xef\xbb\xbf"), ("xlsx", b"PK"), ("pdf", b"%PDF")):
        for rep, qs in (("profit-loss", f"from={today}&to={today}"), ("balance-sheet", f"asOf={today}"),
                        ("budget", f"yearId={year}"), ("journal", f"from={today}&to={today}")):
            s, body = call("GET", f"{B}/export/{rep}?format={fmt}&{qs}", t_admin)
            check(f"export {rep} {fmt}", s == 200 and isinstance(body, bytes) and body.startswith(sig), (s, body[:80]))
    s, body = call("GET", f"{B}/export/profit-loss?format=csv&from={today}&to={today}", t_admin)
    check("CSV has totals", b"Total income" in body, body[:200])
    check("export by an ordinary member refused", call("GET", f"{B}/export/journal?format=csv", t_plain)[0] == 403)
    check("unknown export format refused", call("GET", f"{B}/export/journal?format=exe", t_admin)[0] == 400)

    # ── Vendors and payment voucher ─────────────────────────────────────────────────────────────────────────────
    s, ven = call("POST", B + "/vendors", t_admin, {"name": "e2e Caterers", "email": "accounts@example.org", "phone": "+94 11 000 0000"})
    check("payee created", s == 200 and ven["name"] == "e2e Caterers", ven)
    check("bad payee email refused", call("POST", B + "/vendors", t_admin, {"name": "X", "email": "not-an-email"})[0] == 400)
    check("ordinary member cannot list payees", call("GET", B + "/vendors", t_plain)[0] == 403)
    s, paid = call("POST", B + "/journal/quick", t_admin, {"kind": "out", "entryDate": today, "categoryAccountId": meals, "bankAccountId": bank,
                                                          "amount": 75.00, "memo": "e2e lunch", "vendorId": ven["id"], "reference": "CHQ 000123"})
    check("money out to a payee with a cheque number", s == 200 and paid["vendorName"] == "e2e Caterers" and paid["reference"] == "CHQ 000123", paid)
    s, r = call("POST", B + "/journal/quick", t_admin, {"kind": "out", "categoryAccountId": meals, "bankAccountId": bank, "amount": 1,
                                                       "memo": "x", "vendorId": 2147483000})
    check("payee of another club refused", s == 400, r)
    s, vs = call("GET", B + "/vendors", t_admin)
    check("payee shows what was paid this year", s == 200 and [v for v in vs if v["id"] == ven["id"]][0]["paidThisYear"] == 75, vs)
    s, pdf = call("GET", f"{B}/journal/{paid['id']}/voucher", t_admin)
    check("payment voucher PDF", s == 200 and isinstance(pdf, bytes) and pdf.startswith(b"%PDF"), (s, pdf[:60]))
    check("no voucher for money in", call("GET", f"{B}/journal/{e_in['id']}/voucher", t_admin)[0] == 400)
    check("another club cannot print this voucher", call("GET", f"/api/clubs/{other_club}/accounts/journal/{paid['id']}/voucher", t_other)[0] == 404)

    # ── Bank reconciliation ─────────────────────────────────────────────────────────────────────────────────────
    s, rec0 = call("GET", f"{B}/reconciliation/{bank}", t_admin)
    check("reconciliation loads", s == 200 and rec0["bookBalance"] == round(bank_now - 75, 2), rec0)
    check("reconciliation of an income account refused", call("GET", f"{B}/reconciliation/{donations}", t_admin)[0] == 400)
    csv_body = (f"Date,Description,Amount\r\n{today},DEPOSIT e2e donation,500.00\r\n{today},TRANSFER opening,\"1,000.00\"\r\n"
                f"{today},CHQ 000123,-75.00\r\n{today},Bank fee,-2.50\r\nnot-a-date,x,1\r\n").encode()
    b = "----e2e" + hashlib.sha1(csv_body).hexdigest()[:12]
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="statement.csv"\r\nContent-Type: text/csv\r\n\r\n').encode() + csv_body + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(f"{API}{B}/reconciliation/{bank}/import", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {t_admin}", "Content-Type": f"multipart/form-data; boundary={b}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        imp = json.loads(resp.read())
    check("statement CSV imported, bad line reported", imp["added"] == 4 and len(imp["problems"]) == 1, imp)
    s, am = call("POST", f"{B}/reconciliation/{bank}/auto-match", t_admin)
    check("auto-match pairs 500, 1000 and the cheque", s == 200 and am["matched"] == 3, am)
    s, rec = call("GET", f"{B}/reconciliation/{bank}", t_admin)
    fee_line = [x for x in rec["statement"] if x["description"] == "Bank fee"][0]
    check("reconciled balance and statement total", rec["reconciledBalance"] == 1425.00 and rec["statementTotal"] == 1422.50
          and rec["bookBalance"] - rec["reconciledBalance"] == rec["unreconciledBook"], rec)
    check("bank fee stays open", fee_line["journalLineId"] is None)
    any_open = rec["unmatchedBook"][0]["journalLineId"]
    check("wrong amount cannot be matched",
          call("POST", f"{B}/statement-lines/{fee_line['id']}/match", t_admin, {"journalLineId": any_open})[0] == 400)
    s, fee_entry = call("POST", B + "/journal/quick", t_admin, {"kind": "out", "entryDate": today, "categoryAccountId": by_code["5400"]["id"],
                                                               "bankAccountId": bank, "amount": 2.50, "memo": "e2e bank fee"})
    fee_book = [l for l in fee_entry["lines"] if l["accountId"] == bank][0]
    s, r = call("GET", f"{B}/reconciliation/{bank}", t_admin)
    fee_jl = [x for x in r["unmatchedBook"] if x["entryId"] == fee_entry["id"]][0]["journalLineId"]
    check("manual match", call("POST", f"{B}/statement-lines/{fee_line['id']}/match", t_admin, {"journalLineId": fee_jl})[0] == 204)
    s, r = call("POST", f"{B}/reconciliation/{bank}/lines", t_admin, {"lines": [{"lineDate": today, "description": "e2e duplicate", "amount": -2.50}]})
    dup = [x for x in call("GET", f"{B}/reconciliation/{bank}", t_admin)[1]["statement"] if x["description"] == "e2e duplicate"][0]
    check("a book line matches only one statement line",
          call("POST", f"{B}/statement-lines/{dup['id']}/match", t_admin, {"journalLineId": fee_jl})[0] == 400)
    check("another club cannot touch this statement line",
          call("POST", f"/api/clubs/{other_club}/accounts/statement-lines/{fee_line['id']}/unmatch", t_other)[0] == 404)
    check("reconciled line cannot be removed", call("DELETE", f"{B}/statement-lines/{fee_line['id']}", t_admin)[0] == 400)
    check("open line can be removed", call("DELETE", f"{B}/statement-lines/{dup['id']}", t_admin)[0] == 204)
    check("undo a match", call("POST", f"{B}/statement-lines/{fee_line['id']}/unmatch", t_admin)[0] == 204)
    s, rec2 = call("GET", f"{B}/reconciliation/{bank}", t_admin)
    check("after undo the fee is open again", rec2["reconciledBalance"] == 1425.00 and any(x["entryId"] == fee_entry["id"] for x in rec2["unmatchedBook"]), rec2)

    # ── Aged balances ───────────────────────────────────────────────────────────────────────────────────────────
    aged_dues = one(f"INSERT INTO membership_dues (fk_district_id, fk_club_id, RotaryYear, Purpose, IsFees1, IsActive, isdeleted, created_date) "
                    f"VALUES ({district}, {CLUB}, '2026-27', 'e2e-accounts aged', 1, 1, 0, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 DAY)); SELECT LAST_INSERT_ID();")
    sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount) VALUES ({aged_dues}, {PLAIN}, 200.00)")
    paid_fee = one(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount) "
                   f"VALUES ({aged_dues}, {ADMIN}, 200.00); SELECT LAST_INSERT_ID();")
    sql(f"INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_profile_id, fk_member_fee_id, FeeType, Amount, IsPaid, "
        f"PaymentStatus, PaymentDate, isdeleted) VALUES ({aged_dues}, {ADMIN}, {paid_fee}, 1, 200.00, 1, 'PAID', UTC_TIMESTAMP(), 0)")
    s, aged = call("GET", f"{B}/reports/aged?asOf={today}", t_admin)
    mine = [x for x in aged.get("rows", []) if x["memberId"] == PLAIN] if s == 200 else []
    check("unpaid annual dues 45 days old sit in 31-60", len(mine) == 1 and mine[0]["days31To60"] == 200 and mine[0]["total"] == 200, aged)
    check("paid member owes nothing", s == 200 and not any(x["memberId"] == ADMIN for x in aged["rows"]), aged)
    check("aged report refused to an ordinary member", call("GET", f"{B}/reports/aged", t_plain)[0] == 403)
    for fmt, sig in (("csv", b"\xef\xbb\xbf"), ("xlsx", b"PK"), ("pdf", b"%PDF")):
        s, body2 = call("GET", f"{B}/export/aged?format={fmt}&asOf={today}", t_admin)
        check(f"export aged {fmt}", s == 200 and isinstance(body2, bytes) and body2.startswith(sig), (s, body2[:80]))
finally:
    # ── Clean up ────────────────────────────────────────────────────────────────────────────────────────────────
    for c in (CLUB, other_club):
        if not had_books[c]:
            sql(f"DELETE l FROM acct_journal_lines l JOIN acct_journal_entries e ON e.pk_entry_id=l.fk_entry_id WHERE e.fk_club_id={c}")
            sql(f"DELETE FROM acct_journal_entries WHERE fk_club_id={c}")
            sql(f"DELETE FROM acct_budgets WHERE fk_club_id={c}")
            sql(f"DELETE FROM acct_statement_lines WHERE fk_club_id={c}")
            sql(f"DELETE FROM acct_vendors WHERE fk_club_id={c}")
            sql(f"DELETE FROM acct_accounts WHERE fk_club_id={c}")
        else:
            sql(f"DELETE l FROM acct_journal_lines l JOIN acct_journal_entries e ON e.pk_entry_id=l.fk_entry_id "
                f"WHERE e.fk_club_id={c} AND e.pk_entry_id>{start_entry}")
            sql(f"DELETE FROM acct_journal_entries WHERE fk_club_id={c} AND pk_entry_id>{start_entry}")
            sql(f"DELETE FROM acct_accounts WHERE fk_club_id={c} AND code IN ('1001','1002','1300')")
            sql(f"DELETE FROM acct_statement_lines WHERE fk_club_id={c} AND created_date >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) AND (description LIKE '%e2e%' OR description IN ('Bank fee','CHQ 000123','TRANSFER opening'))")
            sql(f"DELETE FROM acct_vendors WHERE fk_club_id={c} AND name='e2e Caterers'")
    for d in sql("SELECT pk_membership_dues_id FROM membership_dues WHERE Purpose LIKE 'e2e-accounts%'").split():
        sql(f"DELETE FROM membership_dues_payments WHERE fk_membership_dues_id={d}")
        sql(f"DELETE FROM membership_dues_member_fees WHERE fk_membership_dues_id={d}")
        sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id={d}")
    left = one("SELECT COUNT(*) FROM membership_dues WHERE Purpose LIKE 'e2e-accounts%'")
    check("cleanup removed the test rows", left == 0 and (had_books[CLUB] or one(f"SELECT COUNT(*) FROM acct_accounts WHERE fk_club_id={CLUB}") == 0))

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
