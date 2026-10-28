"""Emails in the member's language (build spec 3.3, 3.16; S5): server texts through ASP.NET Core's IStringLocalizer,
machine-translated into server_strings by StringTranslationBackgroundService.

    python -I kb/tools/message_language_e2e.py <api_base> <mysql_port> <database>
Environment: ROW_E2E_FAKE_BREVO_PORT (default 5198), ROW_E2E_FAKE_TRANSLATE_PORT (default 5298). Start the API with
Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email, Brevo__ApiKey=<anything>, Translation__Provider=libretranslate
and Translation__ApiUrl=http://127.0.0.1:<translate port>. Both servers run inside this script, so nothing leaves the
machine. The fake translator prefixes "ES:" and drops the placeholder of any text starting "Dear ", to prove a mangled
translation is refused. Local copies only: it sets one club admin's PrimaryLanguage to Spanish for the run and puts it
back, and deletes the reset tokens and server_strings rows it made.
"""
import json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5198'))
TRANSLATE_PORT = int(os.environ.get('ROW_E2E_FAKE_TRANSLATE_PORT', '5298'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0
mails, asked = [], []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def body(handler):
    if handler.headers.get("Transfer-Encoding", "").lower() == "chunked":
        data = b""
        while (size := int(handler.rfile.readline().split(b";")[0], 16)) != 0:
            data += handler.rfile.read(size)
            handler.rfile.readline()
        handler.rfile.readline()
        return data
    return handler.rfile.read(int(handler.headers.get("Content-Length", 0)))


def answer(handler, status, obj):
    out = json.dumps(obj).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(out)))
    handler.end_headers()
    handler.wfile.write(out)


class Brevo(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        mails.append(json.loads(body(self) or b"{}"))
        answer(self, 201, {"messageId": f"<e2e-{len(mails)}@e2e.invalid>"})

    def log_message(self, *args):
        pass


class Translate(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        req = json.loads(body(self) or b"{}")
        asked.append(req)
        q = req.get("q", "")
        text = ("ES:" + q.replace("{0}", "")) if q.startswith("Dear ") else ("ES:" + q)
        answer(self, 200, {"translatedText": text})

    def log_message(self, *args):
        pass


for port, handler in ((BREVO_PORT, Brevo), (TRANSLATE_PORT, Translate)):
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

# a club admin (not Super Admin) with an email: forgot-password mails only admins
row = sql("""SELECT m.pk_member_master_profile_id, m.EmailId, m.MemberName, IFNULL(m.PrimaryLanguage, 'NULL')
    FROM member_roles mr JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
    WHERE mr.fk_role_id = 2 AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
      AND IFNULL(m.EmailId, '') LIKE '%@%' AND m.MemberName NOT LIKE '%\\'%'
      AND NOT EXISTS (SELECT 1 FROM member_roles s WHERE s.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND s.fk_role_id = 3 AND s.IsActive = 1 AND s.isdeleted = 0)
    LIMIT 1""").split('\t')
member, email, name, was_lang = int(row[0]), row[1], row[2], row[3]
sql(f"UPDATE member_master_profile SET PrimaryLanguage = 'Spanish' WHERE pk_member_master_profile_id = {member}")


def reset_mail():
    before = len(mails)
    data = json.dumps({"email": email}).encode()
    req = urllib.request.Request(API + "/api/auth/forgot-password", data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()
    for _ in range(30):
        got = [m for m in mails[before:] if any(t.get("email", "").lower() == email.lower() for t in m.get("to", []))]
        if got:
            return got[-1]
        time.sleep(1)
    return None


try:
    first = reset_mail()
    check("the reset email is sent", first is not None)
    if first:
        check("before translating, the email is in English", "Password Reset Request" in first.get("htmlContent", ""),
              first.get("subject"))

    # the translator ticks every 20 seconds: wait until the email's texts have Spanish rows
    key = "We received a request to reset your password. Click the button below to set a new password:"
    for _ in range(40):
        if sql(f"SELECT COUNT(*) FROM server_strings WHERE language = 'es' AND english = '{key}'") == "1":
            break
        time.sleep(3)
    check("the email's texts were translated into Spanish (server_strings)",
          sql(f"SELECT text FROM server_strings WHERE language = 'es' AND english = '{key}'") == "ES:" + key)

    second = reset_mail()
    html = (second or {}).get("htmlContent", "")
    check("the second reset email is in the member's language", "ES:" + key in html, html[:300])
    check("the subject is translated, values filled in after", (second or {}).get("subject", "").startswith("ES:"),
          (second or {}).get("subject"))
    check("the reset link reaches the member unchanged", "reset-password?token=" in html)
    check("a translation that lost its placeholder is refused: the greeting stays English with the name",
          f"Dear {name}," in html and sql("SELECT COUNT(*) FROM server_strings WHERE language = 'es' AND english = 'Dear {0},'") == "0",
          html[:300])
    sent_text = " ".join(a.get("q", "") for a in asked)
    check("the provider saw no name, email or link", name not in sent_text and email not in sent_text and "token=" not in sent_text)
    check("the provider got only placeholders for values", any("{0}" in a.get("q", "") for a in asked))
finally:
    restore = "NULL" if was_lang == "NULL" else "'" + was_lang.replace("'", "''") + "'"
    sql(f"UPDATE member_master_profile SET PrimaryLanguage = {restore} WHERE pk_member_master_profile_id = {member}")
    sql(f"DELETE FROM password_reset_tokens WHERE fk_member_master_profile_id = {member} AND created_date > NOW() - INTERVAL 1 HOUR")
    sql("DELETE FROM server_strings WHERE text LIKE 'ES:%'")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
