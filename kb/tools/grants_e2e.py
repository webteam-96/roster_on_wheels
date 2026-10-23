"""Grants module (ROW build spec 3.8): a district opens next year's cycle, a club submits, the district approves with a
notification at each step, pays, receives the report and closes the grant. Also: the feature flag, role gating,
validation, each club seeing only its own applications, cash flow, CSV, archive, reject / cancel, light mode.

    python -I kb/tools/grants_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Writes test rows to
the given LOCAL database only and removes them at the end (a temporary district Admin role, a tenant row if the
district had none, one project row, the grant rows, the uploaded files, the feature switch). audit_log rows stay:
that table is append-only by design. Never run it against production.
"""
import base64, hashlib, hmac, json, os, secrets, shutil, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
FILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'row', 'api', 'App_Data', 'grant-files')
MARK = 'e2e-grants'
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


def call(method, path, tok, body=None, raw=None, ctype=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Authorization": f"Bearer {tok}"}
    if data is not None:
        headers["Content-Type"] = ctype or "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, rtype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, rtype = e.read(), e.code, e.headers.get("Content-Type", "")
    if "json" in rtype and payload:
        return status, json.loads(payload)
    return status, payload


def upload(path, tok, filename, content):
    b = "----e2e" + secrets.token_hex(8)
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f"\r\n--{b}--\r\n".encode()
    return call("POST", path, tok, raw=body, ctype=f"multipart/form-data; boundary={b}")


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def msg(r):
    return r[1].get("message") if isinstance(r[1], dict) else r[1]


# ── People and places, picked by query ────────────────────────────────────────────────────────────────────────
ADMIN_ROLE = "r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0"
NO_ROLES = ("NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id=cm.fk_member_master_profile_id "
            "AND x.fk_role_id<>1 AND x.IsActive=1 AND x.isdeleted=0)")
district = one("SELECT c.fk_district_id FROM member_roles r JOIN club_master c ON c.pk_club_id=r.fk_club_id "
               f"WHERE {ADMIN_ROLE} AND IFNULL(c.isdeleted,0)=0 GROUP BY c.fk_district_id "
               "HAVING COUNT(DISTINCT r.fk_club_id)>=2 ORDER BY COUNT(DISTINCT r.fk_club_id) DESC LIMIT 1")
clubs = [int(x) for x in sql(
    "SELECT DISTINCT r.fk_club_id FROM member_roles r JOIN club_master c ON c.pk_club_id=r.fk_club_id "
    f"WHERE {ADMIN_ROLE} AND c.fk_district_id={district} AND IFNULL(c.isdeleted,0)=0 "
    "AND (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id=c.pk_club_id AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 "
    f"AND {NO_ROLES})>=1 ORDER BY 1").split()]


def admin_of(club, other):
    """An Admin of this club who is not an Admin of the other club and has no district-wide role."""
    return one(f"SELECT r.fk_member_master_profile_id FROM member_roles r WHERE {ADMIN_ROLE} AND r.fk_club_id={club} "
               "AND NOT EXISTS (SELECT 1 FROM member_roles y WHERE y.fk_member_master_profile_id=r.fk_member_master_profile_id "
               f"AND y.IsActive=1 AND y.isdeleted=0 AND (y.fk_role_id IN (3,4,7) OR y.fk_club_id={other} "
               "OR (y.fk_role_id=2 AND IFNULL(y.fk_club_id,0)=0))) ORDER BY 1 LIMIT 1")


club_a, club_b = clubs[0], clubs[1]
admin_a, admin_b = admin_of(club_a, club_b), admin_of(club_b, club_a)
plain = one(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club_a} AND cm.IsActive=1 "
            f"AND IFNULL(cm.isdeleted,0)=0 AND {NO_ROLES} ORDER BY 1 LIMIT 1")
