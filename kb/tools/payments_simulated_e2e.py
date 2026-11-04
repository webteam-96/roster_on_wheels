"""Simulated hosted checkout: each money flow settles through the gateway seam, a decline settles nothing, a repeat
changes nothing, and the session token is the only key.

    python -I kb/tools/payments_simulated_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET. The API must run with Payments__Provider=simulated. Local copies only, never
production: it creates temporary rows tagged 'e2e-pay' and removes them at the end.
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


def token(member_id, roles="SuperAdmin"):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
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
    if not ok:
        fails += 1


def simulate(tok_session, outcome):
    return call("POST", f"/api/public/payments/checkout/{tok_session}/simulate", None, {"outcome": outcome})


sa = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id "
         "WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 LIMIT 1")
SA = token(sa)
club = sql("SELECT c.pk_club_id FROM club_master c WHERE c.isdeleted=0 AND c.fk_district_id>0 ORDER BY c.pk_club_id LIMIT 1")
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
stranger = sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id<>{sa} "
               f"AND pk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE IsActive=1 AND isdeleted=0 AND fk_role_id<>0) LIMIT 1")
wallet_rows, website_rows, tokens, accounts = [], [], [], []

try:
    # Wallet: pay once, repeat changes nothing
    credits_before = sql(f"SELECT COUNT(*) FROM wallet_topup_orders WHERE fk_club_id={club} AND IsCredited=1")
    quote_min = 5000
    st, order = call("POST", "/api/wallet/create-order", SA,
                     {"scope": "club", "clubId": int(club), "creditType": "Email", "amount": quote_min, "returnPath": "/club-admin-dashboard/wallet"})
    check("wallet: order returns a redirect session", st == 200 and order.get("checkout", {}).get("kind") == "Redirect", str(order)[:200])
    wallet_rows.append(order["topupOrderId"])
    t = order["checkout"]["token"]
    tokens.append(t)
    check("wallet: session points at the simulated page", f"/pay/simulated/{t}" in order["checkout"]["redirectUrl"])
    st, s = call("GET", f"/api/public/payments/checkout/{t}")
    check("wallet: session amount comes from the server", st == 200 and float(s["amount"]) == float(order["totalAmount"]), str(s)[:200])
    check("wallet: session is open and marked simulated", s["status"] == "open" and s["simulated"] is True)
    check("wallet: return URL stays on the app", s["returnUrl"].endswith("/club-admin-dashboard/wallet"), str(s["returnUrl"]))
    st, v = call("POST", "/api/wallet/verify", SA, {"topupOrderId": order["topupOrderId"], "razorpayOrderId": order["razorpayOrderId"], "razorpayPaymentId": "", "razorpaySignature": ""})
    check("wallet: verify before paying does not credit", st == 200 and v["isSuccess"] is False, str(v)[:160])
    st, s = simulate(t, "paid")
    check("wallet: pay settles", st == 200 and s["status"] == "paid", str(s)[:160])
    check("wallet: row credited", sql(f"SELECT IsCredited FROM wallet_topup_orders WHERE pk_id={order['topupOrderId']}") == "1")
    fk_credit = sql(f"SELECT fk_credit_id FROM wallet_topup_orders WHERE pk_id={order['topupOrderId']}")
    st, v = call("POST", "/api/wallet/verify", SA, {"topupOrderId": order["topupOrderId"], "razorpayOrderId": order["razorpayOrderId"], "razorpayPaymentId": "", "razorpaySignature": ""})
    check("wallet: verify after paying reports success", st == 200 and v["isSuccess"] is True, str(v)[:160])
    st, s = simulate(t, "paid")
    check("wallet: repeat pay is harmless", st == 200 and s["status"] == "paid"
          and sql(f"SELECT fk_credit_id FROM wallet_topup_orders WHERE pk_id={order['topupOrderId']}") == fk_credit)
    st, s = simulate(t, "failed")
    check("wallet: a paid session cannot turn failed", st == 200 and s["status"] == "paid")

    # Decline and cancel settle nothing
    for outcome in ("failed", "cancelled"):
        st, order = call("POST", "/api/wallet/create-order", SA, {"scope": "club", "clubId": int(club), "creditType": "Email", "amount": quote_min})
        wallet_rows.append(order["topupOrderId"])
        t2 = order["checkout"]["token"]
        tokens.append(t2)
        st, s = simulate(t2, outcome)
        check(f"wallet: {outcome} recorded", st == 200 and s["status"] == outcome)
        check(f"wallet: {outcome} credits nothing", sql(f"SELECT IsCredited FROM wallet_topup_orders WHERE pk_id={order['topupOrderId']}") == "0")
        st, s = simulate(t2, "paid")
        check(f"wallet: {outcome} session cannot be paid later", s["status"] == outcome
              and sql(f"SELECT IsCredited FROM wallet_topup_orders WHERE pk_id={order['topupOrderId']}") == "0")

    # Input checks
    st, _ = simulate("0" * 64, "paid")
    check("unknown token 404", st == 404)
    st, _ = simulate(t, "free")
    check("unknown outcome 400", st == 400)
    st, order = call("POST", "/api/wallet/create-order", SA, {"scope": "club", "clubId": int(club), "creditType": "Email", "amount": quote_min, "returnPath": "//evil.example/x"})
    wallet_rows.append(order["topupOrderId"])
    tokens.append(order["checkout"]["token"])
    st, s = call("GET", f"/api/public/payments/checkout/{order['checkout']['token']}")
    check("off-site return path is dropped", s["returnUrl"] is None, str(s["returnUrl"]))
    sql(f"UPDATE payment_checkout_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE session_token='{order['checkout']['token']}'")
    st, s = simulate(order["checkout"]["token"], "paid")
    check("expired session cannot be paid", s["status"] == "open" and s["expired"] is True
          and sql(f"SELECT IsCredited FROM wallet_topup_orders WHERE pk_id={order['topupOrderId']}") == "0")

    # Payment accounts (was 404 on /payment-accounts)
    st, cov = call("GET", f"/api/payments/coverage?ownerType=club&ownerId={club}", SA)
    check("coverage lists the simulated gateway", st == 200 and cov["gateways"] == ["simulated"], str(cov)[:160])
    st, a = call("POST", "/api/payments/accounts", SA, {"ownerType": "club", "ownerId": int(club), "gateway": "simulated", "displayName": "e2e-pay", "currency": "USD"})
    check("connect simulated account", st == 200 and a["gateway"] == "simulated", str(a)[:160])
    accounts.append(a["id"])
    st, x = call("POST", "/api/payments/accounts", SA, {"ownerType": "club", "ownerId": int(club), "gateway": "stripe", "displayName": "e2e-pay", "currency": "USD"})
    check("stripe refused until it is built", st == 400)
    st, x = call("POST", f"/api/payments/accounts/{a['id']}/verify", SA)
    check("verify sets the date", st == 200 and x["verifiedAt"])
    st, x = call("PUT", f"/api/payments/accounts/{a['id']}/active", SA, {"isActive": False})
    check("deactivate", st == 200 and x["isActive"] is False)
    st, lst = call("GET", f"/api/payments/accounts?ownerType=club&ownerId={club}", SA)
    check("list shows it", st == 200 and any(r["id"] == a["id"] for r in lst))
    if stranger:
        M = token(stranger, "Member")
        st, _ = call("GET", f"/api/payments/accounts?ownerType=club&ownerId={club}", M)
        check("another member cannot list (IDOR)", st == 403, str(st))
        st, _ = call("POST", f"/api/payments/accounts/{a['id']}/verify", M)
        check("another member cannot verify (IDOR)", st == 404, str(st))
    st, _ = call("GET", f"/api/payments/accounts?ownerType=club&ownerId={club}")
    check("sign-in required", st == 401, str(st))

    st, r = call("POST", "/api/payments/accounts", SA, {"ownerType": "district", "ownerId": int(district), "gateway": "simulated", "displayName": "e2e-pay", "currency": "USD"})
    check("district account", st == 200, str(r)[:120])
    accounts.append(r["id"])

    member = stranger

    # Membership dues: order, thank-you read, settlement report rows
    md = sql(f"INSERT INTO membership_dues (fk_club_id, fk_district_id, RotaryYear, Purpose, OnlineSurchargePercent, IsActive, isdeleted) VALUES ({club},{district},'2026-27','e2e-pay',0,1,0); SELECT LAST_INSERT_ID();")
    fee = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount, isdeleted) VALUES ({md},{member},120,60,60,0); SELECT LAST_INSERT_ID();")
    st, o = call("POST", f"/api/public/membership-dues/{md}/pay", None, {"fkMemberProfileId": int(member), "feeType": 1})
    check("membership dues: order returns a session", st == 200 and o.get("checkout"), str(o)[:200])
    tokens.append(o["checkout"]["token"])
    st, v = call("GET", f"/api/public/membership-dues/{md}/verify-payment?orderId={o['orderId']}&paymentId={o['paymentId']}")
    check("membership dues: not paid before the simulator", st == 200 and v["isSuccess"] is False, str(v)[:160])
    st, s = simulate(o["checkout"]["token"], "paid")
    check("membership dues: pay settles", st == 200 and sql(f"SELECT IsPaid FROM membership_dues_payments WHERE pk_id={o['paymentId']}") == "1", str(s)[:160])
    st, v = call("GET", f"/api/public/membership-dues/{md}/verify-payment?orderId={o['orderId']}&paymentId={o['paymentId']}")
    check("membership dues: thank-you shows paid and the amount", st == 200 and v["isSuccess"] is True and float(v["amount"]) == 120, str(v)[:160])
    st, v = call("GET", f"/api/public/membership-dues/{md}/verify-payment?orderId=WRONG&paymentId={o['paymentId']}")
    check("membership dues: wrong order id reads nothing", v["isSuccess"] is False)
    st, _ = call("POST", f"/api/membership-dues/{md}/settlement-refresh", SA)
    st2, _ = call("POST", f"/api/membership-dues/{md}/settlement-refresh", SA)
    rows = sql(f"SELECT COUNT(*), SUM(Amount) FROM membership_dues_settlements WHERE fk_payment_id={o['paymentId']}")
    check("membership dues: settlement rows, once", st == 200 and st2 == 200 and rows == "1\t120.00", rows)
    st, o2 = call("POST", f"/api/public/membership-dues/{md}/pay", None, {"fkMemberProfileId": int(member), "feeType": 1})
    check("membership dues: cannot pay twice", st >= 400, str(o2)[:120])

    # Event payment link
    ev = sql(f"INSERT INTO event_payment_links (Title, fk_club_id, IsActive, isdeleted) VALUES ('e2e-pay',{club},1,0); SELECT LAST_INSERT_ID();")
    reg = sql(f"INSERT INTO event_payment_registrations (fk_payment_link_id, RegistrationName, Amount) VALUES ({ev},'e2e-pay',75); SELECT LAST_INSERT_ID();")
    body = {"memberName": "e2e-pay", "mobile": "5550100", "email": "e2e@example.org", "fkRegistrationId": int(reg)}
    st, o = call("POST", f"/api/public/event-payment/{ev}/create-order", None, body)
    check("event link: order returns a session", st == 200 and o.get("checkout"), str(o)[:200])
    tokens.append(o["checkout"]["token"])
    mp = o["memberPaymentId"]
    st, s = simulate(o["checkout"]["token"], "failed")
    check("event link: decline leaves it unpaid", sql(f"SELECT IsPaid FROM event_payment_members WHERE pk_id={mp}") == "0")
    st, o = call("POST", f"/api/public/event-payment/{ev}/create-order", None, body)
    check("event link: retry after a decline works", st == 200 and o.get("checkout") and o["memberPaymentId"] == mp, str(o)[:200])
    tokens.append(o["checkout"]["token"])
    st, s = simulate(o["checkout"]["token"], "paid")
    check("event link: pay settles", st == 200 and sql(f"SELECT IsPaid FROM event_payment_members WHERE pk_id={mp}") == "1", str(s)[:160])
    st, v = call("GET", f"/api/public/event-payment/{ev}/verify-payment?orderId={o['orderId']}&memberPaymentId={mp}")
    check("event link: thank-you shows paid", st == 200 and v["isSuccess"] is True and float(v["amount"]) == 75, str(v)[:160])
    st, _ = call("POST", f"/api/event-payment-links/{ev}/settlement-refresh", SA)
    check("event link: settlement row", sql(f"SELECT COUNT(*) FROM event_payment_settlements WHERE fk_member_payment_id={mp}") == "1", str(st))

    # Club dues and website: settlement through the same dispatcher
    cd = sql(f"INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, IsActive, isdeleted) VALUES ({district},'2026-27','e2e-pay',1,0); SELECT LAST_INSERT_ID();")
    cdp = sql(f"INSERT INTO club_dues_payments (fk_club_dues_id, fk_club_id, Amount, MemberCountCovered, IsPaid, IsOnline, PaymentStatus, created_date) VALUES ({cd},{club},300,0,0,1,'ACTIVE',NOW()); SELECT LAST_INSERT_ID();")
    wo = sql(f"INSERT INTO club_website_orders (fk_club_id, fk_district_id, OrderType, Subdomain, BaseAmount, TotalAmount, Currency, PaymentStatus, IsProvisioned, created_by, created_date, isdeleted) VALUES ({club},{district},'New','e2e-pay',10,10,'USD','ACTIVE',0,{sa},NOW(),0); SELECT LAST_INSERT_ID();")
    for flow, ref, table_check in (("club_dues", cdp, f"SELECT IsPaid FROM club_dues_payments WHERE pk_club_dues_payment_id={cdp}"),
                                   ("website", wo, f"SELECT PaymentStatus='PAID' FROM club_website_orders WHERE pk_id={wo}")):
        tk = hashlib.sha256(f"e2e-{flow}-{time.time()}".encode()).hexdigest()
        tokens.append(tk)
        sql(f"INSERT INTO payment_checkout_sessions (session_token, gateway, flow, flow_ref, merchant_order_id, amount, currency, description, status, expires_at, created_date) "
            f"VALUES ('{tk}','simulated','{flow}',{ref},'e2e-{flow}-{ref}',10,'USD','e2e-pay','open',DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR),UTC_TIMESTAMP())")
        st, s = simulate(tk, "paid")
        check(f"{flow}: pay settles", st == 200 and sql(table_check) == "1", str(s)[:200])

    # Real pricing: amounts come from the price tables and member counts, tax from Payments:TaxPercent (default 0)
    st, q = call("GET", "/api/wallet/quote?creditType=Email&amount=1000", SA)
    check("wallet quote: no built-in tax", st == 200 and float(q["gstAmount"]) == 0 and float(q["totalAmount"]) == 1000, str(q)[:160])
    site_club = sql("SELECT c.pk_club_id FROM club_master c WHERE c.isdeleted=0 AND c.fk_district_id>0 "
                    "AND c.pk_club_id NOT IN (SELECT fk_club_id FROM club_websites) ORDER BY c.pk_club_id LIMIT 1")
    st, q = call("GET", f"/api/website-billing/quote?clubId={site_club}", SA)
    check("website quote: price with no built-in tax", st == 200 and float(q["gstAmount"]) == 0 and float(q["totalAmount"]) == float(q["baseAmount"]) > 0, str(q)[:200])
    st, o = call("POST", "/api/website-billing/create-order", SA, {"clubId": int(site_club), "subdomainInput": "e2epayreal", "reminderDays": 15, "returnPath": "/club-admin-dashboard/website-purchase"})
    check("website order: created at the quoted price", st == 200 and float(o["totalAmount"]) == float(q["totalAmount"]), str(o)[:200])
    if st == 200:
        tokens.append(o["checkout"]["token"])
        real_site_order = o["websiteOrderId"]
        st, s2 = simulate(o["checkout"]["token"], "paid")
        check("website order: session charges the quoted price", st == 200 and float(s2["amount"]) == float(q["totalAmount"]), str(s2)[:160])
        check("website order: paid", sql(f"SELECT PaymentStatus FROM club_website_orders WHERE pk_id={real_site_order}") == "PAID")
    dues_club = sql("SELECT m.fk_club_id FROM club_members m JOIN club_master c ON c.pk_club_id=m.fk_club_id "
                    "WHERE m.isdeleted=0 AND c.isdeleted=0 AND c.fk_district_id>0 GROUP BY m.fk_club_id HAVING COUNT(*)>=5 ORDER BY m.fk_club_id LIMIT 1")
    dues_district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={dues_club}")
    dues = sql(f"INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, DefaultPerMemberRate, OnlineSurchargePercent, RateModel, ModeOfPayment, IsActive, isdeleted) "
               f"VALUES ({dues_district},'2026-27','e2e-pay',5,10,0,1,1,0); SELECT LAST_INSERT_ID()")
    payload = b64(json.dumps({"d": int(dues), "c": int(dues_club)}, separators=(",", ":")).encode())
    pay_token = payload + "." + b64(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    st, o = call("POST", f"/api/public/club-dues/{dues}/pay?token={pay_token}", None, {"fkClubId": int(dues_club)})
    check("club dues: order created", st == 200 and o.get("checkout"), str(o)[:240])
    if st == 200 and o.get("checkout"):
        tokens.append(o["checkout"]["token"])
        unpaid = int(sql(f"SELECT COUNT(*) FROM club_dues_members WHERE fk_club_dues_id={dues} AND fk_club_id={dues_club} AND isdeleted=0 AND IsHonorary=0"))
        expected = round(unpaid * 5.5, 2)
        st, s2 = simulate(o["checkout"]["token"], "paid")
        check(f"club dues: charged members x rate + online surcharge ({unpaid} x 5.50)", st == 200 and unpaid > 0 and float(s2["amount"]) == expected, str(s2)[:160])
        check("club dues: payment settled", sql(f"SELECT COUNT(*) FROM club_dues_payments WHERE fk_club_dues_id={dues} AND IsPaid=1") == "1")
        check("club dues: members marked paid", sql(f"SELECT COUNT(*) FROM club_dues_members WHERE fk_club_dues_id={dues} AND fk_club_id={dues_club} AND isdeleted=0 AND IsHonorary=0 AND IsPaid=1") == str(unpaid))

    # Vendor accounts work without a gateway
    sql("INSERT INTO cashfree_otp (otp_code, purpose, is_used, expiry_date, created_date) VALUES ('914273','CASHFREE_KYC',0,DATE_ADD(NOW(), INTERVAL 5 MINUTE),NOW())")
    st, k = call("POST", "/api/cashfree-kyc/verify-and-save", SA, {"otp": "914273", "vendorId": "e2epay1", "email": "e2e@example.org", "phone": "5550100", "accountHolder": "e2e-pay", "accountNumber": "000123456789", "ifsc": "E2EP0000001", "name": "e2e-pay", "pan": "AAAAA0000A"})
    check("vendor account saved locally", st == 200 and sql("SELECT status FROM cashfree_kyc WHERE vendor_id='e2epay1'") == "ACTIVE", str(k)[:200])
finally:
    def quiet(q):
        try:
            sql(q)
        except subprocess.CalledProcessError as e:
            print("cleanup problem:", e.stderr[:200])
    if accounts:
        quiet(f"DELETE FROM payment_accounts WHERE pk_id IN ({','.join(map(str, accounts))})")
    if tokens:
        quiet("DELETE FROM payment_checkout_sessions WHERE session_token IN (" + ",".join(f"'{t}'" for t in tokens) + ")")
    for w in wallet_rows:
        fk = sql(f"SELECT IFNULL(fk_credit_id,0) FROM wallet_topup_orders WHERE pk_id={w}")
        if fk != "0":
            quiet(f"DELETE FROM club_credits WHERE pk_credit_id={fk}")
        quiet(f"DELETE FROM wallet_topup_orders WHERE pk_id={w}")
    quiet("DELETE s FROM membership_dues_settlements s JOIN membership_dues d ON d.pk_membership_dues_id=s.fk_membership_dues_id WHERE d.Purpose='e2e-pay'")
    quiet("DELETE p FROM membership_dues_payments p JOIN membership_dues d ON d.pk_membership_dues_id=p.fk_membership_dues_id WHERE d.Purpose='e2e-pay'")
    quiet("DELETE f FROM membership_dues_member_fees f JOIN membership_dues d ON d.pk_membership_dues_id=f.fk_membership_dues_id WHERE d.Purpose='e2e-pay'")
    quiet("DELETE FROM membership_dues WHERE Purpose='e2e-pay'")
    quiet("DELETE s FROM event_payment_settlements s JOIN event_payment_links l ON l.pk_id=s.fk_payment_link_id WHERE l.Title='e2e-pay'")
    quiet("DELETE m FROM event_payment_members m JOIN event_payment_links l ON l.pk_id=m.fk_payment_link_id WHERE l.Title='e2e-pay'")
    quiet("DELETE r FROM event_payment_registrations r JOIN event_payment_links l ON l.pk_id=r.fk_payment_link_id WHERE l.Title='e2e-pay'")
    quiet("DELETE FROM event_payment_links WHERE Title='e2e-pay'")
    quiet("DELETE p FROM club_dues_payments p JOIN club_dues d ON d.pk_club_dues_id=p.fk_club_dues_id WHERE d.Purpose='e2e-pay'")
    quiet("DELETE ap FROM club_dues_member_account_payments ap JOIN club_dues_members m ON m.pk_club_dues_member_id=ap.fk_club_dues_member_id JOIN club_dues d ON d.pk_club_dues_id=m.fk_club_dues_id WHERE d.Purpose='e2e-pay'")
    quiet("DELETE m FROM club_dues_members m JOIN club_dues d ON d.pk_club_dues_id=m.fk_club_dues_id WHERE d.Purpose='e2e-pay'")
    quiet("DELETE x FROM club_dues_clubs x JOIN club_dues d ON d.pk_club_dues_id=x.fk_club_dues_id WHERE d.Purpose='e2e-pay'")
    quiet("DELETE FROM club_dues WHERE Purpose='e2e-pay'")
    quiet("DELETE FROM club_website_orders WHERE Subdomain='e2e-pay' OR Subdomain LIKE '%e2epayreal%'")
    quiet("DELETE FROM club_websites WHERE Subdomain='e2e-pay' OR Subdomain LIKE '%e2epayreal%'")
    quiet("DELETE FROM cashfree_kyc WHERE vendor_id='e2epay1'")

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
