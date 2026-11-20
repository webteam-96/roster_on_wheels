"""Mass email compose upgrades (gap agent, 2026-11-19): template library, merge fields, attachments, sender signature.

    python -I kb/tools/mass_email_compose_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET          the API's JwtSettings__Secret (32+ characters)
  ROW_E2E_EMAIL_SAFE=1        required: confirms the API's Brevo points at this script's fake server
  ROW_E2E_FAKE_BREVO_PORT     port of the fake Brevo server this script starts (default 5218)
  ROW_E2E_API_DIR             the API's content root (default row/api next to this repo), to remove stored files

Start the API with Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email and Brevo__ApiKey=<anything>.
Campaign recipient addresses are rewritten to e2e-<id>@example.invalid before sending, and Brevo is answered here, so
nothing leaves the machine. Uses club admin 1068 (club 341) and member 999 from the local copy. Everything created
(templates, campaign, recipients, attachments and their files, a credit wallet, a dues setup, the signature) is removed
at the end; audit_log rows stay (append-only by design). Local copies only, never production.
"""
import base64, hashlib, hmac, json, os, pathlib, subprocess, sys, threading, time
import urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
if os.environ.get('ROW_E2E_EMAIL_SAFE') != '1':
    sys.exit("Set ROW_E2E_EMAIL_SAFE=1 after pointing the API's Brevo at the fake server (see the header).")
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5218'))
API_DIR = pathlib.Path(os.environ.get('ROW_E2E_API_DIR', pathlib.Path(__file__).resolve().parents[2] / 'row' / 'api'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, PLAIN, TAG = 341, 1068, 999, "e2e-compose"
fails = 0
sent = []  # payloads the fake Brevo received


class FakeBrevo(BaseHTTPRequestHandler):
    def do_POST(self):
        sent.append(json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0)))))
        out = json.dumps({"messageId": f"<e2e-{len(sent)}@example.invalid>"}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
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


def call(method, path, tok, body=None, files=None, raw=False):
    h = {"Authorization": f"Bearer {tok}"}
    data = None
    if files is not None:
        name, content = files
        boundary = "e2eBOUNDARY7d9"
        data = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                f"Content-Type: application/octet-stream\r\n\r\n").encode() + content + f"\r\n--{boundary}--\r\n".encode()
        h["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        out, status = e.read(), e.code
    if raw:
        return status, out
    try:
        return status, json.loads(out or b"{}")
    except ValueError:
        return status, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


server = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), FakeBrevo)
threading.Thread(target=server.serve_forever, daemon=True).start()

t_admin, t_plain = token(ADMIN, "Admin"), token(PLAIN, "Member")
district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {CLUB}"))
other_club = int(sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id <> {district} AND IFNULL(isdeleted,0) = 0 "
                     "ORDER BY pk_club_id LIMIT 1"))
members = [int(x) for x in sql(
    f"SELECT m.pk_member_master_profile_id FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id "
    f"WHERE cm.fk_club_id = {CLUB} AND cm.IsActive = 1 AND cm.isdeleted = 0 AND IFNULL(m.EmailId,'') <> '' ORDER BY m.pk_member_master_profile_id LIMIT 2").split()]
old_signature = sql(f"SELECT COUNT(*) FROM mass_email_signatures WHERE fk_member_id = {ADMIN}")
templates, campaign, wallet, dues = [], None, None, None
T = f"/api/clubs/{CLUB}/mass-email-templates"

