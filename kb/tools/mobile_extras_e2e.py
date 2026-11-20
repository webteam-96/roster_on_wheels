"""Mobile extras (gap agent, 2026-11-20): leader-sent password reset + member-to-member contact exchange by QR.

    python -I kb/tools/mobile_extras_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET         the API's JwtSettings__Secret
  ROW_E2E_FAKE_BREVO_PORT    port of the fake Brevo server this script starts (default 5229)

Start the API with Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email and Brevo__ApiKey=<anything>: no email
leaves the machine, the reset email is caught here. Uses club admin 1068 and member 999 of club 341 (local copy).
Removes the reset requests and reset tokens it creates and restores member 999's privacy flag. audit_log rows stay
(append-only by design).
"""
import base64, hashlib, hmac, json, os, subprocess, sys, threading, time
import urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5229'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
ADMIN, MEMBER, CLUB = 1068, 999, 341
fails = 0
mails = []


class FakeBrevo(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        mails.append(json.loads(body or b'{}'))
        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"messageId":"<e2e@fake>"}')

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


def call(method, path, body=None, tok=None):
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    data = None
    if body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, raw.decode(errors='replace')


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
    if not ok:
        fails += 1


server = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), FakeBrevo)
threading.Thread(target=server.serve_forever, daemon=True).start()

admin, member = token(ADMIN, "Admin"), token(MEMBER, "Member")
start = sql("SELECT UTC_TIMESTAMP()")
flags_before = sql(f"SELECT ShowPhoneInMyClub + 0, ShowEmailInMyClub + 0 FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}").split("	")
hash_before = sql(f"SELECT MD5(COALESCE(MAX(PasswordHash),'')) FROM member_credentials WHERE fk_member_master_profile_id = {MEMBER}")
email_999 = sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}")
# A club 1068 does not manage, with an active member there.
other = sql(f"""SELECT cm.fk_club_id, cm.fk_member_master_profile_id FROM club_members cm
               WHERE cm.fk_club_id <> {CLUB} AND cm.IsActive = 1 AND COALESCE(cm.isdeleted,0) = 0
                 AND cm.fk_club_id NOT IN (SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id = {ADMIN}
                                            AND IsActive = 1 AND isdeleted = 0 AND fk_club_id IS NOT NULL)
                 AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members
                                                             WHERE fk_club_id = {CLUB})
               LIMIT 1""").split('\t')
other_club, other_member = int(other[0]), int(other[1])
existing = int(sql(f"SELECT COUNT(*) FROM club_password_reset_requests WHERE fk_member_id = {MEMBER} "
                   f"AND created_utc > UTC_TIMESTAMP() - INTERVAL 24 HOUR"))
