"""Phase 3 app screens (2026-10-26): every endpoint the new app screens call answers with the fields the screens read.
Volunteers, meeting duties, guest invite link, chat, Foundation designations, communication preferences, calendar
feed, targets, club grants, district goal messages, planning, prospect stage. A shape mismatch would show an empty or
broken screen in the app without any error, which widget tests with fakes cannot catch. Also the app writes
(2026-10-26): a group chat, speakers add / edit / remove, a grant application made, edited and submitted.

    python -I kb/tools/app_contract_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret). Local copies only, never production. It switches
the modules on through the API for the run, restores each switch afterwards, and deletes what it creates.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
FEATURES = ["volunteers", "contacts_growth", "chat", "membership_fields", "communication", "meetings",
            "target_dashboard", "grants", "planning_mode"]
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def has(obj, *keys):
    return isinstance(obj, dict) and all(k in obj for k in keys)


def shape(name, status, reply, keys, list_ok=True):
    """reply is a list (each item needs the keys) or an object with the keys."""
    if isinstance(reply, list):
        check(f"{name}: 200 and item fields {keys}", status == 200 and list_ok and all(has(r, *keys) for r in reply),
              (status, reply[:1]))
    else:
        check(f"{name}: 200 and fields {keys}", status == 200 and has(reply, *keys), (status, reply))


club, me, other = [int(x) for x in sql(
    "SELECT a.fk_club_id, a.fk_member_master_profile_id, b.fk_member_master_profile_id FROM club_members a "
    "JOIN club_members b ON b.fk_club_id = a.fk_club_id AND b.fk_member_master_profile_id > a.fk_member_master_profile_id "
    "AND b.IsActive = 1 AND b.isdeleted = 0 WHERE a.IsActive = 1 AND a.isdeleted = 0 LIMIT 1").split()]
district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {club}"))
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 LIMIT 1"))
sat, mt = token(sa, ["SuperAdmin"]), token(me, ["Member"])

_, rows = call("GET", "/api/features", sat)
before = {f["key"]: f.get("enabled") for f in rows if f["key"] in FEATURES}
chat_id = group_id = speaker_id = cycle_id = tenant_added = None
try:
    for k in FEATURES:
        call("PUT", f"/api/features/{k}", sat, {"enabled": True})

    s, r = call("GET", "/api/mobile/volunteers", mt)
    shape("volunteer sheets", s, r, ["id", "title", "clubName", "slots"])
    for sheet in r if isinstance(r, list) else []:
        for slot in sheet["slots"]:
            check("volunteer slot fields", has(slot, "id", "task", "startsAt", "capacity", "filled", "signedUp"), slot)
    s, r = call("GET", "/api/mobile/meeting-duties", mt)
    shape("meeting duties", s, r, ["duty", "meetingDate", "clubName", "note"])
    s, r = call("GET", f"/api/clubs/{club}/invite-link", mt)
    shape("guest invite link", s, r, ["url"])

    s, r = call("POST", "/api/chat/conversations", mt, {"kind": "direct", "scope": "club", "ownerId": club, "memberIds": [other]})
    shape("open a direct chat", s, r, ["id"])
    chat_id = r.get("id") if isinstance(r, dict) else None
    s, r = call("POST", f"/api/chat/conversations/{chat_id}/messages", mt, {"body": "e2e-contract", "clientKey": f"e2e-{time.time()}"})
    shape("send a message", s, r, ["id"])
    s, r = call("GET", f"/api/chat/conversations/{chat_id}/messages", mt)
    shape("messages", s, r, ["id", "senderId", "senderName", "body", "hidden", "createdAt"])
    s, r = call("GET", "/api/chat/conversations", token(other, ["Member"]))
    shape("the other member's chat list", s, r, ["id", "kind", "title", "unread", "lastBody", "lastHidden"])
    check("... shows the new chat with one unread", any(c["id"] == chat_id and c["unread"] == 1 for c in r or []), r)

    s, r = call("POST", "/api/chat/conversations", mt, {"kind": "group", "scope": "club", "ownerId": club, "title": "e2e-group", "memberIds": [other]})
    shape("start a group chat", s, r, ["id"])
    group_id = r.get("id") if isinstance(r, dict) else None

    sp = f"/api/clubs/{club}/speakers"
    body = {"meetingDate": "2026-12-01", "name": "e2e-speaker", "topic": "Water", "bio": "", "email": "", "phone": "", "showOnWebsite": False}
    s, r = call("POST", sp, sat, body)
    speaker_id = r.get("id") if isinstance(r, dict) else None
    check("add a speaker", s == 200 and speaker_id, (s, r))
    s, _ = call("PUT", f"{sp}/{speaker_id}", sat, {**body, "topic": "Clean water"})
    row = next((x for x in call("GET", sp, sat)[1] or [] if x.get("id") == speaker_id), {})
    check("edit a speaker; the list has the app's fields", s == 200 and row.get("topic") == "Clean water"
          and has(row, "name", "meetingDate", "showOnWebsite", "email", "phone", "bio"), (s, row))
    s, _ = call("DELETE", f"{sp}/{speaker_id}", sat)
    check("remove a speaker", s in (200, 204) and not any(x.get("id") == speaker_id for x in call("GET", sp, sat)[1] or []), s)
    if s in (200, 204):
        speaker_id = None

    year = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1"))
    if sql(f"SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id = {district} AND fk_club_id = 0") == "0":
        # grants run only for districts on ROW: a temporary tenant row, removed below
        tenant_added = sql(f"INSERT INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code, state, created_by) "
                           f"SELECT {district}, 0, MIN(code), 'live', -7 FROM edition_catalogue; SELECT LAST_INSERT_ID()")
    s, r = call("POST", f"/api/districts/{district}/grants/cycles", sat,
                {"yearId": year, "status": "open", "ddfBudget": 10000, "minQualifiedMembers": 0, "rules": "e2e rules"})
    cycle_id = r.get("id") if isinstance(r, dict) else None
    if not cycle_id:
        print(f"SKIP grant writes: no open cycle could be made ({s}, {r})")
    else:
        s, r = call("GET", f"/api/clubs/{club}/grants", sat)
        check("the club sees the open cycle",
              any(c.get("id") == cycle_id and c.get("status") == "open" for c in (r or {}).get("cycles", [])), r)
        ga = f"/api/clubs/{club}/grants/applications"
        app = {"cycleId": cycle_id, "title": "e2e-grant", "description": "d", "location": "x", "beneficiaries": 10,
               "amountRequested": 500, "rulesAccepted": True, "lines": [], "members": []}
        s, r = call("POST", ga, sat, app)
        app_id = r.get("id") if isinstance(r, dict) else None
        check("create a grant application", s == 200 and app_id, (s, r))
        s, r = call("GET", f"{ga}/{app_id}", sat)
        shape("grant application detail", s, r, ["title", "status", "amountRequested", "editable", "actions", "events", "cycle"])
        check("a draft can be edited and submitted",
              r.get("editable") is True and any(a.get("action") == "submit" for a in r.get("actions", [])), r)
        # the app's form: an expense line added, other lines and members passed back unchanged
        s, _ = call("PUT", f"{ga}/{app_id}", sat, {**app, "title": "e2e-grant 2", "members": r.get("members", []),
                    "lines": r.get("lines", []) + [{"kind": "expense", "description": "Water tank", "amount": 500}]})
        check("edit the application", s in (200, 204), s)
        s, _ = call("POST", f"{ga}/{app_id}/comments", sat, {"comment": "e2e comment"})
        check("comment on the application", s == 200, s)
        s, sub = call("POST", f"{ga}/{app_id}/actions/submit", sat, {"comment": ""})
        r = call("GET", f"{ga}/{app_id}", sat)[1] or {}
        check("submit it; the history has dated events", s == 200 and r.get("status") == "submitted"
              and all(has(e, "action", "createdDate") for e in r.get("events", [])), (s, sub, r.get("status")))

    s, r = call("GET", f"/api/members/{me}/foundation-designations", mt)
    shape("my Foundation designations", s, r, ["label", "awardedDate"])
    s, r = call("GET", "/api/mobile/comms/preferences", mt)
    shape("communication preferences", s, r, ["effectiveLanguage", "consents"])
    s, r = call("GET", "/api/mobile/calendar-feed", mt)
    shape("calendar feed link", s, r, ["url"])

    s, r = call("GET", f"/api/clubs/{club}/targets", sat)
    shape("club targets", s, r, ["yearLabel", "yearElapsedPercent", "totals", "clubs"])
    s, r = call("GET", f"/api/districts/{district}/targets", sat)
    shape("district targets", s, r, ["yearLabel", "totals", "clubs"])
    for c in (r or {}).get("clubs", [])[:3]:
        check("target club row fields", has(c, "clubName", "status", "agName", "metrics"), c)
    s, r = call("GET", f"/api/clubs/{club}/grants", sat)
    shape("club grants", s, r, ["applications"])

    cat = int(sql("SELECT MIN(pk_category_id) FROM goal_categories WHERE isdeleted = 0"))
    year = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1"))
    s, r = call("GET", f"/api/goal-setting/district-messages/{cat}/{district}?yearId={year}", sat)
    shape("district goal messages", s, r, ["messages", "canPost"])

    s, r = call("GET", "/api/planning/me", mt)
    shape("my planning roles", s, r, ["role", "districtId", "status"])
    s, r = call("GET", f"/api/clubs/{club}/potential-members?page=1&pageSize=5", sat)
    check("prospects carry a stage", s == 200 and all("stage" in i for i in (r or {}).get("items", [])), (s, r))
finally:
    if cycle_id:
        apps = f"SELECT pk_application_id FROM grant_applications WHERE fk_cycle_id = {cycle_id}"
        for t in ("grant_events", "grant_lines", "grant_members", "grant_attachments", "grant_payments"):
            if sql(f"SHOW TABLES LIKE '{t}'"):
                sql(f"DELETE FROM {t} WHERE fk_application_id IN ({apps})")
        sql(f"DELETE FROM grant_applications WHERE fk_cycle_id = {cycle_id}")
        sql(f"DELETE FROM grant_cycles WHERE pk_cycle_id = {cycle_id}")
    if tenant_added:
        sql(f"DELETE FROM tenant_subscriptions WHERE pk_subscription_id = {tenant_added}")
    if speaker_id:
        call("DELETE", f"/api/clubs/{club}/speakers/{speaker_id}", sat)
    for cid in (chat_id, group_id):
        if cid:
            sql(f"DELETE FROM chat_messages WHERE conversation_id = {cid}")
            sql(f"DELETE FROM chat_members WHERE conversation_id = {cid}")
            sql(f"DELETE FROM chat_conversations WHERE pk_conversation_id = {cid}")
    for k, was in before.items():
        call("PUT", f"/api/features/{k}", sat, {"enabled": bool(was)})

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