dadmin = one(f"SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id "
             f"WHERE c.fk_district_id={district} AND cm.fk_club_id NOT IN ({club_a},{club_b}) AND cm.IsActive=1 "
             f"AND IFNULL(cm.isdeleted,0)=0 AND {NO_ROLES} ORDER BY 1 LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
light_club, light_admin = [int(x) for x in sql(
    "SELECT r.fk_club_id, r.fk_member_master_profile_id FROM member_roles r JOIN club_master c ON c.pk_club_id=r.fk_club_id "
    f"WHERE {ADMIN_ROLE} AND c.fk_district_id<>{district} AND IFNULL(c.isdeleted,0)=0 "
    "AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions t WHERE t.fk_district_id=c.fk_district_id AND t.fk_club_id=0) "
    "ORDER BY 1 LIMIT 1").split()]
current_year = one("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 AND isdeleted=0 LIMIT 1")
current_label = sql(f"SELECT YearLabel FROM rotary_year_master WHERE pk_year_id={current_year}")
next_year = one("SELECT pk_year_id FROM rotary_year_master WHERE isdeleted=0 AND StartDate > "
                f"(SELECT StartDate FROM rotary_year_master WHERE pk_year_id={current_year}) ORDER BY StartDate LIMIT 1")
projects_table = "rotary_projects_" + current_label.replace("-", "_")
module_id = one("SELECT pk_module_id FROM module_master WHERE isdeleted=0 ORDER BY pk_module_id LIMIT 1")
assert None not in (district, admin_a, admin_b, plain, dadmin, sa, current_year, next_year, module_id), "test data missing"
print(f"district {district}, clubs {club_a}/{club_b}, light club {light_club}, years {current_year}->{next_year}")

t_da, t_a, t_b = token(dadmin, "Admin"), token(admin_a, "Admin"), token(admin_b, "Admin")
t_plain, t_sa, t_light = token(plain, "Member"), token(sa, "SuperAdmin"), token(light_admin, "Admin")

# ── Setup (undone in finally) ───────────────────────────────────────────────────────────────────────────────────
leftover = sql(f"SELECT pk_cycle_id FROM grant_cycles WHERE rules='{MARK}'").split()
for cid in leftover:
    sql(f"DELETE FROM grant_applications WHERE fk_cycle_id={cid}; DELETE FROM grant_cycles WHERE pk_cycle_id={cid}")
sql(f"DELETE FROM member_roles WHERE created_by=-4242")
flag_before = sql("SELECT enabled FROM platform_features WHERE feature_key='grants'")
tenant_added = one(f"SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0") == 0
if tenant_added:
    sql(f"INSERT INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code, state) VALUES ({district}, 0, 'district', 'live')")
sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, AllClubsAccess, IsActive, created_by) "
    f"VALUES ({dadmin}, 2, {district}, 0, 1, -4242)")
sql(f"INSERT INTO `{projects_table}` (fk_club_id, fk_module_id, fk_year_id, title, project_date, isdeleted) "
    f"VALUES ({light_club}, {module_id}, {current_year}, '{MARK} light project', CURDATE(), 0)")
light_project = one(f"SELECT MAX(pk_project_id) FROM `{projects_table}` WHERE title='{MARK} light project'")
cycle = app = app2 = app3 = None
D, A, B = f"/api/districts/{district}/grants", f"/api/clubs/{club_a}/grants", f"/api/clubs/{club_b}/grants"

