"""District and Club subscriptions (KIS/ROW/SUB/01): the access levels lock and unlock the API, buying and renewing
work through the simulated checkout, expiry locks without deleting anything, and the daily pass runs.

    python -I kb/tools/subscriptions_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET. The API must run with Subscriptions__Enforce=true and Payments__Provider=simulated.
Local copies only, never production: it writes subscriptions, orders and an RI officer row for one club and its
district, and removes them at the end. It waits about 35 seconds twice for the gate's cache.
"""
import base64, datetime, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
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


def locked(resp, code):
    st, body = resp
    return st == 403 and isinstance(body, dict) and body.get("code") == code


def gate_code(resp):
    st, body = resp
    return body.get("code") if st == 403 and isinstance(body, dict) else None



# A club Admin with an RI member id who holds no district-level or Super Admin role, and a second member of that club.
row = sql("""
    SELECT r.fk_member_master_profile_id, r.fk_club_id, c.fk_district_id, m.RotaryId
    FROM member_roles r
    JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
    JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_master_profile_id AND m.isdeleted = 0
    JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.fk_club_id = r.fk_club_id AND cm.IsActive = 1
    WHERE r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0 AND r.fk_club_id > 0 AND m.RotaryId REGEXP '^[0-9]+$'
      AND NOT EXISTS (SELECT 1 FROM member_roles s WHERE s.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND s.IsActive = 1 AND s.isdeleted = 0
                      AND (s.fk_role_id IN (3, 6) OR (s.fk_role_id = 2 AND IFNULL(s.fk_club_id, 0) = 0)))
      AND (SELECT COUNT(*) FROM club_members x WHERE x.fk_club_id = r.fk_club_id AND x.IsActive = 1 AND IFNULL(x.isdeleted, 0) = 0) > 1
    ORDER BY r.fk_club_id LIMIT 1""").split("\t")
exec_id, club, district, ri_id = (int(x) for x in row)
other_id = int(sql(f"""
    SELECT cm.fk_member_master_profile_id FROM club_members cm
    WHERE cm.fk_club_id = {club} AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0 AND cm.fk_member_master_profile_id <> {exec_id}
      AND NOT EXISTS (SELECT 1 FROM member_roles s WHERE s.fk_member_master_profile_id = cm.fk_member_master_profile_id
                      AND s.IsActive = 1 AND s.isdeleted = 0 AND s.fk_role_id IN (3, 6))
      AND NOT EXISTS (SELECT 1 FROM member_roles s WHERE s.fk_member_master_profile_id = cm.fk_member_master_profile_id
                      AND s.IsActive = 1 AND s.isdeleted = 0 AND s.fk_role_id = 2 AND IFNULL(s.fk_club_id, 0) = 0)
    LIMIT 1"""))
sa = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id "
         "WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 LIMIT 1")
SA, EXEC, OTHER = token(sa, "SuperAdmin"), token(exec_id, "Admin"), token(other_id, "Member")
print(f"club {club}, district {district}, executive {exec_id}, other member {other_id}")

prices_before = sql("SELECT CONCAT(kind, ':', amount, ':', currency) FROM subscription_prices")


def cleanup():
    sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id = {district} AND fk_club_id IN (0, {club})")
    sql(f"DELETE FROM subscription_orders WHERE fk_district_id = {district}")
    sql(f"DELETE FROM ri_club_officers WHERE fk_club_id = {club} AND ri_member_id = {ri_id} AND officer_role = 'Club Secretary'")
    sql(f"DELETE FROM event_payment_links WHERE fk_club_id = {club} AND Title = 'e2e subscriptions'")


def wait_cache():
    time.sleep(35)  # the gate caches each club, district and seat for 30 seconds


