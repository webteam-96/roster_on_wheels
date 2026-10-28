"""DGE booth sign-up and the per-club onboarding kit (build spec 3.1, 3.2).

    python -I kb/tools/booth_onboarding_e2e.py <api_base> <mysql_port> <database>
Environment: ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret); ROW_E2E_FAKE_BREVO_PORT (default 5198). Start the
API with Brevo__ApiUrl=http://127.0.0.1:<port>/v3/smtp/email and Brevo__ApiKey=<anything>: the planning and nudge
emails go to real member addresses, but only to the fake Brevo server this script runs. Local copies only.
Picks a district with no subscription, signs it up with a real member's email as the governor-elect, provisions
it, then removes the tenant rows, planning roles and the sign-up again (audit rows stay). Switches planning_mode
on for the run and restores it. Public sign-ups are rate limited with sign-in (10 a minute per IP).
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5198'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
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


def call(method, path, token=None, body=None, raw=False):
    headers = {"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})}
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, (data.decode() if raw else (json.loads(data) if data else {}))
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


brevo = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), Brevo)
threading.Thread(target=brevo.serve_forever, daemon=True).start()

sa = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
# a district with no subscription, and an active member of one of its clubs with an email, as the governor-elect
district, dge, email = sql("""SELECT c.fk_district_id, m.pk_member_master_profile_id, m.EmailId FROM club_members cm
    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
    WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND IFNULL(m.EmailId, '') <> ''
      AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions t WHERE t.fk_district_id = c.fk_district_id)
      AND (SELECT COUNT(*) FROM member_master_profile x WHERE x.EmailId = m.EmailId AND x.isdeleted = 0) = 1
    LIMIT 1""").split("\t")
district, dge = int(district), int(dge)
edition = sql("SELECT code FROM edition_catalogue WHERE code <> 'club_basic' ORDER BY code LIMIT 1")
was = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='planning_mode'")
sid = None
try:
    call("PUT", "/api/features/planning_mode", sa, {"enabled": False})
    s, b = call("GET", "/api/public/booth/options")
    check("sign-ups are closed while planning mode is off", s == 200 and b.get("open") is False, b)
    call("PUT", "/api/features/planning_mode", sa, {"enabled": True})
    s, b = call("GET", "/api/public/booth/options")
    check("the public page lists districts and plans", b.get("open") is True and any(d["id"] == district for d in b["districts"]) and b["editions"], (s, str(b)[:200]))
    s, b = call("POST", "/api/public/booth/signups", body={"districtId": district, "editionCode": edition, "memberBand": "1-1500", "name": "E2E Governor-elect", "email": "not-an-email"})
    check("a bad email is refused", s == 400, s)
    s, b = call("POST", "/api/public/booth/signups", body={"districtId": district, "editionCode": edition, "memberBand": "1-1500", "name": "E2E Governor-elect", "email": email})
    sid = b.get("id")
    check("a governor-elect signs up without an account", s == 200 and b.get("status") == "awaiting_payment", (s, b))
    s, b = call("POST", "/api/public/booth/signups", body={"districtId": district, "editionCode": edition, "memberBand": "1501+", "name": "E2E Governor-elect", "email": email})
    check("signing up again updates the same sign-up", b.get("id") == sid, b)
    check("nothing is provisioned before payment", sql(f"SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id={district}") == "0")
    s, _ = call("GET", "/api/booth/signups", sign(dge, "Member"))
    check("only Super Admin sees sign-ups", s == 403, s)
    s, rows = call("GET", "/api/booth/signups", sa)
    check("Super Admin sees it waiting for payment", any(r["id"] == sid and r["status"] == "awaiting_payment" for r in rows), rows[:2])
    s, b = call("POST", f"/api/booth/signups/{sid}/provision", sa, {"paymentNote": "Paid by card at the booth (e2e)"})
    check("marking it paid sets the district up", s == 200 and b.get("status") == "provisioned", (s, b))
    check("the tenant is in planning with the chosen plan",
          sql(f"SELECT CONCAT(state, '|', edition_code, '|', IFNULL(member_band, '')) FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0") == f"planning|{edition}|1501+")
    clubs = int(sql(f"SELECT COUNT(*) FROM club_master WHERE fk_district_id={district} AND isdeleted=0"))
    check("every club gets Club Basic (or Rotaract)", sql(f"SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id > 0") == str(clubs))
    check("planning starts with the governor-elect", "launchpad" in b.get("result", "") and sql(
        f"SELECT COUNT(*) FROM planning_roles WHERE fk_district_id={district} AND role_code='DGE' AND fk_member_id={dge} AND live=1") == "1", b.get("result"))
    check("the governor-elect is emailed", any(t.get("email") == email for m in sent for t in m.get("to", [])), len(sent))
    s, _ = call("POST", f"/api/booth/signups/{sid}/provision", sa, {})
    check("a sign-up is provisioned once", s == 409, s)

    club = int(sql(f"SELECT MIN(pk_club_id) FROM club_master WHERE fk_district_id={district} AND isdeleted=0"))
    s, html = call("GET", f"/api/districts/{district}/onboarding-kit/clubs/{club}", sa, raw=True)
    check("the onboarding kit page lists the authorisation steps", s == 200 and "My Rotary" in html and "<ol>" in html, (s, str(html)[:200]))
    check("the governor-elect, with district rights in planning, opens the kit too",
          call("GET", f"/api/districts/{district}/onboarding-kit/clubs/{club}", sign(dge, "Member"), raw=True)[0] == 200)
    plain = int(sql(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
        WHERE c.fk_district_id <> {district} AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_member_master_profile_id <> {dge}
          AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = cm.fk_member_master_profile_id
                          AND r.fk_role_id IN (2, 3) AND r.IsActive = 1 AND r.isdeleted = 0) LIMIT 1"""))
    s, _ = call("GET", f"/api/districts/{district}/onboarding-kit/clubs/{club}", sign(plain, "Member"), raw=True)
    check("a plain member cannot open kits", s == 403, s)
    s, b = call("POST", f"/api/districts/{district}/onboarding-kit/clubs/{club}/nudge", sa)
    check("the nudge goes to the president and secretary, or says there are none", (s == 200 and b.get("sent", 0) > 0) or s == 409, (s, b))
finally:
    sql(f"DELETE FROM planning_roles WHERE fk_district_id={district}")
    sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id={district}")
    if sid:
        sql(f"DELETE FROM booth_signups WHERE pk_signup_id={sid}")
    call("PUT", "/api/features/planning_mode", sa, {"enabled": was == "1"})
    brevo.shutdown()

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