try:
    # ── (a) leader-sent password reset ──
    s, _ = call("POST", f"/api/clubs/{CLUB}/members/{ADMIN}/password-reset", tok=member)
    check("plain member cannot send a reset (403)", s == 403, s)
    s, _ = call("POST", f"/api/clubs/{CLUB}/members/{MEMBER}/password-reset")
    check("anonymous cannot send a reset (401)", s == 401, s)
    s, _ = call("POST", f"/api/clubs/{other_club}/members/{other_member}/password-reset", tok=admin)
    check("club admin cannot reach another club's member (403)", s == 403, s)
    s, _ = call("POST", f"/api/clubs/{CLUB}/members/{other_member}/password-reset", tok=admin)
    check("club admin cannot reset a non-member through their own club (404)", s == 404, s)
    check("no email sent by refused requests", len(mails) == 0, mails)

    sent_ok = 0
    for i in range(existing, 3):
        s, b = call("POST", f"/api/clubs/{CLUB}/members/{MEMBER}/password-reset", tok=admin)
        sent_ok += s == 200
        if i == existing:
            check("club admin sends a reset to own club member (200)", s == 200, (s, b))
            check("response shows only a masked address", s == 200 and "***@" in b.get("sentTo", "")
                  and email_999 not in json.dumps(b), b)
            check("response carries no reset token", s == 200 and "token" not in json.dumps(b).lower(), b)
    check("each allowed reset emailed once", len(mails) == sent_ok, (len(mails), sent_ok))
    if mails:
        m = mails[0]
        to = [t.get("email") for t in m.get("to", [])]
        html = m.get("htmlContent", "")
        check("reset email went to the member's own address", to == [email_999], to)
        check("reset email holds the reset-password link", "reset-password?token=" in html, html[:200])
    s, b = call("POST", f"/api/clubs/{CLUB}/members/{MEMBER}/password-reset", tok=admin)
    check("4th reset in 24h refused (429)", s == 429, (s, b))
    toks = int(sql(f"SELECT COUNT(*) FROM password_reset_tokens WHERE fk_member_master_profile_id = {MEMBER} "
                   f"AND created_date >= '{start}'"))
    check("one reset token per allowed reset", toks == sent_ok, (toks, sent_ok))
    check("password is untouched", sql(f"SELECT MD5(COALESCE(MAX(PasswordHash),'')) FROM member_credentials "
                                       f"WHERE fk_member_master_profile_id = {MEMBER}") == hash_before)
    audits = int(sql(f"SELECT COUNT(*) FROM audit_log WHERE action = 'PASSWORD_RESET_SENT' AND entity_id = {MEMBER} "
                     f"AND fk_member_master_profile_id = {ADMIN} AND created_date >= '{start}'"))
    check("each reset audited", audits == sent_ok, (audits, sent_ok))

    s, b = call("GET", f"/api/clubs/{CLUB}/password-resets", tok=admin)
    check("history lists the resets for the club admin", s == 200 and any(r["memberId"] == MEMBER and r["sentById"] == ADMIN for r in b), (s, b))
    check("history times are UTC", s == 200 and b and str(b[0]["sentAtUtc"]).endswith("Z"), b[:1] if s == 200 else b)
    s, _ = call("GET", f"/api/clubs/{CLUB}/password-resets", tok=member)
    check("plain member cannot read the history (403)", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{other_club}/password-resets", tok=admin)
    check("club admin cannot read another club's history (403)", s == 403, s)

    # ── (b) contact exchange by QR ──
    s, b = call("GET", "/api/contact-exchange/my-code", tok=member)
    code = b.get("code", "") if s == 200 else ""
    check("member gets a QR code", s == 200 and code.startswith(f"cx1.{MEMBER}."), (s, b))
    check("QR code holds no personal data", email_999 not in code and "@" not in code and "VCARD" not in code, code)
    s, b = call("POST", "/api/contact-exchange/scan", {"code": code}, tok=admin)
    check("scanning returns the card", s == 200 and b["memberId"] == MEMBER and b["name"], (s, b))
    check("card shows email when allowed", s == 200 and b["email"] == email_999, b)
    check("card carries a vCard", s == 200 and b["vcard"].startswith("BEGIN:VCARD") and "END:VCARD" in b["vcard"], b)

    sql(f"UPDATE member_master_profile SET ShowPhoneInMyClub = 0, ShowEmailInMyClub = 0 WHERE pk_member_master_profile_id = {MEMBER}")
    s, b = call("POST", "/api/contact-exchange/scan", {"code": code}, tok=admin)
    check("hidden phone and email are left out", s == 200 and b["phone"] is None and b["email"] is None
          and set(b["hidden"]) == {"phone", "email"}, b)
    check("hidden fields are not in the vCard", s == 200 and "TEL" not in b["vcard"] and "EMAIL" not in b["vcard"], b)
    s, b = call("POST", "/api/contact-exchange/scan", {"code": code}, tok=member)
    check("a member scanning own code sees own email", s == 200 and b["email"] == email_999, b)

    parts = code.split(".")
    s, _ = call("POST", "/api/contact-exchange/scan", {"code": f"cx1.{ADMIN}.{parts[2]}.{parts[3]}"}, tok=member)
    check("tampered code refused (400)", s == 400, s)
    s, _ = call("POST", "/api/contact-exchange/scan", {"code": "BEGIN:VCARD\r\nFN:x\r\nEND:VCARD"}, tok=admin)
    check("plain vCard / foreign QR refused (400)", s == 400, s)
    s, _ = call("POST", "/api/contact-exchange/scan", {"code": code})
    check("anonymous scan refused (401)", s == 401, s)
finally:
    sql(f"UPDATE member_master_profile SET ShowPhoneInMyClub = {flags_before[0]}, ShowEmailInMyClub = {flags_before[1]} "
        f"WHERE pk_member_master_profile_id = {MEMBER}")
    sql(f"DELETE FROM club_password_reset_requests WHERE fk_sent_by_id = {ADMIN} AND created_utc >= '{start}'")
    sql(f"DELETE FROM password_reset_tokens WHERE fk_member_master_profile_id = {MEMBER} AND created_date >= '{start}'")
    server.shutdown()

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