cleanup()
today = datetime.date.today()
ry_start = datetime.date(today.year if today.month >= 7 else today.year - 1, 7, 1)
ry_end = datetime.date(ry_start.year + 1, 6, 30)
# The executive is on record with RI before anything is cached for them.
sql(f"INSERT INTO ri_club_officers (fk_club_id, ri_member_id, officer_role, start_date, end_date, first_name, last_name) "
    f"VALUES ({club}, {ri_id}, 'Club Secretary', '{ry_start}', '{ry_end}', 'E2E', 'Secretary')")
# A payment link of the club: its route names the link, not the club, so only the scope check can lock it.
link = sql(f"INSERT INTO event_payment_links (fk_club_id, Title) VALUES ({club}, 'e2e subscriptions'); SELECT LAST_INSERT_ID()")
roles_before = sql(f"SELECT COUNT(*) FROM member_roles WHERE fk_club_id = {club} AND IsActive = 1 AND isdeleted = 0")
wait_cache()  # whatever an earlier run left in the cache

try:
    # prices: Super Admin only, and the buyer never names the amount
    st, _ = call("PUT", "/api/subscriptions/prices/club", EXEC, {"amount": 1, "currency": "USD"})
    check("prices: a club admin cannot set them", st == 403)
    st, _ = call("PUT", "/api/subscriptions/prices/club", SA, {"amount": 120, "currency": "usd"})
    st2, _ = call("PUT", "/api/subscriptions/prices/district", SA, {"amount": 900, "currency": "USD"})
    check("prices: Super Admin sets club and district", st == 200 and st2 == 200)

    # None: neither subscription
    st, s = call("GET", f"/api/subscriptions/club/{club}", EXEC)
    check("none: status says None, enforced, executive may buy", st == 200 and s["level"] == "None" and s["enforced"] and s["canBuy"], str(s)[:200])
    check("none: the club area is closed, even for an executive", locked(call("GET", f"/api/clubs/{club}/projects", EXEC), "subscription_required"))
    check("none: the club dashboard is closed", locked(call("GET", f"/api/club-admin-dashboard/overview?clubId={club}", EXEC), "subscription_required"))
    check("none: a route naming the club in the query is closed too", locked(call("GET", f"/api/goal-setting/clubs/1?clubId={club}", EXEC), "subscription_required"))
    check("none: Super Admin is never locked", gate_code(call("GET", f"/api/clubs/{club}/projects", SA)) is None)
    check("none: the member app is closed", locked(call("GET", "/api/mobile/notifications", OTHER), "app_subscription_required"))

    # Reporting: the district subscribes (offline, activated by Kaizen)
    st, r = call("POST", "/api/subscriptions/activate-offline", SA, {"kind": "district", "districtId": district, "clubId": 0, "amount": 900, "currency": "USD"})
    check("district: offline activation", st == 200 and r.get("orderId", 0) > 0, str(r)[:200])
    st, d = call("GET", f"/api/subscriptions/district/{district}", SA)
    check("district: active for one year, clubs flagged to the district", st == 200 and d["state"] == "Active" and isinstance(d["flaggedClubs"], list), str(d)[:200])
    st, s = call("GET", f"/api/subscriptions/club/{club}", EXEC)
    check("reporting: the club is at Reporting", st == 200 and s["level"] == "Reporting", str(s)[:200])
    check("reporting: an executive opens projects", gate_code(call("GET", f"/api/clubs/{club}/projects", EXEC)) is None)
    check("reporting: an executive opens the dashboard overview", gate_code(call("GET", f"/api/club-admin-dashboard/overview?clubId={club}", EXEC)) is None)
    check("reporting: newsletters need the Club subscription", locked(call("GET", f"/api/clubs/{club}/newsletters", EXEC), "club_subscription_required"))
    check("reporting: dashboard communication needs the Club subscription", locked(call("GET", f"/api/club-admin-dashboard/communication?clubId={club}", EXEC), "club_subscription_required"))
    check("reporting: club goals (club id in the query) are open", gate_code(call("GET", f"/api/goal-setting/clubs/1?clubId={club}", EXEC)) is None)
    check("reporting: the email log (club id in the route) needs the Club subscription", locked(call("GET", f"/api/email-log/club/{club}", EXEC), "club_subscription_required"))
    check("reporting: the member list is view only", locked(call("POST", f"/api/clubs/{club}/members", EXEC, {}), "club_subscription_required"))
    check("reporting: a club feature that names no club (a payment link by its id) is closed", call("GET", f"/api/event-payment-links/{link}", EXEC)[0] == 403)
    check("reporting: a wallet order with the club id only in the body is closed", locked(call("POST", "/api/wallet/create-order", EXEC, {"scope": "club", "clubId": club, "districtId": 0, "creditType": "email", "amount": 10}), "club_subscription_required"))
    check("reporting: the email log with no club named is closed", locked(call("GET", "/api/email-log/summary", EXEC), "club_subscription_required"))
    chat = call("GET", "/api/chat/conversations", EXEC)  # 404 while the chat feature is switched off
    check(f"reporting: chat needs the Club subscription (answered {chat[0]})", chat[0] == 404 or locked(chat, "club_subscription_required"), str(chat)[:200])
    check("reporting: another club member is refused", locked(call("GET", f"/api/clubs/{club}/projects", OTHER), "executives_only"))
    check("reporting: the member app stays closed", locked(call("GET", "/api/mobile/notifications", OTHER), "app_subscription_required"))

    # Full: an executive buys the Club subscription through the checkout
    st, _ = call("POST", "/api/subscriptions/orders", OTHER, {"kind": "club", "districtId": 0, "clubId": club, "returnPath": "/club-admin-dashboard/subscription"})
    check("buy: a member who is not an executive is refused", st == 403)
    st, o = call("POST", "/api/subscriptions/orders", EXEC, {"kind": "club", "districtId": 0, "clubId": club, "returnPath": "/club-admin-dashboard/subscription"})
    ok = st == 200 and o["amount"] == 120 and o["currency"] == "USD" and not o["isRenewal"] and o.get("checkout")
    check("buy: an executive gets a checkout at the server's price", bool(ok), str(o)[:240])
    if ok:
        st, v = call("POST", f"/api/public/payments/checkout/{o['checkout']['token']}/simulate", None, {"outcome": "failed"})
        st, s = call("GET", f"/api/subscriptions/club/{club}", EXEC)
        check("buy: a failed payment changes nothing", s["level"] == "Reporting")
        st, o = call("POST", "/api/subscriptions/orders", EXEC, {"kind": "club", "districtId": 0, "clubId": club, "returnPath": "/club-admin-dashboard/subscription"})
        call("POST", f"/api/public/payments/checkout/{o['checkout']['token']}/simulate", None, {"outcome": "paid"})
        st, s = call("GET", f"/api/subscriptions/club/{club}", EXEC)
        check("buy: paid, the club is Full straight away", s["level"] == "Full" and s["clubSubscription"]["state"] == "Active", str(s)[:200])
        first_end = s["clubSubscription"]["termEnd"][:10]
        check("full: newsletters open without waiting", gate_code(call("GET", f"/api/clubs/{club}/newsletters", EXEC)) is None)
        check("full: the payment link opens by its id", call("GET", f"/api/event-payment-links/{link}", EXEC)[0] == 200)
        check("full: chat is not locked", gate_code(call("GET", "/api/chat/conversations", EXEC)) is None)
        check("full: the email log with no club named is not locked", gate_code(call("GET", "/api/email-log/summary", EXEC)) is None)
        check("full: other members get in", gate_code(call("GET", f"/api/clubs/{club}/projects", OTHER)) is None)
        check("full: the member app opens", gate_code(call("GET", "/api/mobile/notifications", OTHER)) is None)
        st, order = call("GET", f"/api/subscriptions/orders/{o['orderId']}", OTHER)
        check("orders: another member cannot read the buyer's order", st == 404)

        # paying again while active is a renewal: one more year on the end of the term
        st, o2 = call("POST", "/api/subscriptions/orders", EXEC, {"kind": "club", "districtId": 0, "clubId": club, "returnPath": "/x"})
        call("POST", f"/api/public/payments/checkout/{o2['checkout']['token']}/simulate", None, {"outcome": "paid"})
        call("POST", f"/api/public/payments/checkout/{o2['checkout']['token']}/simulate", None, {"outcome": "paid"})  # a repeat adds nothing
        st, s = call("GET", f"/api/subscriptions/club/{club}", EXEC)
        second_end = s["clubSubscription"]["termEnd"][:10]
        want = datetime.date.fromisoformat(first_end)
        want = want.replace(year=want.year + 1)
        check("renew: marked as a renewal, one year added once", o2["isRenewal"] and second_end == str(want), f"{first_end} -> {second_end}")

    # expiry: grace keeps everything working, then the club drops to Reporting, then to None with the district
    sql(f"UPDATE tenant_subscriptions SET term_end = UTC_DATE() - INTERVAL 10 DAY WHERE fk_club_id = {club}")
    wait_cache()
    st, s = call("GET", f"/api/subscriptions/club/{club}", EXEC)
    check("grace: still Full ten days after the end", s["level"] == "Full" and s["clubSubscription"]["state"] == "Grace", str(s)[:200])
    check("grace: club features keep working", gate_code(call("GET", f"/api/clubs/{club}/newsletters", EXEC)) is None)
    sql(f"UPDATE tenant_subscriptions SET term_end = UTC_DATE() - INTERVAL 40 DAY WHERE fk_club_id = {club}")
    wait_cache()
    check("expired club: back to Reporting, club features lock", locked(call("GET", f"/api/clubs/{club}/newsletters", EXEC), "club_subscription_required"))
    check("expired club: reporting still works for the executive", gate_code(call("GET", f"/api/clubs/{club}/projects", EXEC)) is None)
    roles_after = sql(f"SELECT COUNT(*) FROM member_roles WHERE fk_club_id = {club} AND IsActive = 1 AND isdeleted = 0")
    check("expired club: no role was deleted or switched off", roles_after == roles_before, f"{roles_before} -> {roles_after}")

    # renewing later restores everything
    st, r = call("POST", "/api/subscriptions/activate-offline", SA, {"kind": "club", "districtId": 0, "clubId": club, "amount": 120, "currency": "USD"})
    st, s = call("GET", f"/api/subscriptions/club/{club}", EXEC)
    fresh = datetime.date.fromisoformat(s["clubSubscription"]["termEnd"][:10])
    check("renew after expiry: Full again, a fresh year from today", s["level"] == "Full" and 363 <= (fresh - today).days <= 366, str(s)[:200])
    check("renew after expiry: club features open at once", gate_code(call("GET", f"/api/clubs/{club}/newsletters", EXEC)) is None)

    # the daily pass: a reminder is due 7 days before the end; it must not fail when email or RI is unreachable.
    # Only the test club is left with access, so the pass reads one club from RI, not the whole district.
    sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id = {district} AND fk_club_id = 0")
    sql(f"UPDATE tenant_subscriptions SET term_end = UTC_DATE() + INTERVAL 7 DAY, renewal_notice_for = NULL WHERE fk_club_id = {club}")
    st, r = call("POST", "/api/subscriptions/run-daily", EXEC)
    check("daily: Super Admin only", st == 403)
    st, r = call("POST", "/api/subscriptions/run-daily", SA)
    check("daily: the pass runs", st == 200 and any("reminders" in x for x in r["done"]) and any("officer sync" in x for x in r["done"]), str(r)[:240])
finally:
    cleanup()
    for line in prices_before.splitlines():
        kind, amount, currency = line.split(":")
        sql(f"UPDATE subscription_prices SET amount = {amount}, currency = '{currency}' WHERE kind = '{kind}'")
    if not prices_before:
        sql("DELETE FROM subscription_prices")

print("FAILED" if fails else "ALL PASS", f"({fails} failures)" if fails else "")
sys.exit(1 if fails else 0)
