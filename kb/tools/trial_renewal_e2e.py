"""Trial lock-out and renewal reminders (build spec 3.5).

    python -I kb/tools/trial_renewal_e2e.py <api_base> <mysql_port> <database>
Environment: ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret); ROW_E2E_FAKE_BREVO_PORT (default 5198). Start the
API with Brevo__ApiUrl=http://127.0.0.1:<port>/v3/smtp/email and Brevo__ApiKey=<anything>: reminders go to the
district's real admin addresses, but only to the fake Brevo server this script runs. Local copies only. Switches planning_mode (trials) on for the run. Uses one
district's subscription row (restored at the end) and adds a test district admin (left soft-deleted).
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5198'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = "e2e-trial-" + secrets.token_hex(3)
fails = 0
sent = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def sign(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, token, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


class Brevo(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            data = b""
            while (size := int(self.rfile.readline().split(b";")[0], 16)) != 0:
                data += self.rfile.read(size)
                self.rfile.readline()
            self.rfile.readline()
        else:
            data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        sent.append(json.loads(data or b"{}"))
        out = json.dumps({"messageId": f"<e2e-{len(sent)}@e2e.invalid>"}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


def mine():
    return [m for m in sent if any(t.get("email", "").startswith(TAG) for t in m.get("to", []))]


brevo = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), Brevo)
threading.Thread(target=brevo.serve_forever, daemon=True).start()

sa = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
# a plain member whose active memberships are all in one district, and that district
member, district = [int(x) for x in sql("""SELECT cm.fk_member_master_profile_id, MIN(c.fk_district_id)
    FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
    WHERE cm.IsActive = 1 AND cm.isdeleted = 0
      AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = cm.fk_member_master_profile_id
                      AND r.fk_role_id IN (2, 3) AND r.IsActive = 1 AND r.isdeleted = 0)
    GROUP BY cm.fk_member_master_profile_id HAVING COUNT(DISTINCT c.fk_district_id) = 1 LIMIT 1""").split()]
had_row = sql(f"SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0") == "1"
saved = sql(f"""SELECT CONCAT_WS('|', IFNULL(trial_ends,'NULL'), IFNULL(term_end,'NULL'), auto_renew, IFNULL(renewal_notice_for,'NULL'),
    IFNULL(dunning_for,'NULL'), dunning_stage) FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0""") if had_row else ""
admin = None
planning_was = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='planning_mode'")
try:
    call("PUT", "/api/features/planning_mode", sa, {"enabled": True})  # trials are part of planning mode
    if not had_row:
        sql(f"INSERT INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code) SELECT {district}, 0, code FROM edition_catalogue ORDER BY code LIMIT 1")
    who = sign(member, "Member")
    sql(f"UPDATE tenant_subscriptions SET trial_ends = CURDATE() - INTERVAL 1 DAY WHERE fk_district_id={district} AND fk_club_id=0")
    s, b = call("GET", "/api/ri-codes", who)
    check("a member of a district whose trial ended is locked out", s == 403 and b.get("code") == "trial_expired", (s, b))
    s, _ = call("GET", "/api/ri-codes", sa)
    check("Super Admin is never locked out", s == 200, s)
    s, b = call("POST", f"/api/tenants/{district}/trial", sa)
    check("Super Admin extends the trial", s == 200, (s, b))
    s, _ = call("GET", "/api/ri-codes", who)
    check("the member is let back in at once", s == 200, s)
    s, _ = call("POST", f"/api/tenants/{district}/convert-trial", sa)
    check("converting ends the trial for good", s == 200 and sql(f"SELECT trial_ends IS NULL FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0") == "1", s)

    admin = int(sql(f"INSERT INTO member_master_profile (MemberName, EmailId) VALUES ('{TAG}', '{TAG}@example.invalid'); SELECT LAST_INSERT_ID();"))
    sql(f"""INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, fk_club_id, IsActive, isdeleted, created_date)
            VALUES ({admin}, 2, {district}, NULL, 1, 0, NOW())""")
    s, _ = call("POST", "/api/tenants/renewals/run", sign(member, "Member"))
    check("only Super Admin runs the reminders", s == 403, s)
    sql(f"UPDATE tenant_subscriptions SET term_end = CURDATE() + INTERVAL 30 DAY, auto_renew = 1, renewal_notice_for = NULL, dunning_stage = 0, dunning_for = NULL WHERE fk_district_id={district} AND fk_club_id=0")
    s, b = call("POST", "/api/tenants/renewals/run", sa)
    check("the district admin gets the renewal notice", s == 200 and any("renews on" in m.get("htmlContent", "") for m in mine()), (s, b, len(mine())))
    n = len(mine())
    call("POST", "/api/tenants/renewals/run", sa)
    check("the notice goes once per term end", len(mine()) == n, len(mine()))
    sql(f"UPDATE tenant_subscriptions SET term_end = CURDATE() - INTERVAL 10 DAY WHERE fk_district_id={district} AND fk_club_id=0")
    call("POST", "/api/tenants/renewals/run", sa)
    check("an overdue renewal sends reminder 1", any("Reminder 1 of 3" in m.get("htmlContent", "") for m in mine()[n:]), [m.get("subject") for m in mine()])
    n = len(mine())
    call("POST", "/api/tenants/renewals/run", sa)
    check("reminder 1 goes once", len(mine()) == n)
    sql(f"UPDATE tenant_subscriptions SET term_end = CURDATE() - INTERVAL 15 DAY, dunning_for = CURDATE() - INTERVAL 15 DAY, dunning_stage = 1 WHERE fk_district_id={district} AND fk_club_id=0")
    call("POST", "/api/tenants/renewals/run", sa)
    check("two weeks late sends reminder 2", any("Reminder 2 of 3" in m.get("htmlContent", "") for m in mine()[n:]), [m.get("subject") for m in mine()])
    s, t = call("GET", f"/api/tenants/{district}", sa)
    sub = t.get("subscription") or {}
    check("Settings > Tenants shows the reminder stage and auto-renew", sub.get("dunningStage") == 2 and sub.get("autoRenew") is True, sub)
finally:
    if had_row:
        te, tm, ar, rn, df, ds = saved.split("|")
        q = lambda v: "NULL" if v == "NULL" else f"'{v}'"
        sql(f"""UPDATE tenant_subscriptions SET trial_ends = {q(te)}, term_end = {q(tm)}, auto_renew = {ar}, renewal_notice_for = {q(rn)},
                dunning_for = {q(df)}, dunning_stage = {ds} WHERE fk_district_id={district} AND fk_club_id=0""")
    else:
        sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id={district}")
    if admin:
        sql(f"UPDATE member_roles SET isdeleted = 1, IsActive = 0 WHERE fk_member_master_profile_id = {admin}")
        sql(f"UPDATE member_master_profile SET isdeleted = 1 WHERE pk_member_master_profile_id = {admin}")
    call("PUT", "/api/features/planning_mode", sa, {"enabled": planning_was == "1"})
    brevo.shutdown()

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
