"""Public dues and event payment routes (P0, 2026-11-05): reports need a manager; the pay page's member search needs the
link's key and answers id and name only; a member's dues status needs the token verify-otp issues; the code goes only to
the email on the member's record.

    python -I kb/tools/public_dues_guard_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET. Local copies only, never production. Adds one dues campaign and one event link
(titled 'e2e-guard') and removes them at the end. Sends at most one email, to the member's own address: point the API
at a fake Brevo or leave the key unset.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
ATTACKER = "attacker@example.invalid"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def post_form(path, fields, payer=None):
    boundary = "e2eguardboundary"
    data = "".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields.items()) + f"--{boundary}--\r\n"
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if payer:
        headers["X-Payer-Token"] = payer
    req = urllib.request.Request(API + path, data=data.encode(), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def call(method, path, tok=None, body=None, payer=None):
    headers = {"Content-Type": "application/json"}
    if payer:
        headers["X-Payer-Token"] = payer
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, raw


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:200]}"))
    fails += 0 if ok else 1


club, member = sql("""SELECT cm.fk_club_id, cm.fk_member_master_profile_id FROM club_members cm
    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
    WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember, 0) = 0
      AND m.EmailId LIKE '%@%' AND CHAR_LENGTH(m.MemberName) >= 4 LIMIT 1""").split()
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {club}")
name, email = sql(f"SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = {member}").split("\t")
SA = token(1, "SuperAdmin")
OUTSIDER = token(999999, "Admin")
md = ev = cd = guest = None
role_added = False
try:
    # District dues report: Super Admin and the campaign's district admins only. Another club's admin holds "Admin" too.
    cd = sql(f"INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, IsActive, isdeleted) VALUES ({district},'2026-27','e2e-guard',1,0); SELECT LAST_INSERT_ID();")
    other_club = sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id <> {district} AND isdeleted = 0 LIMIT 1")
    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted) VALUES ({member}, 2, {other_club}, 1, 0)")
    role_added = True
    other_club_admin = member
    path = f"/api/club-dues/{cd}/report"
    st, _ = call("GET", path)
    check(f"{path}: anonymous is refused", st == 401, st)
    st, _ = call("GET", path, token(other_club_admin, "Admin"))
    check(f"{path}: another club's admin is refused", st == 403, st)
    st, _ = call("GET", path, SA)
    check(f"{path}: SuperAdmin reads it", st == 200, st)
    st, _ = call("GET", f"/api/public/club-dues/{cd}/report")
    check(f"/api/public/club-dues/{cd}/report: the anonymous route is gone", st == 404, st)

    md = sql(f"INSERT INTO membership_dues (fk_club_id, fk_district_id, RotaryYear, Purpose, OnlineSurchargePercent, IsActive, isdeleted) "
             f"VALUES ({club},{district},'2026-27','e2e-guard',0,1,0); SELECT LAST_INSERT_ID();")
    ev = sql(f"INSERT INTO event_payment_links (Title, fk_club_id, IsActive, isdeleted) VALUES ('e2e-guard',{club},1,0); SELECT LAST_INSERT_ID();")
    sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount) "
        f"VALUES ({md},{member},100,0,0)")

    # Reports: signed-in managers only; the old anonymous routes are gone.
    for path in (f"/api/membership-dues/{md}/report", f"/api/membership-dues/{md}/export", f"/api/event-payment-links/{ev}/report"):
        st, _ = call("GET", path)
        check(f"{path}: anonymous is refused", st == 401, st)
        st, _ = call("GET", path, OUTSIDER)
        check(f"{path}: an Admin of nothing here is refused", st == 403, st)
        st, _ = call("GET", path, SA)
        check(f"{path}: SuperAdmin reads it", st == 200, st)
    for path in (f"/api/public/membership-dues/{md}/report", f"/api/public/membership-dues/{md}/report/export", f"/api/public/event-payment/{ev}/report"):
        st, _ = call("GET", path)
        check(f"{path}: the anonymous route is gone", st in (401, 403, 404, 405), st)

    # Member search: key, typed name, no contact details.
    search = f"/api/public/membership-dues/{md}/search-members"
    q = urllib.parse.quote(name[:4])
    st, _ = call("GET", f"{search}?query={q}")
    check("search without the link's key is refused", st == 403, st)
    st, _ = call("GET", f"{search}?query={q}&k=wrongkey")
    check("search with a wrong key is refused", st == 403, st)
    st, rows = call("GET", f"/api/membership-dues?clubId={club}", SA)
    key = next((r.get("payKey") for r in rows if str(r.get("id")) == md), None) if st == 200 else None
    check("the dues list gives managers the key", bool(key), rows)
    st, rows = call("GET", f"{search}?k={key}")
    check("no query lists nobody", st == 200 and rows == [], rows)
    st, rows = call("GET", f"{search}?query=%25%25&k={key}")
    check("% in the query is literal", st == 200 and rows == [], rows)
    st, rows = call("GET", f"{search}?query={q}&k={key}")
    check("the key and a name find the member", st == 200 and any(str(r.get("MemberId")) == member for r in rows), st)
    check("the answer holds id, name and club only", all(set(r) == {"MemberId", "MemberName", "ClubName"} for r in rows), [sorted(r) for r in rows[:1]])
    st, rows = call("GET", f"{search}?query={urllib.parse.quote(email)}&k={key}")
    check("searching by email finds nobody", st == 200 and rows == [], rows)

    # Status needs the verified token, and the code goes only to the email on record.
    time.sleep(61)  # send-otp and verify-otp share the auth limit (10 a minute per IP) with the logins of the scripts before this one
    status = f"/api/public/membership-dues/{md}/member/{member}/status"
    st, _ = call("GET", status)
    check("status without a token is refused", st == 401, st)
    st, _ = call("GET", status + "?token=abc.def")
    check("status with a forged token is refused", st == 401, st)
    call("POST", f"/api/public/membership-dues/{md}/send-otp", None, {"memberProfileId": int(member), "email": ATTACKER})
    stored = sql(f"SELECT Email FROM event_payment_otp WHERE fk_payment_link_id = {md} ORDER BY 1 DESC LIMIT 1")
    code = sql(f"SELECT OtpCode FROM event_payment_otp WHERE fk_payment_link_id = {md} AND Email = '{email}' LIMIT 1")
    check("a supplied email is ignored: the code is for the address on record", stored == email and code, stored)
    st, r = call("POST", f"/api/public/membership-dues/{md}/send-otp", None, {"email": ATTACKER})
    check("send-otp needs a member", st == 400, (st, r))
    st, r = call("POST", f"/api/public/membership-dues/{md}/verify-otp", None, {"memberProfileId": int(member), "otpCode": "000000"})
    check("a wrong code gives no token", st == 200 and r.get("success") is False and not r.get("token"), r)
    st, r = call("POST", f"/api/public/membership-dues/{md}/verify-otp", None, {"memberProfileId": int(member), "otpCode": code})
    tok = r.get("token") if isinstance(r, dict) else None
    check("the right code gives a token", st == 200 and r.get("success") is True and tok, r)
    st, s = call("GET", f"{status}?token={tok}")
    check("the token opens that member's status", st == 200, (st, s))
    other = sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {club} AND cm.fk_member_master_profile_id <> {member} LIMIT 1")
    if other:
        st, _ = call("GET", f"/api/public/membership-dues/{md}/member/{other}/status?token={tok}")
        check("the token does not open another member", st == 401, st)

    # Event links: the same rules as dues.
    time.sleep(61)
    esearch = f"/api/public/event-payment/{ev}/search-members"
    st, _ = call("GET", f"{esearch}?query={q}")
    check("event search without the link's key is refused", st == 403, st)
    st, _ = call("GET", f"{esearch}?query={q}&k=wrongkey")
    check("event search with a wrong key is refused", st == 403, st)
    st, rows = call("GET", f"/api/event-payment-links?clubId={club}", SA)
    ekey = next((r.get("payKey") for r in rows if str(r.get("id")) == ev), None) if st == 200 else None
    check("the link list gives managers the key", bool(ekey), st)
    st, rows = call("GET", f"{esearch}?k={ekey}")
    check("event search with no query lists nobody", st == 200 and rows == [], len(rows))
    st, rows = call("GET", f"{esearch}?query={q}&k={ekey}")
    check("the key and a name find the member", st == 200 and any(str(r.get("memberProfileId")) == member for r in rows), st)
    check("the event answer holds id, name and club only", all(set(r) == {"memberProfileId", "memberName", "clubName"} for r in rows), [sorted(r) for r in rows[:1]])
    st, rows = call("GET", f"{esearch}?query={urllib.parse.quote(email)}&k={ekey}")
    check("searching an event link by email finds nobody", st == 200 and rows == [], len(rows))
    far = sql(f"SELECT cm.fk_club_id FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id WHERE cm.fk_club_id <> {club} AND cm.IsActive = 1 AND c.isdeleted = 0 LIMIT 1")
    st, rows = call("GET", f"{esearch}?query=%20a&clubId={far}&k={ekey}")
    theirs = sql(f"SELECT COUNT(*) FROM club_members WHERE fk_club_id = {club} AND IsActive = 1 AND fk_member_master_profile_id IN ({','.join(str(r['memberProfileId']) for r in rows) or 0})")
    check("a link for one club searches only that club, whatever the request asks", st == 200 and int(theirs) == len(rows), (st, len(rows), theirs))
    call("POST", f"/api/public/event-payment/{ev}/send-otp", None, {"memberProfileId": int(member), "email": ATTACKER})
    stored = sql(f"SELECT Email FROM event_payment_otp WHERE fk_payment_link_id = {ev} LIMIT 1")
    check("event link: a supplied email is ignored, the code is for the address on record", stored == email, stored)
    st, r = call("POST", f"/api/public/event-payment/{ev}/send-otp", None, {"email": ATTACKER})
    check("event link: a member form needs a member", st == 400, (st, r))
    guest = sql(f"INSERT INTO event_payment_links (Title, fk_club_id, FormType, IsActive, isdeleted) VALUES ('e2e-guard',{club},2,1,0); SELECT LAST_INSERT_ID();")
    st, r = call("POST", f"/api/public/event-payment/{guest}/send-otp", None, {"mobile": "5550100"})
    check("guest form: no email, no code", st == 200 and r.get("success") is False, r)
    call("POST", f"/api/public/event-payment/{guest}/send-otp", None, {"email": "guest@example.invalid"})
    stored = sql(f"SELECT Email FROM event_payment_otp WHERE fk_payment_link_id = {guest} LIMIT 1")
    check("guest form: the code goes to the payer's own email", stored == "guest@example.invalid", stored)

    # Who pays comes from the token, never from the request.
    time.sleep(61)
    victim = sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id <> {member} AND isdeleted = 0 LIMIT 1")
    sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount) VALUES ({md},{victim},100,0,0)")
    pay = f"/api/public/membership-dues/{md}/pay"
    st, _ = call("POST", pay, None, {"fkMemberProfileId": int(victim), "feeType": 1})
    check("dues pay without a token is refused", st == 401, st)
    st, _ = call("POST", pay, None, {"fkMemberProfileId": int(victim), "feeType": 1}, "abc.def")
    check("dues pay with a forged token is refused", st == 401, st)
    st, o = call("POST", pay, None, {"fkMemberProfileId": int(victim), "feeType": 1}, tok)
    paid_for = sql(f"SELECT fk_member_profile_id FROM membership_dues_payments WHERE pk_id = {o.get('paymentId', 0)}") if st == 200 else ""
    check("another member's id in the body is ignored: the order is the token's member", st == 200 and paid_for == member and paid_for != victim, (st, paid_for))
    st, _ = post_form(f"/api/public/membership-dues/{md}/offline-payment", {"fkMemberProfileId": victim, "feeType": "1", "transactionType": "Online"})
    check("dues offline-payment without a token is refused", st == 401, st)
    sql(f"UPDATE membership_dues SET ModeOfPayment = 3 WHERE pk_membership_dues_id = {md}")
    sql(f"DELETE FROM membership_dues_payments WHERE fk_membership_dues_id = {md}")
    st, r = post_form(f"/api/public/membership-dues/{md}/offline-payment", {"fkMemberProfileId": victim, "feeType": "1", "transactionType": "Online", "transactionId": "e2e-guard"}, tok)
    rows = sql(f"SELECT fk_member_profile_id FROM membership_dues_payments WHERE fk_membership_dues_id = {md}").split()
    check("offline: another member's id in the form is ignored", st == 200 and rows == [member], (st, r, rows))

    # Event link: the same.
    reg = sql(f"INSERT INTO event_payment_registrations (fk_payment_link_id, RegistrationName, Amount) VALUES ({ev},'e2e-guard',10); SELECT LAST_INSERT_ID();")
    order = f"/api/public/event-payment/{ev}/create-order"
    body = {"fkMemberProfileId": int(victim), "memberName": "someone else", "email": ATTACKER, "fkRegistrationId": int(reg)}
    st, _ = call("POST", order, None, body)
    check("event order without a token is refused", st == 401, st)
    code = sql(f"SELECT OtpCode FROM event_payment_otp WHERE fk_payment_link_id = {ev} AND IsVerified = 0 ORDER BY pk_id DESC LIMIT 1")
    st, r = call("POST", f"/api/public/event-payment/{ev}/verify-otp", None, {"memberProfileId": int(member), "otpCode": code})
    etok = r.get("token") if isinstance(r, dict) else None
    check("event verify-otp gives a token", st == 200 and etok, (st, r))
    st, _ = call("POST", order, None, body, tok)
    check("a dues token does not open an event link", st == 401, st)
    st, o = call("POST", order, None, body, etok)
    row = sql(f"SELECT fk_member_profile_id, Email, MemberName FROM event_payment_members WHERE pk_id = {o.get('memberPaymentId', 0)}").split("\t") if st == 200 else []
    check("event: another member's id, name and email in the body are ignored", len(row) == 3 and row[0] == member and row[1] == email and row[2] == name, (st, len(row)))

    gcode = sql(f"SELECT OtpCode FROM event_payment_otp WHERE fk_payment_link_id = {guest} LIMIT 1")
    st, r = call("POST", f"/api/public/event-payment/{guest}/verify-otp", None, {"memberProfileId": int(victim), "email": "guest@example.invalid", "otpCode": gcode})
    gtok = r.get("token") if isinstance(r, dict) else None
    greg = sql(f"INSERT INTO event_payment_registrations (fk_payment_link_id, RegistrationName, Amount) VALUES ({guest},'e2e-guard',10); SELECT LAST_INSERT_ID();")
    st, o = call("POST", f"/api/public/event-payment/{guest}/create-order", None, {"fkMemberProfileId": int(victim), "memberName": "A Guest", "mobile": "5550100", "email": ATTACKER, "fkRegistrationId": int(greg)}, gtok)
    row = sql(f"SELECT COALESCE(fk_member_profile_id, 0), Email FROM event_payment_members WHERE pk_id = {o.get('memberPaymentId', 0)}").split("\t") if st == 200 else []
    check("guest form: a member id in the body is ignored, the email is the verified one", row == ["0", "guest@example.invalid"], (st, row))
finally:
    if role_added:
        sql(f"DELETE FROM member_roles WHERE fk_member_master_profile_id = {member} AND fk_role_id = 2 AND fk_club_id = {other_club}")
    if cd:
        sql(f"DELETE FROM club_dues WHERE pk_club_dues_id = {cd}")
    if md:
        sql(f"DELETE FROM membership_dues_payments WHERE fk_membership_dues_id = {md}")
        sql(f"DELETE FROM event_payment_otp WHERE fk_payment_link_id = {md}")
        sql(f"DELETE FROM membership_dues_member_fees WHERE fk_membership_dues_id = {md}")
        sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id = {md}")
    for link in (ev, guest):
        if link:
            sql(f"DELETE FROM event_payment_otp WHERE fk_payment_link_id = {link}")
            sql(f"DELETE FROM event_payment_members WHERE fk_payment_link_id = {link}")
            sql(f"DELETE FROM event_payment_registrations WHERE fk_payment_link_id = {link}")
            sql(f"DELETE FROM event_payment_links WHERE pk_id = {link}")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
