"""Request a fresh pay link: mails only the address on record, one answer for everyone, rate limited.

    python -I kb/tools/pay_link_request_e2e.py <api_base> <mysql_port> <database>
Environment: ROW_E2E_FAKE_BREVO_PORT (default 5198). Start the API with Brevo__ApiUrl=http://127.0.0.1:<port>/v3/smtp/email
and Brevo__ApiKey=<anything>: mail goes to real member addresses of the copy, but only to the fake Brevo server this
script runs. Local copies only, never production. Adds dues and event links titled 'e2e-fresh-link', removes them at the
end. Restart the API before a rerun: the IP limit (10 per 10 minutes) and the address cap live in its memory.
"""
import json, os, re, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
assert "production" not in DB, "local copies only"
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5198'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
SEND_DELAY = 1.0  # a send done before the reply would show up in the reply's time
TITLE = "e2e-fresh-link"
fails = 0
mails = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:220]}"), flush=True)
    fails += 0 if ok else 1


class Brevo(BaseHTTPRequestHandler):
    def do_POST(self):
        mail = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        time.sleep(SEND_DELAY)
        mails.append(mail)
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"messageId":"<fresh@e2e.invalid>"}')

    def log_message(self, *a):
        pass


def ask(kind, id_, email):
    data = json.dumps({"kind": kind, "id": id_, "email": email}).encode()
    req = urllib.request.Request(API + "/api/public/pay-link-request", data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), time.time() - start
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.time() - start


def expect_mail():
    """Waits for one new mail; returns it, or None."""
    for _ in range(40):
        if mails:
            return mails.pop(0)
        time.sleep(0.25)
    return None


def expect_none():
    time.sleep(SEND_DELAY + 1.5)
    found = list(mails)
    mails.clear()
    return found


def key_of(mail, path):
    m = re.search(re.escape(path) + r"\?k=([A-Za-z0-9_\-]+)", mail["htmlContent"])
    return m.group(1) if m else None


def status(path):
    try:
        with urllib.request.urlopen(API + path, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), Brevo).serve_forever, daemon=True).start()

ELIGIBLE = """cm.IsActive=1 AND cm.isdeleted=0 AND m.isdeleted=0 AND COALESCE(cm.IsHonoraryMember,0)=0 AND m.EmailId LIKE '%@%.%'"""
club, member, email, name = sql(f"""SELECT cm.fk_club_id, m.pk_member_master_profile_id, m.EmailId, REPLACE(m.MemberName,' ','_')
    FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted=0
    WHERE {ELIGIBLE} AND LENGTH(m.MemberName) > 3
    AND (SELECT COUNT(*) FROM member_master_profile x WHERE x.EmailId = m.EmailId) = 1
    AND (SELECT COUNT(*) FROM club_members y WHERE y.fk_member_master_profile_id = m.pk_member_master_profile_id AND y.IsActive=1 AND y.isdeleted=0) = 1
    LIMIT 1""").split()
name = name.split('_')[0]
outsider = sql(f"""SELECT m.EmailId FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
    WHERE {ELIGIBLE} AND cm.fk_club_id <> {club}
    AND NOT EXISTS (SELECT 1 FROM member_master_profile x JOIN club_members z ON z.fk_member_master_profile_id = x.pk_member_master_profile_id
                    WHERE x.EmailId = m.EmailId AND z.fk_club_id = {club}) LIMIT 1""")
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {club}")
year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")


def dues(active):
    return sql(f"""INSERT INTO membership_dues (fk_club_id, fk_district_id, RotaryYear, Purpose, OnlineSurchargePercent, ModeOfPayment, IsActive, isdeleted)
        VALUES ({club},{district},'{year}','{TITLE}',0,3,{active},0); SELECT LAST_INSERT_ID();""")


def event(form):
    return sql(f"""INSERT INTO event_payment_links (Title, fk_club_id, FormType, IsActive, isdeleted)
        VALUES ('{TITLE}',{club},{form},1,0); SELECT LAST_INSERT_ID();""")


live, closed = dues(1), dues(0)
member_form, guest_form = event(1), event(2)
missing = int(sql("SELECT COALESCE(MAX(pk_membership_dues_id),0) + 1000 FROM membership_dues"))

try:
    # 1: the real member
    code, known_answer, took = ask("dues", int(live), email)
    check("a member's request is accepted", code == 200, code)
    check("the answer comes before the send", took < SEND_DELAY * 0.8, took)
    mail = expect_mail()
    check("a mail goes out", mail is not None)
    check("it goes only to the address on record", mail and [t["email"].lower() for t in mail["to"]] == [email.lower()], mail and mail["to"])
    check("the answer holds no member details", email.encode().lower() not in known_answer.lower() and name.encode() not in known_answer)
    key = key_of(mail, f"/pay/dues/{live}") if mail else None
    check("the mail carries a keyed pay link", bool(key))
    check("that key opens the member search",
          status(f"/api/public/membership-dues/{live}/search-members?query={urllib.parse.quote(name)}&k={key}") == 200)

    # 2-6: everyone else gets the same answer and no mail
    for label, kind, id_, addr in (
        ("an unknown address", "dues", int(live), "nobody.at.all@example.invalid"),
        ("a member of another club", "dues", int(live), outsider),
        ("a dues id that does not exist", "dues", missing, email),
        ("closed dues", "dues", int(closed), email),
        ("a guest form", "event", int(guest_form), email),
    ):
        code, answer, took = ask(kind, id_, addr)
        check(f"{label}: same status and text", code == 200 and answer == known_answer, (code, answer))
        check(f"{label}: same speed", took < SEND_DELAY * 0.8, took)
        found = expect_none()
        check(f"{label}: no mail", not found, [m["to"] for m in found])

    # 7: event link
    code, answer, _ = ask("event", int(member_form), email)
    check("event member form: same answer", code == 200 and answer == known_answer)
    mail = expect_mail()
    key = key_of(mail, f"/pay/{member_form}") if mail else None
    check("event member form: keyed link mailed to the record", bool(key) and mail["to"][0]["email"].lower() == email.lower())
    check("that key opens the event member search",
          status(f"/api/public/event-payment/{member_form}/search-members?query={urllib.parse.quote(name)}&k={key}") == 200)

    # 8: rubbish
    code, answer, _ = ask("nonsense", int(live), "not-an-email")
    check("rubbish input: same answer, no mail", code == 200 and answer == known_answer and not expect_none(), (code, answer))

    # 9-10: address cap (two used so far, three an hour). Different case, same address.
    code, answer, _ = ask("dues", int(live), email.upper())
    mail = expect_mail()
    check("third request in the hour: mailed, to the recorded spelling", mail is not None and mail["to"][0]["email"] == email, mail and mail["to"])
    code, answer, _ = ask("dues", int(live), email)
    found = expect_none()
    check("fourth request in the hour: same answer, no mail", code == 200 and answer == known_answer and not found, [m["to"] for m in found])

    # 11: IP limit. Exactly ten calls have been made above.
    code, _, _ = ask("dues", int(live), email)
    check("eleventh request from this IP: 429", code == 429, code)
finally:
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id IN ({live},{closed})")
    sql(f"DELETE FROM event_payment_links WHERE pk_id IN ({member_form},{guest_form})")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
