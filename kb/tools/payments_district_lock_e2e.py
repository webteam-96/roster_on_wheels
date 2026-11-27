"""Simulated payments stay inside Payments:SimulatedDistricts, and amounts are charged in their own currency.

    python -I kb/tools/payments_district_lock_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET. The API must run as Staging with Payments__Provider=simulated and
Payments__SimulatedDistricts=5656. Local copies only, never production: rows are tagged 'e2e-lock' and removed.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
ALLOWED = '5656'
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def signed(head, payload):
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    signing = f"{head}.{body}" if head else body
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    headers = {"Content-Type": "application/json", **({"Authorization": f"Bearer {tok}"} if tok else {})}
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
    fails += 0 if ok else 1


sa = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id "
         "WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 LIMIT 1")
SA = signed(b64(b'{"alg":"HS256","typ":"JWT"}'), {"memberId": sa, "name": "e2e", "email": "e2e@example.org", "roles": "SuperAdmin",
                                                "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900})
inside = sql(f"SELECT c.pk_club_id FROM club_master c JOIN district_master d ON d.pk_district_id=c.fk_district_id WHERE d.DistrictNumber='{ALLOWED}' "
             "AND c.isdeleted=0 AND c.IsActive=1 AND (SELECT COUNT(*) FROM club_members m WHERE m.fk_club_id=c.pk_club_id AND m.isdeleted=0)>0 ORDER BY c.pk_club_id LIMIT 1")
inside_district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={inside}")
outside = sql(f"SELECT c.pk_club_id FROM club_master c JOIN district_master d ON d.pk_district_id=c.fk_district_id WHERE d.DistrictNumber<>'{ALLOWED}' "
              "AND c.isdeleted=0 AND c.IsActive=1 ORDER BY c.pk_club_id LIMIT 1")
wallet, tokens, dues_id = [], [], None
renew_club = sql("SELECT w.fk_club_id FROM club_websites w JOIN club_master c ON c.pk_club_id=w.fk_club_id "
                 f"WHERE c.fk_district_id={inside_district} AND w.isdeleted=0 AND w.Status='Expired' LIMIT 1")
site_before = sql(f"SELECT CONCAT_WS('|', pk_id, Status, StartDate, EndDate, IsPurchased, IFNULL(AmountPaid,''), IFNULL(TransactionId,'')) FROM club_websites WHERE fk_club_id={renew_club} AND isdeleted=0") if renew_club else ""
site_price = None

try:
    body = lambda club: {"scope": "club", "clubId": int(club), "creditType": "Email", "amount": 5000, "returnPath": "/club-admin-dashboard/wallet"}
    st, o = call("POST", "/api/wallet/create-order", SA, body(outside))
    check("a club outside 5656 is refused", st == 400 and "not available" in str(o), f"{st} {o}"[:200])
    check("and gets no checkout session", sql(f"SELECT COUNT(*) FROM payment_checkout_sessions s JOIN wallet_topup_orders w ON w.pk_id=s.flow_ref WHERE s.flow='wallet' AND w.fk_club_id={outside} AND s.created_date > UTC_TIMESTAMP() - INTERVAL 5 MINUTE") == "0")

    st, o = call("POST", "/api/wallet/create-order", SA, body(inside))
    check("a club in 5656 gets a simulated checkout", st == 200 and o["checkout"]["gateway"] == "simulated", f"{st} {o}"[:200])
    wallet.append(o["topupOrderId"]); tokens.append(o["checkout"]["token"])

    # An open session whose order is moved outside the district can no longer be paid.
    sql(f"UPDATE wallet_topup_orders SET fk_district_id=(SELECT fk_district_id FROM club_master WHERE pk_club_id={outside}) WHERE pk_id={wallet[0]}")
    st, _ = call("POST", f"/api/public/payments/checkout/{tokens[0]}/simulate", None, {"outcome": "paid"})
    check("a session that is not in 5656 cannot be settled", st == 404 and sql(f"SELECT IsCredited FROM wallet_topup_orders WHERE pk_id={wallet[0]}") == "0", str(st))
    sql(f"UPDATE wallet_topup_orders SET fk_district_id={inside_district} WHERE pk_id={wallet[0]}")
    st, s = call("POST", f"/api/public/payments/checkout/{tokens[0]}/simulate", None, {"outcome": "paid"})
    check("the 5656 session settles and credits once", st == 200 and s["status"] == "paid" and sql(f"SELECT IsCredited FROM wallet_topup_orders WHERE pk_id={wallet[0]}") == "1")

    # District dues written in rupees are charged in rupees, not "the same number in dollars".
    if sql(f"SELECT COUNT(*) FROM club_dues WHERE fk_district_id={inside_district} AND RotaryYear='2027-28' AND isdeleted=0") == "0":
        dues_id = sql("INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, DefaultPerMemberRate, OnlineSurchargePercent, RateModel, ModeOfPayment, IsActive, isdeleted, Currency) "
                      f"VALUES ({inside_district},'2027-28','e2e-lock',500,0,0,1,1,0,'INR'); SELECT LAST_INSERT_ID()")
        tok = signed("", {"d": int(dues_id), "c": int(inside)})
        st, o = call("POST", f"/api/public/club-dues/{dues_id}/pay?token={tok}", None, {"fkClubId": int(inside)})
        check("district dues in INR: order created", st == 200 and o.get("checkout"), f"{st} {o}"[:240])
        if st == 200 and o.get("checkout"):
            tokens.append(o["checkout"]["token"])
            st, s = call("GET", f"/api/public/payments/checkout/{o['checkout']['token']}")
            check("district dues in INR: charged in INR", s["currency"] == "INR", str(s)[:160])
            check("thank-you page is told the currency", "currency=INR" in (s["returnUrl"] or ""), str(s["returnUrl"]))

    # Website renewal: charged in the platform currency, shown in the district's currency at the day's rate.
    if renew_club:
        year = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1")
        if sql(f"SELECT COUNT(*) FROM club_website_pricing WHERE fk_club_id={renew_club} AND fk_year_id={year}") == "0":
            site_price = sql(f"INSERT INTO club_website_pricing (fk_club_id, fk_year_id, BaseAmount, RenewalAmount, GstPercent, GatewayType) VALUES ({renew_club},{year},120,100,0,'normal'); SELECT LAST_INSERT_ID()")
        st, q = call("GET", f"/api/website-billing/quote?clubId={renew_club}", SA)
        check("website quote", st == 200, f"{st} {q}"[:200])
        st2, info = call("GET", "/api/districts/currency-rates", SA)
        check("rates are live and dated", st2 == 200 and info["base"] == "USD" and info["asOf"][:4] >= "2026", str(info)[:160])
        want = round(q["totalAmount"] / info["rates"]["INR"], 2)
        check("quote is charged in USD", q["currency"] == "USD", str(q)[:200])
        check("quote also shows rupees at that rate", q["localCurrency"] == "INR" and abs(q["localTotal"] - want) < 0.02, f"{q.get('localTotal')} / {want}")
        st, o = call("POST", "/api/website-billing/create-order", SA, {"clubId": int(renew_club), "returnPath": "/club-admin-dashboard/website-purchase"})
        check("website renewal order in 5656", st == 200 and o.get("checkout"), f"{st} {o}"[:240])
        if st == 200 and o.get("checkout"):
            tokens.append(o["checkout"]["token"])
            st, s = call("POST", f"/api/public/payments/checkout/{o['checkout']['token']}/simulate", None, {"outcome": "paid"})
            check("website renewal paid", st == 200 and s["status"] == "paid" and sql(f"SELECT PaymentStatus FROM club_website_orders WHERE pk_id={o['websiteOrderId']}") == "PAID", str(s)[:160])
            sql(f"DELETE FROM club_website_orders WHERE pk_id={o['websiteOrderId']}")

    # Settings > Currency: only districts still on the default change.
    before = sql("SELECT GROUP_CONCAT(CONCAT(pk_district_id,':',IFNULL(DefaultCurrency,'')) ORDER BY pk_district_id) FROM district_master WHERE isdeleted=0 AND DistrictNumber IN ('1030','2500','5000','5656','9101')")
    snapshot = sql("SELECT CONCAT(pk_district_id,'|',IFNULL(DefaultCurrency,'')) FROM district_master WHERE isdeleted=0").splitlines()
    chosen = sql("SELECT pk_district_id FROM district_master WHERE DistrictNumber='1040' AND isdeleted=0 LIMIT 1")
    sql(f"UPDATE district_master SET DefaultCurrency='EUR' WHERE pk_district_id={chosen}")
    st, r = call("POST", "/api/districts/default-currency/from-country", SA)
    got = dict(x.split('|') for x in sql("SELECT CONCAT(DistrictNumber,'|',DefaultCurrency) FROM district_master WHERE isdeleted=0 AND DistrictNumber IN ('1030','2500','5000','5656','9101','3590','1040','1800','4391')").splitlines())
    check("districts take their country's currency", st == 200 and r["changed"] > 300 and got.get('1030') == 'GBP' and got.get('2500') == 'JPY' and got.get('3590') == 'KRW'
          and got.get('1800') == 'EUR' and got.get('4391') == 'BRL' and got.get('9101') == 'LRD' and got.get('5000') == 'USD' and got.get('5656') == 'INR', f"{r} {got}")
    check("a currency someone chose stays", got.get('1040') == 'EUR', str(got))
    st, r = call("POST", "/api/districts/default-currency/from-country", SA)
    check("a second run changes nothing", st == 200 and r["changed"] == 0, str(r))
    st, _ = call("POST", "/api/districts/default-currency/from-country")
    check("signed out is refused", st == 401, str(st))
finally:
    def quiet(q):
        try:
            sql(q)
        except subprocess.CalledProcessError as e:
            print("cleanup problem:", e.stderr[:200])
    if 'snapshot' in globals():
        by = {}
        for line in snapshot:
            i, c = line.split('|')
            by.setdefault(c, []).append(i)
        for c, ids in by.items():
            quiet(f"UPDATE district_master SET DefaultCurrency={'NULL' if c == '' else repr(c)} WHERE pk_district_id IN ({','.join(ids)})")
        after = sql("SELECT GROUP_CONCAT(CONCAT(pk_district_id,':',IFNULL(DefaultCurrency,'')) ORDER BY pk_district_id) FROM district_master WHERE isdeleted=0 AND DistrictNumber IN ('1030','2500','5000','5656','9101')")
        check("cleanup: district currencies restored", after == before)
    for w in wallet:
        fk = sql(f"SELECT IFNULL(fk_credit_id,0) FROM wallet_topup_orders WHERE pk_id={w}")
        if fk != "0":
            quiet(f"DELETE FROM club_credits WHERE pk_credit_id={fk}")
        quiet(f"DELETE FROM wallet_topup_orders WHERE pk_id={w}")
    quiet(f"DELETE FROM wallet_topup_orders WHERE fk_club_id={outside} AND IsCredited=0 AND created_by={sa} AND created_date > NOW() - INTERVAL 10 MINUTE")
    if tokens:
        quiet("DELETE FROM payment_checkout_sessions WHERE session_token IN (" + ",".join(f"'{t}'" for t in tokens) + ")")
    if site_price:
        quiet(f"DELETE FROM club_website_pricing WHERE pk_id={site_price}")
    if dues_id:
        for t in ("club_dues_payments", "club_dues_members", "club_dues_clubs"):
            quiet(f"DELETE FROM {t} WHERE fk_club_dues_id={dues_id}")
        quiet(f"DELETE FROM club_dues WHERE pk_club_dues_id={dues_id}")
    if renew_club:
        after = sql(f"SELECT CONCAT_WS('|', pk_id, Status, StartDate, EndDate, IsPurchased, IFNULL(AmountPaid,''), IFNULL(TransactionId,'')) FROM club_websites WHERE fk_club_id={renew_club} AND isdeleted=0")
        print("website row unchanged by the test" if after == site_before else f"website row: {site_before} -> {after}")

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