try:
    # ── Template library ───────────────────────────────────────────────────────────────────────────────────
    s, b = call("GET", T, t_admin)
    check("club admin gets the library with ROW starters and merge fields",
          s == 200 and len(b.get("starters", [])) >= 5 and any(f["token"] == "{{first_name}}" for f in b.get("mergeFields", [])), (s, b))
    check("plain member cannot read the club's templates (403)", call("GET", T, t_plain)[0] == 403)
    check("admin cannot read another club's templates (403)", call("GET", f"/api/clubs/{other_club}/mass-email-templates", t_admin)[0] == 403)

    s, b = call("POST", T, t_admin, {"name": f"{TAG} dues", "subject": "Dues for {{first_name}}",
                                      "bodyHtml": "<p>Hi {{first_name}}</p><script>alert(1)</script>"})
    check("admin saves a template", s == 200 and b.get("id"), (s, b))
    if s == 200:
        templates.append(b["id"])
        tid = b["id"]
        stored = sql(f"SELECT BodyHtml FROM mass_email_templates WHERE pk_template_id = {tid}")
        check("template body is sanitized (no script)", "<script" not in stored and "{{first_name}}" in stored, stored)
        s, _ = call("PUT", f"{T}/{tid}", t_admin, {"name": f"{TAG} dues 2", "subject": "Dues", "bodyHtml": "<p>x</p>"})
        check("admin updates the template", s == 200 and sql(f"SELECT Name FROM mass_email_templates WHERE pk_template_id = {tid}") == f"{TAG} dues 2")
        s, _ = call("PUT", f"/api/clubs/{other_club}/mass-email-templates/{tid}", t_admin, {"name": "hijack", "subject": "", "bodyHtml": "<p>x</p>"})
        check("template cannot be changed through another club's URL (403)", s == 403, s)
        s, _ = call("DELETE", f"{T}/{tid}", t_plain)
        check("plain member cannot delete a template (403)", s == 403, s)
        s, _ = call("DELETE", f"/api/districts/{district}/mass-email-templates/{tid}", t_admin)
        check("club template is not reachable from the district URL", s in (403, 404), s)
        s, b = call("GET", T, t_admin)
        check("saved template is listed", any(t["id"] == tid for t in b.get("saved", [])), b)
        s, _ = call("DELETE", f"{T}/{tid}", t_admin)
        check("admin deletes the template", s == 200 and call("GET", T, t_admin)[1].get("saved") is not None
              and not any(t["id"] == tid for t in call("GET", T, t_admin)[1]["saved"]))
    s, b = call("POST", T, t_admin, {"name": "", "subject": "x", "bodyHtml": ""})
    check("template without a name is refused (400)", s == 400, (s, b))

    # ── Signature ──────────────────────────────────────────────────────────────────────────────────────────
    s, b = call("PUT", "/api/mass-email/signature", t_admin, {"html": "<p>Asha, Secretary</p><img src=x onerror=alert(1)>"})
    check("sender saves a sanitized signature", s == 200 and "onerror" not in b.get("html", "") and "Secretary" in b.get("html", ""), (s, b))
    s, b = call("GET", "/api/mass-email/signature", t_admin)
    check("sender reads their own signature back", s == 200 and "Secretary" in b.get("html", ""), (s, b))
    s, b = call("GET", "/api/mass-email/signature", t_plain)
    check("another member does not see it", s == 200 and "Secretary" not in b.get("html", ""), (s, b))

    # ── Campaign with merge fields and attachments ─────────────────────────────────────────────────────────
    check("club has two members with email for the send test", len(members) == 2, members)
    s, b = call("POST", f"/api/clubs/{CLUB}/mass-emails", t_admin, {
        "recipientType": 3, "memberIds": members, "fromName": "e2e", "saveAsDraft": True,
        "subject": f"{TAG} for {{{{first_name}}}}",
        "emailBody": "<p>Dear {{first_name}} of {{club_name}}, dues {{dues_amount}}.</p><p>Asha, Secretary</p>"})
    check("draft campaign created", s == 200, (s, b))
    campaign = b.get("id")
    A = f"/api/clubs/{CLUB}/mass-emails/{campaign}/attachments"
    pdf = b"%PDF-1.4\n" + os.urandom(2000)
    s, att = call("POST", A, t_admin, files=("agenda.pdf", pdf))
    check("admin attaches a PDF", s == 200 and att.get("fileName") == "agenda.pdf" and att.get("sizeBytes") == len(pdf), (s, att))
    s, b = call("POST", A, t_admin, files=("setup.exe", b"MZ\x90\x00"))
    check("an .exe is refused (400)", s == 400, (s, b))
    s, b = call("POST", A, t_admin, files=("invoice.pdf", b"MZ\x90\x00\x03"))
    check("a program renamed to .pdf is refused (400)", s == 400 and "match" in b.get("message", ""), (s, b))
    s, b = call("POST", A, t_admin, files=("big.pdf", b"%PDF" + b"0" * (5 * 1024 * 1024 + 10)))
    check("a file over 5 MB is refused", s in (400, 413), s)
    s, b = call("POST", A, t_plain, files=("x.pdf", pdf))
    check("plain member cannot attach (403)", s == 403, s)
    s, b = call("POST", f"/api/clubs/{other_club}/mass-emails/{campaign}/attachments", t_admin, files=("x.pdf", pdf))
    check("cannot attach through another club's URL (403)", s == 403, s)
    s, b = call("GET", A, t_admin)
    check("attachment is listed once", s == 200 and len(b) == 1, (s, b))
    s, data = call("GET", f"{A}/{att.get('id')}/download", t_admin, raw=True)
    check("download returns the same bytes", s == 200 and data == pdf, s)
    s, _ = call("GET", f"{A}/{att.get('id')}/download", t_plain, raw=True)
    check("plain member cannot download (403)", s == 403, s)
    check("stored file is outside wwwroot", (API_DIR / "App_Data" / "mass-email-files").exists()
          and not any((API_DIR / "wwwroot").glob("**/*" + sql(f"SELECT StoredName FROM mass_email_attachments WHERE pk_attachment_id = {att.get('id')}"))))
    s, b = call("POST", A, t_admin, files=("note.txt", b"bring a friend"))
    s2, _ = call("DELETE", f"{A}/{b.get('id')}", t_admin)
    check("admin removes an attachment", s == 200 and s2 == 200 and len(call("GET", A, t_admin)[1]) == 1, (s, s2))

    # Recipients and money: fake addresses, a wallet and a dues setup that exist only for this run.
    sql(f"UPDATE club_mass_email_recipients SET Email = CONCAT('e2e-', pk_id, '@example.invalid') WHERE fk_mass_email_id = {campaign}")
    wallet = int(sql("INSERT INTO club_credits (fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount, FromDate, ToDate, IsActive, isdeleted) "
                     f"VALUES ({district}, {CLUB}, 'Email', 10, 0, CURDATE() - INTERVAL 1 DAY, CURDATE() + INTERVAL 30 DAY, 1, 0); SELECT LAST_INSERT_ID();"))
    dues = int(sql("INSERT INTO membership_dues (fk_district_id, fk_club_id, RotaryYear, Purpose, DefaultAnnualAmount, IsActive, isdeleted) "
                   f"VALUES ({district}, {CLUB}, '2026-27', '{TAG}', 1234.50, 1, 0); SELECT LAST_INSERT_ID();"))
    names = {m: sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = {m}") for m in members}
    club_name = sql(f"SELECT ClubName FROM club_master WHERE pk_club_id = {CLUB}")

    s, b = call("POST", f"/api/clubs/{CLUB}/mass-emails/{campaign}/send", t_admin)
    check("campaign send starts", s == 200, (s, b))
    for _ in range(60):
        if sql(f"SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = {campaign}") in ("Sent", "Failed"):
            break
        time.sleep(1)
    mine = [p for p in sent if TAG in p.get("subject", "")]
    check("both recipients were sent through the fake Brevo only",
          len(mine) == 2 and all(p["to"][0]["email"].endswith("@example.invalid") for p in mine), [p.get("to") for p in mine])
    firsts = sorted(p["subject"].split(" for ", 1)[-1] for p in mine)
    check("subject carries each recipient's first name", all("{{" not in f and f for f in firsts), firsts)
    check("body has the club name and the dues amount filled in",
          all(club_name in p["htmlContent"] and "1,234.50" in p["htmlContent"] and "{{" not in p["htmlContent"] for p in mine),
          [p.get("htmlContent", "")[:200] for p in mine])
    check("each email carries the PDF attachment",
          all(len(p.get("attachment", [])) == 1 and p["attachment"][0]["name"] == "agenda.pdf"
              and base64.b64decode(p["attachment"][0]["content"]) == pdf for p in mine), [p.get("attachment", [{}])[0].get("name") for p in mine])
    s, b = call("POST", A, t_admin, files=("late.pdf", pdf))
    check("attachments are locked once the email is sent (400)", s == 400, (s, b))
finally:
    server.shutdown()
    for t in templates:
        sql(f"DELETE FROM mass_email_templates WHERE pk_template_id = {t}")
    sql(f"DELETE FROM mass_email_templates WHERE Name LIKE '{TAG}%'")
    if old_signature == "0":
        sql(f"DELETE FROM mass_email_signatures WHERE fk_member_id = {ADMIN}")
    if campaign:
        stored = sql(f"SELECT StoredName FROM mass_email_attachments WHERE fk_mass_email_id = {campaign}").split()
        for name in stored:
            path = API_DIR / "App_Data" / "mass-email-files" / name
            if path.exists():
                path.unlink()
        sql(f"DELETE FROM mass_email_attachments WHERE fk_mass_email_id = {campaign}")
        sql(f"DELETE FROM club_credit_usage_history WHERE Source = 'MassEmail' AND SourceId = {campaign}")
        sql(f"DELETE FROM club_mass_email_recipients WHERE fk_mass_email_id = {campaign}")
        sql(f"DELETE FROM club_mass_emails WHERE pk_mass_email_id = {campaign}")
    if wallet:
        sql(f"DELETE FROM club_credits WHERE pk_credit_id = {wallet}")
    if dues:
        sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id = {dues}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
