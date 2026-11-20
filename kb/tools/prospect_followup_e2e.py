"""Prospect follow-up tasks and new-prospect notifications (gap agent, 2026-11-19; feature contacts_growth).

    python -I kb/tools/prospect_followup_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET       the API's JwtSettings__Secret
  ROW_E2E_EMAIL_SAFE=1     required: says the API was started with Brevo__ApiUrl=http://127.0.0.1:<fake port>/v3/smtp/email
  ROW_E2E_FAKE_BREVO_PORT  port of the fake Brevo server this script starts (default 5213)

Start the API with ProspectFollowUp__Job=true (the reminder and email job; BackgroundJobs__Enabled=false keeps the
other jobs off). Nothing leaves the machine: Brevo is answered by this script. Uses club 341 (admin 1068, member
999) of the local copy; every row it creates is removed at the end and the feature switch and the club's
notification settings are put back as they were.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
if os.environ.get('ROW_E2E_EMAIL_SAFE') != '1':
    sys.exit("Set ROW_E2E_EMAIL_SAFE=1 and point the API's Brevo__ApiUrl at the fake server (see the header).")
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5213'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
FEATURE, CLUB, ADMIN, PLAIN = "contacts_growth", 341, 1068, 999
fails = 0
sent = []  # recipient addresses the fake Brevo received


class FakeBrevo(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        sent.extend((t.get('email') or '').lower() for t in body.get('to', []))
        out = b'{"messageId":"<e2e@fake>"}'
        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


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
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, json.loads(data) if data else None
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data) if data else None
        except ValueError:
            return e.code, data.decode(errors="replace")[:200]


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def wait_for(q, want, seconds=100):
    end = time.time() + seconds
    while time.time() < end:
        if sql(q) == want:
            return True
        time.sleep(3)
    return False


server = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), FakeBrevo)
threading.Thread(target=server.serve_forever, daemon=True).start()

sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
other = int(sql(f"SELECT pk_club_id FROM club_master WHERE pk_club_id<>{CLUB} AND IsActive=1 AND isdeleted=0 ORDER BY 1 LIMIT 1"))
outsider = int(sql(f"SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id<>{CLUB} AND IsActive=1 AND isdeleted=0 "
                   f"AND fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={CLUB}) LIMIT 1"))
president = sql(f"SELECT b.fk_member_master_profile_id FROM board_of_directors b JOIN rotary_year_master y ON y.pk_year_id=b.fk_year_id "
                f"AND y.IsCurrent=1 JOIN club_members cm ON cm.fk_club_id=b.fk_club_id AND cm.fk_member_master_profile_id=b.fk_member_master_profile_id "
                f"AND cm.IsActive=1 AND cm.isdeleted=0 WHERE b.fk_club_id={CLUB} AND b.fk_designation_id=1 AND b.isdeleted=0 LIMIT 1")
plain_email = sql(f"SELECT LOWER(TRIM(COALESCE(EmailId,''))) FROM member_master_profile WHERE pk_member_master_profile_id={PLAIN}")
t_admin, t_plain, t_sa = token(ADMIN, "Admin"), token(PLAIN, "Member"), token(sa, "SuperAdmin")
was_on = sql(f"SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='{FEATURE}'") == "1"
old_settings = sql(f"SELECT CONCAT_WS(',', to_president, to_membership_chair, by_in_app, by_email) FROM prospect_notify_settings WHERE fk_club_id={CLUB}")
old_members = sql(f"SELECT GROUP_CONCAT(fk_member_id) FROM prospect_notify_members WHERE fk_club_id={CLUB}")
print(f"club {CLUB}, admin {ADMIN}, member {PLAIN}, president {president or 'none'}, other club {other}, outsider {outsider}")

base = f"/api/clubs/{CLUB}"
prospect_ids = []
try:
    s, _ = call("PUT", f"/api/features/{FEATURE}", t_sa, {"enabled": True})
    check("SuperAdmin switches contacts_growth on", s == 204, s)

    # ── Notification settings ──
    s, body = call("GET", f"{base}/prospect-notify-settings", t_admin)
    check("Club admin reads the notification settings", s == 200 and "toPresident" in body, (s, body))
    check("Settings name this year's president", s == 200 and (not president or len(body["presidents"]) >= 1), body)
    s, _ = call("GET", f"{base}/prospect-notify-settings", t_plain)
    check("Ordinary member cannot read the settings", s == 403, s)
    s, _ = call("PUT", f"{base}/prospect-notify-settings", t_plain, {"toPresident": True, "memberIds": [], "inApp": True, "email": True})
    check("Ordinary member cannot change the settings", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{other}/prospect-notify-settings", t_admin)
    check("Admin cannot read another club's settings", s == 403, s)
    s, body = call("PUT", f"{base}/prospect-notify-settings", t_admin,
                   {"toPresident": False, "toMembershipChair": False, "memberIds": [outsider], "inApp": True, "email": True})
    check("A member of another club cannot be chosen", s == 400, (s, body))
    s, body = call("PUT", f"{base}/prospect-notify-settings", t_admin,
                   {"toPresident": True, "toMembershipChair": False, "memberIds": [PLAIN, ADMIN], "inApp": True, "email": True})
    check("Admin saves: president + two named members, in-app and email",
          s == 200 and sorted(body["memberIds"]) == sorted([PLAIN, ADMIN]) and body["toPresident"] and not body["toMembershipChair"], (s, body))

    # ── New prospect notice ──
    s, body = call("POST", f"{base}/potential-members", t_admin, {"name": "E2E PFU Prospect", "email": "pfue2e@example.org"})
    check("Admin adds a prospect", s == 200 and body.get("id"), (s, body))
    pid = body["id"]
    prospect_ids.append(pid)
    rows = sql(f"SELECT fk_member_id FROM prospect_notifications WHERE fk_potential_member_id={pid} AND kind='new_prospect' ORDER BY 1")
    want = sorted({PLAIN} | ({int(president)} if president and int(president) != ADMIN else set()))
    check("New prospect notice goes to the chosen people, not to the admin who added it",
          sorted(int(x) for x in rows.split()) == want, (rows, want))
    check("Notice is in-app with email pending",
          sql(f"SELECT CONCAT(in_app, email_status) FROM prospect_notifications WHERE fk_potential_member_id={pid} AND fk_member_id={PLAIN}") in ("1pending", "1sent"))
    s, body = call("GET", "/api/mobile/notifications?types=prospect", t_plain)
    items = (body or {}).get("items", []) if s == 200 else []
    check("Member's bell shows the new prospect", any("E2E PFU Prospect" in (i.get("title") or "") for i in items), (s, items[:2]))

    # ── Tasks (admin) ──
    due = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400))
    task = {"prospectId": pid, "title": "Invite to Tuesday meeting", "notes": "Ask about family", "assigneeMemberId": PLAIN,
            "dueDate": due, "remindDaysBefore": 1}
    s, _ = call("POST", f"{base}/prospect-tasks", t_plain, task)
    check("Ordinary member cannot create a task", s == 403, s)
    s, body = call("POST", f"{base}/prospect-tasks", t_admin, {**task, "assigneeMemberId": outsider})
    check("Task cannot go to a member of another club", s == 400, (s, body))
    s, body = call("POST", f"{base}/prospect-tasks", t_admin, {**task, "title": "  "})
    check("Task needs a title", s == 400, (s, body))
    other_pid = sql(f"SELECT pk_potential_member_id FROM potential_members WHERE fk_club_id<>{CLUB} AND isdeleted=0 LIMIT 1")
    if other_pid:
        s, _ = call("POST", f"{base}/prospect-tasks", t_admin, {**task, "prospectId": int(other_pid)})
        check("Task cannot point at another club's prospect", s == 404, s)
    s, body = call("POST", f"{base}/prospect-tasks", t_admin, task)
    check("Admin creates a task for the member", s == 200 and body.get("id"), (s, body))
    tid = body["id"]
    check("Assignee gets a task_assigned notice",
          sql(f"SELECT COUNT(*) FROM prospect_notifications WHERE fk_task_id={tid} AND kind='task_assigned' AND fk_member_id={PLAIN}") == "1")
    s, body = call("GET", f"{base}/prospect-tasks?status=open&prospectId={pid}", t_admin)
    check("Admin lists the prospect's open tasks", s == 200 and [t["id"] for t in body] == [tid] and body[0]["dueDate"] == due, (s, body))
    s, _ = call("GET", f"{base}/prospect-tasks", t_plain)
    check("Ordinary member cannot list the club's tasks", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{other}/prospect-tasks", t_admin)
    check("Admin cannot list another club's tasks", s == 403, s)

    # ── Reminder + email job ──
    check("Job writes the reminder (due tomorrow, remind 1 day before)",
          wait_for(f"SELECT COUNT(*) FROM prospect_notifications WHERE fk_task_id={tid} AND kind='task_reminder'", "1"))
    check("Task is marked reminded", sql(f"SELECT reminder_sent_at IS NOT NULL FROM prospect_tasks WHERE pk_task_id={tid}") == "1")
    check("Job emails every pending notice",
          wait_for(f"SELECT COUNT(*) FROM prospect_notifications WHERE fk_potential_member_id={pid} AND email_status='pending'", "0"))
    if plain_email and "@" in plain_email:
        time.sleep(2)
        check("Fake Brevo received the member's emails (prospect, assigned, reminder)", sent.count(plain_email) >= 3, sent.count(plain_email))
    s, body = call("GET", "/api/mobile/notifications?types=prospect_task", t_plain)
    titles = [i.get("title") for i in (body or {}).get("items", [])] if s == 200 else []
    check("Member's bell shows the task and its reminder",
          "Follow-up task: Invite to Tuesday meeting" in titles and "Reminder: Invite to Tuesday meeting" in titles, (s, titles[:4]))

    # ── The member in the app ──
    s, body = call("GET", "/api/mobile/prospect-tasks?status=open", t_plain)
    mine = [t for t in body if t["id"] == tid] if s == 200 else []
    check("Member sees the task with the prospect's contact details",
          len(mine) == 1 and mine[0]["prospectName"] == "E2E PFU Prospect" and mine[0]["prospectEmail"] == "pfue2e@example.org", (s, mine))
    s, body = call("GET", "/api/mobile/prospect-tasks", t_admin)
    check("Another member does not see it", s == 200 and all(t["id"] != tid for t in body), (s, body))
    s, _ = call("POST", f"/api/mobile/prospect-tasks/{tid}/complete", t_admin, {"note": "x"})
    check("Only the assignee can complete it", s == 404, s)
    s, _ = call("POST", f"/api/mobile/prospect-tasks/{tid}/complete", t_plain, {"note": "Coming on Tuesday"})
    check("Assignee completes it", s == 200, s)
    check("Task stored as done with the note",
          sql(f"SELECT CONCAT(status, '|', completed_by, '|', completion_note) FROM prospect_tasks WHERE pk_task_id={tid}") == f"done|{PLAIN}|Coming on Tuesday")
    s, _ = call("POST", f"/api/mobile/prospect-tasks/{tid}/complete", t_plain, {})
    check("Completing twice says not found", s == 404, s)

    # ── Admin edits: reopen + new due date re-arms the reminder ──
    later = time.strftime("%Y-%m-%d", time.localtime(time.time() + 10 * 86400))
    s, _ = call("PUT", f"{base}/prospect-tasks/{tid}", t_admin, {**task, "dueDate": later, "status": "open"})
    check("Admin reopens it with a new due date", s == 200, s)
    check("Reopen clears completion and re-arms the reminder",
          sql(f"SELECT CONCAT(status, completed_at IS NULL, reminder_sent_at IS NULL) FROM prospect_tasks WHERE pk_task_id={tid}") == "open11")
    s, _ = call("PUT", f"{base}/prospect-tasks/{tid}", t_admin, {**task, "status": "maybe"})
    check("Bad status refused", s == 400, s)
    s, _ = call("DELETE", f"/api/clubs/{other}/prospect-tasks/{tid}", t_admin)
    check("Admin of club A cannot delete via another club", s == 403, s)
    s, _ = call("DELETE", f"{base}/prospect-tasks/{tid}", t_admin)
    check("Admin deletes the task", s == 204, s)

    # ── Switch off: routes answer 404 ──
    call("PUT", f"/api/features/{FEATURE}", t_sa, {"enabled": False})
    s, _ = call("GET", "/api/mobile/prospect-tasks", t_plain)
    check("Feature off: app route is closed", s == 404, s)
finally:
    for pid in prospect_ids:
        sql(f"DELETE FROM potential_members WHERE pk_potential_member_id={pid}")  # cascades tasks and notices
    sql(f"DELETE FROM prospect_notify_members WHERE fk_club_id={CLUB}")
    sql(f"DELETE FROM prospect_notify_settings WHERE fk_club_id={CLUB}")
    if old_settings:
        p, c, i, e = old_settings.split(",")
        sql(f"INSERT INTO prospect_notify_settings (fk_club_id, to_president, to_membership_chair, by_in_app, by_email) VALUES ({CLUB},{p},{c},{i},{e})")
    for m in (old_members or "").split(","):
        if m.strip().isdigit():
            sql(f"INSERT INTO prospect_notify_members (fk_club_id, fk_member_id) VALUES ({CLUB},{m})")
    call("PUT", f"/api/features/{FEATURE}", t_sa, {"enabled": was_on})
    left = sql("SELECT COUNT(*) FROM potential_members WHERE name LIKE 'E2E PFU%'")
    check("Cleanup: no test prospects left", left == "0", left)
    server.shutdown()

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