try:
    # ── Feature flag ───────────────────────────────────────────────────────────────────────────────────────────
    if flag_before != "1":
        r = call("GET", D + "/cycles", t_da)
        check("module is off until switched on (404)", r[0] == 404, r)
    r = call("PUT", "/api/features/grants", t_sa, {"enabled": True})
    check("SuperAdmin switches grants on", r[0] == 204, r)
    r = call("PUT", "/api/features/grants", t_a, {"enabled": True})
    check("club admin cannot switch features", r[0] == 403, r)

    # ── Cycle ──────────────────────────────────────────────────────────────────────────────────────────────────
    check("district admin lists cycles", call("GET", D + "/cycles", t_da)[0] == 200)
    check("club admin cannot read district grants", call("GET", D + "/cycles", t_a)[0] == 403)
    check("club member cannot read district grants", call("GET", D + "/applications", t_plain)[0] == 403)
    body = {"yearId": next_year, "status": "open", "ddfBudget": 10000, "maxRequest": 5000, "minQualifiedMembers": 1,
            "rules": MARK}
    check("club admin cannot open a cycle", call("POST", D + "/cycles", t_a, body)[0] == 403)
    r = call("POST", D + "/cycles", t_da, body)
    check("district opens next year's cycle", r[0] == 200 and r[1]["status"] == "open", r)
    cycle = r[1]["id"]
    r = call("POST", D + "/cycles", t_da, body)
    check("one cycle per year", r[0] == 400, r)

    # ── Club draft ─────────────────────────────────────────────────────────────────────────────────────────────
    r = call("GET", A, t_a)
    check("club sees the open cycle", r[0] == 200 and not r[1]["lightMode"] and any(c["id"] == cycle for c in r[1]["cycles"]), r)
    check("plain member cannot open club grants", call("GET", A, t_plain)[0] == 403)
    form = {"cycleId": cycle, "title": f"{MARK} water well", "description": "Borewell and pump for the village school.",
            "location": "Village school", "amountRequested": 2500, "rulesAccepted": True,
            "lines": [{"kind": "income", "description": "Club contribution", "amount": 500},
                      {"kind": "expense", "description": "Pump and pipes", "amount": 3000},
                      {"kind": "partner", "description": "Local water NGO", "detail": "Installs and maintains"}],
            "members": []}
    r = call("POST", A + "/applications", t_a, form)
    check("club creates a draft", r[0] == 200, r)
    app = r[1]["id"]
    APP, DAPP = f"{A}/applications/{app}", f"{D}/applications/{app}"
    check("district cannot see a draft", call("GET", DAPP, t_da)[0] == 404)
    r = call("POST", APP + "/actions/submit", t_a, {})
    check("submit refused without qualified members", r[0] == 400 and "qualified" in str(msg(r)), r)
    form["members"] = [{"memberId": plain, "note": "Grant management seminar"}]
    r = call("PUT", APP, t_a, form)
    check("club saves the form", r[0] == 200 and len(r[1]["members"]) == 1, r)
    r = upload(APP + "/attachments", t_a, "quote.pdf", b"%PDF-1.4\n% e2e quote\n%%EOF\n")
    check("club attaches a PDF", r[0] == 200, r)
    att = r[1]["id"] if r[0] == 200 else 0
    check("an .exe is refused", upload(APP + "/attachments", t_a, "tool.exe", b"MZ\x90\x00")[0] == 400)
    check("a fake PDF is refused", upload(APP + "/attachments", t_a, "fake.pdf", b"<html>x</html>")[0] == 400)

    # ── Submit; isolation and role gating ──────────────────────────────────────────────────────────────────────
    r = call("POST", APP + "/actions/submit", t_a, {})
    check("club submits", r[0] == 200 and r[1]["status"] == "submitted", r)
    check("club B admin cannot open club A's application", call("GET", APP, t_b)[0] == 403)
    check("club B route does not find club A's application", call("GET", f"{B}/applications/{app}", t_b)[0] == 404)
    r = call("GET", B, t_b)
    check("club B's list holds only its own applications",
          r[0] == 200 and all(x["clubId"] == club_b for x in r[1]["applications"]) and all(x["id"] != app for x in r[1]["applications"]), r)
    check("club member cannot open the application", call("GET", APP, t_plain)[0] == 403)
    r = call("POST", APP + "/actions/approve", t_a, {"amount": 2500})
    check("club cannot approve (district action)", r[0] == 400, r)
    check("district admin cannot act on club routes", call("POST", APP + "/actions/cancel", t_da, {})[0] == 403)
    r = call("GET", DAPP, t_da)
    check("district sees the submitted application", r[0] == 200 and "approve" in [a["action"] for a in r[1]["actions"]], r)
    r = call("GET", f"{DAPP}/attachments/{att}", t_da)
    check("district downloads the attachment", r[0] == 200 and isinstance(r[1], bytes) and r[1].startswith(b"%PDF"), r[0])

    # ── Review loop ────────────────────────────────────────────────────────────────────────────────────────────
    r = call("POST", DAPP + "/actions/request_information", t_da, {})
    check("information request needs a comment", r[0] == 400, r)
    r = call("POST", DAPP + "/actions/request_information", t_da, {"comment": "Send the pump quotation."})
    check("district requests information", r[0] == 200 and r[1]["status"] == "information_requested", r)
    r = call("POST", APP + "/actions/provide_information", t_a, {"comment": "Quotation attached."})
    check("club provides information", r[0] == 200 and r[1]["status"] == "information_provided", r)
    r = call("POST", DAPP + "/actions/request_adjustment", t_da, {"comment": "We can fund 2000 at most."})
    check("district requests an adjustment", r[0] == 200 and r[1]["status"] == "adjustment_requested", r)
    form["amountRequested"] = 2000
    check("club adjusts the amount", call("PUT", APP, t_a, form)[0] == 200)
    r = call("POST", APP + "/actions/resubmit", t_a, {})
    check("club resubmits", r[0] == 200 and r[1]["status"] == "submitted", r)
    r = call("POST", DAPP + "/comments", t_da, {"comment": "Thanks, reviewing."})
    check("district comments", r[0] == 200 and r[1]["events"][-1]["action"] == "comment", r)
    r = call("POST", DAPP + "/actions/approve", t_da, {"amount": 2500})
    check("approval above the request is refused", r[0] == 400, r)
    r = call("POST", DAPP + "/actions/approve", t_da, {"amount": 2000})
    check("district approves", r[0] == 200 and r[1]["status"] == "approved" and r[1]["amountApproved"] == 2000, r)

    # ── Disbursement, report, close ────────────────────────────────────────────────────────────────────────────
    pay = {"amount": 2500, "paidOn": time.strftime("%Y-%m-%d"), "method": "bank_transfer", "reference": "TRX-1"}
    r = call("POST", DAPP + "/payments", t_da, pay)
    check("over-payment is refused", r[0] == 400, r)
    check("club cannot record payments", call("POST", f"{A}/applications/{app}/payments", t_a, pay)[0] in (404, 405))
    pay["amount"] = 1500
    r = call("POST", DAPP + "/payments", t_da, pay)
    check("first payment marks the grant paid", r[0] == 200 and r[1]["status"] == "paid" and r[1]["paid"] == 1500, r)
    pay.update(amount=600, reference="TRX-2")
    check("payments stop at the approved amount", call("POST", DAPP + "/payments", t_da, pay)[0] == 400)
    pay["amount"] = 500
    r = call("POST", DAPP + "/payments", t_da, pay)
    check("second payment recorded", r[0] == 200 and r[1]["paid"] == 2000 and r[1]["status"] == "paid", r)
    r = call("POST", APP + "/actions/submit_report", t_a, {})
    check("report needs a summary", r[0] == 400, r)
    report = {"reportSummary": "Well dug, pump installed, 300 pupils served.", "reportAmountSpent": 2400, "reportBeneficiaries": 300}
    r = call("POST", APP + "/actions/submit_report", t_a, report)
    check("club submits the final report", r[0] == 200 and r[1]["status"] == "report_submitted", r)
    r = call("POST", DAPP + "/actions/return_report", t_da, {"comment": "Add the photos, please."})
    check("district returns the report", r[0] == 200 and r[1]["status"] == "paid", r)
    r = call("POST", APP + "/actions/submit_report", t_a, report)
    check("club resubmits the report", r[0] == 200 and r[1]["status"] == "report_submitted", r)
    r = call("POST", DAPP + "/actions/close", t_da, {})
    check("district closes the grant", r[0] == 200 and r[1]["status"] == "closed" and r[1]["closedAt"], r)
    check("a closed grant cannot be reopened", call("POST", DAPP + "/actions/approve", t_da, {"amount": 1})[0] == 400)

    # ── Dashboard, archive, cash flow, CSV ─────────────────────────────────────────────────────────────────────
    r = call("GET", D + "/cycles", t_da)
    cy = next((c for c in r[1] if c["id"] == cycle), {}) if r[0] == 200 else {}
    check("dashboard counts by status", cy.get("statusCounts", {}).get("closed") == 1 and cy.get("committed") == 2000 and cy.get("paid") == 2000, cy)
    r = call("GET", f"{D}/applications?cycleId={cycle}&archived=true", t_da)
    check("archive holds the closed grant", r[0] == 200 and [x["id"] for x in r[1]] == [app], r)
    r = call("GET", f"{D}/applications?cycleId={cycle}&archived=false", t_da)
    check("open list leaves it out", r[0] == 200 and all(x["id"] != app for x in r[1]), r)
    r = call("GET", f"{D}/cycles/{cycle}/cashflow", t_da)
    check("cash flow shows payments and balance", r[0] == 200 and len(r[1]["rows"]) == 2 and r[1]["rows"][-1]["balance"] == 8000, r)
    r = call("GET", f"{D}/cycles/{cycle}/export", t_da)
    csv = r[1].decode("utf-8-sig") if isinstance(r[1], bytes) else ""
    check("CSV export", r[0] == 200 and f"{MARK} water well" in csv and '"Closed"' in csv, r[0])
    check("club admin cannot export", call("GET", f"{D}/cycles/{cycle}/export", t_a)[0] == 403)

    # ── Notifications and audit on every step ──────────────────────────────────────────────────────────────────
    events = one(f"SELECT COUNT(*) FROM grant_events WHERE fk_application_id={app}")
    silent = one(f"SELECT COUNT(*) FROM grant_events e WHERE e.fk_application_id={app} AND NOT EXISTS "
                 "(SELECT 1 FROM grant_notifications n WHERE n.fk_event_id=e.pk_event_id)")
    check(f"every one of {events} events notified someone", events and events >= 13 and silent == 0, (events, silent))
    to_district = one(f"SELECT COUNT(*) FROM grant_notifications WHERE fk_application_id={app} AND fk_member_id={dadmin} AND side='district'")
    to_club = one(f"SELECT COUNT(*) FROM grant_notifications WHERE fk_application_id={app} AND fk_member_id={admin_a}")
    check("district admin notified of club steps", to_district and to_district >= 5, to_district)
    check("club admin notified of district steps", to_club and to_club >= 7, to_club)
    check("actor is never notified of their own step", one(
        f"SELECT COUNT(*) FROM grant_notifications n JOIN grant_events e ON e.pk_event_id=n.fk_event_id "
        f"WHERE n.fk_application_id={app} AND n.fk_member_id=e.fk_member_id") == 0)
    check("each notification is queued for email", one(
        f"SELECT COUNT(*) FROM grant_notifications WHERE fk_application_id={app} "
        "AND email_status NOT IN ('pending','sent','skipped')") == 0)
    r = call("GET", "/api/mobile/notifications?types=grant&pageSize=50", t_a)
    items = r[1].get("items", []) if r[0] == 200 else []
    check("in-app feed shows grant notifications", any(i["type"] == "grant" and i["deepLink"]["entityId"] == app for i in items), r)
    audited = sql(f"SELECT DISTINCT action FROM audit_log WHERE entity_type='grant_application' AND entity_id={app}").split()
    want = {"CREATE", "SUBMIT", "REQUEST_INFORMATION", "PROVIDE_INFORMATION", "REQUEST_ADJUSTMENT", "RESUBMIT",
            "APPROVE", "PAYMENT", "SUBMIT_REPORT", "RETURN_REPORT", "CLOSE", "COMMENT", "UPLOAD"}
    check("audit rows for every action", want <= set(audited), sorted(want - set(audited)))

    # ── Budget, reject, cancel ─────────────────────────────────────────────────────────────────────────────────
    form_b = dict(form, title=f"{MARK} library books", members=[], cycleId=cycle)
    form_b["members"] = [{"memberId": one(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club_b} "
                                          f"AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 ORDER BY 1 LIMIT 1")}]
    r = call("POST", B + "/applications", t_b, form_b)
    check("club B creates its own draft", r[0] == 200, r)
    app2 = r[1]["id"]
    check("club B submits", call("POST", f"{B}/applications/{app2}/actions/submit", t_b, {})[0] == 200)
    upd = dict(body, ddfBudget=1000)
    check("budget cannot drop below what is approved", call("PUT", f"{D}/cycles/{cycle}", t_da, upd)[0] == 400)
    upd["ddfBudget"] = 3000
    check("district lowers the budget", call("PUT", f"{D}/cycles/{cycle}", t_da, upd)[0] == 200)
    r = call("POST", f"{D}/applications/{app2}/actions/approve", t_da, {"amount": 2000})
    check("approval over the DDF budget is refused", r[0] == 400 and "budget" in str(msg(r)), r)
    r = call("POST", f"{D}/applications/{app2}/actions/reject", t_da, {})
    check("rejection needs a reason", r[0] == 400, r)
    r = call("POST", f"{D}/applications/{app2}/actions/reject", t_da, {"comment": "Outside the cycle's focus areas."})
    check("district rejects with a reason", r[0] == 200 and r[1]["status"] == "rejected" and r[1]["rejectionReason"], r)
    r = call("POST", A + "/applications", t_a, dict(form, title=f"{MARK} draft to cancel"))
    app3 = r[1]["id"] if r[0] == 200 else None
    r = call("POST", f"{A}/applications/{app3}/actions/cancel", t_a, {})
    check("club cancels a draft", r[0] == 200 and r[1]["status"] == "cancelled", r)
    r = call("GET", f"{D}/applications?cycleId={cycle}", t_da)
    check("a never-submitted draft stays private", r[0] == 200 and all(x["id"] != app3 for x in r[1]), r)

    # ── Light mode ─────────────────────────────────────────────────────────────────────────────────────────────
    L = f"/api/clubs/{light_club}/grants"
    r = call("GET", L, t_light)
    check("club in a district not on ROW is in light mode", r[0] == 200 and r[1]["lightMode"] is True, r)
    check("light-mode club cannot apply", call("POST", L + "/applications", t_light, form)[0] == 400)
    r = call("PUT", f"{L}/light/{current_year}/{light_project}", t_light, {"grantAmount": 1200.5, "reportDate": "2027-03-31"})
    check("light mode records grant amount and report date", r[0] == 204, r)
    r = call("GET", f"{L}/light?yearId={current_year}", t_light)
    row = next((p for p in r[1] if p["projectId"] == light_project), {}) if r[0] == 200 else {}
    check("light fields read back", row.get("grantAmount") == 1200.5 and str(row.get("reportDate", "")).startswith("2027-03-31"), r)
    r = call("PUT", f"{A}/light/{current_year}/{light_project}", t_a, {"grantAmount": 1})
    check("full-mode club has no light fields", r[0] == 400, r)
    r = call("PUT", f"{L}/light/{current_year}/999999999", t_light, {"grantAmount": 1})
    check("light mode only on the club's own projects", r[0] == 404, r)
finally:
    for a in (app, app2, app3):
        if a:
            shutil.rmtree(os.path.join(FILES, str(a)), ignore_errors=True)
    if cycle:
        sql(f"DELETE FROM grant_applications WHERE fk_cycle_id={cycle}; DELETE FROM grant_cycles WHERE pk_cycle_id={cycle}")
    sql(f"DELETE FROM grant_project_light WHERE fk_year_id={current_year} AND fk_project_id={light_project}")
    sql(f"DELETE FROM `{projects_table}` WHERE pk_project_id={light_project} AND title='{MARK} light project'")
    sql("DELETE FROM member_roles WHERE created_by=-4242")
    if tenant_added:
        sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0")
    call("PUT", "/api/features/grants", t_sa, {"enabled": flag_before == "1"})
    if flag_before == "":
        sql("DELETE FROM platform_features WHERE feature_key='grants'")
    left = one(f"SELECT COUNT(*) FROM grant_applications WHERE title LIKE '{MARK}%'")
    check("cleanup left no test rows", left == 0, left)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
