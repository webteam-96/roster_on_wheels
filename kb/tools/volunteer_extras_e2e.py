"""Volunteer sheet extras (gap module, beats ClubRunner Enhanced Volunteers): a custom confirmation email per sheet,
scheduled follow-up emails (reminder N days before, thank-you after) sent once each by the background job, archive and
copy a sheet, email the volunteer list to the sheet's coordinators, and the app's "my sign-ups" with reminder content.
Also role gating and each club seeing only its own sheets.

    python -I kb/tools/volunteer_extras_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET         the API's JwtSettings__Secret
  ROW_E2E_FAKE_BREVO_PORT    port of the fake Brevo server this script starts (default 5225)

Start the API with Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email, Brevo__ApiKey=<anything>,
VolunteerFollowups__Enabled=true and VolunteerFollowups__TickSeconds=5. Nothing leaves the machine: every email the
API sends lands on the fake Brevo server here (members' real addresses included). Local copies only. Removes its
sheets, events and email_log rows at the end and restores the "volunteers" switch; audit_log rows stay (append-only).
"""
import base64, hashlib, hmac, json, os, random, subprocess, sys, threading, time, urllib.error, urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5225'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MARK = 'e2e-volx'
fails = 0
sent = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(float(v)) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, ip=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    if ip:
        headers["X-Forwarded-For"] = ip
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, rtype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, rtype = e.read(), e.code, e.headers.get("Content-Type", "")
    if "json" in rtype and payload:
        return status, json.loads(payload)
    return status, payload


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def msg(r):
    return r[1].get("message") if isinstance(r[1], dict) else r[1]


def at(delta):
    return (datetime.now() + delta).replace(microsecond=0).isoformat()


class Brevo(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def body(self):
        if self.headers.get("Transfer-Encoding", "").lower() != "chunked":
            return self.rfile.read(int(self.headers.get("Content-Length", 0)))
        data = b""
        while True:
            size = int(self.rfile.readline().split(b";")[0], 16)
            if size == 0:
                self.rfile.readline()
                return data
            data += self.rfile.read(size)
            self.rfile.readline()

    def do_POST(self):
        payload = json.loads(self.body() or b"{}")
        sent.append(payload)
        out = json.dumps({"messageId": f"<e2e-volx-{len(sent)}@e2e.invalid>"}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


brevo = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), Brevo)
threading.Thread(target=brevo.serve_forever, daemon=True).start()


def mails(subject_part):
    return [m for m in list(sent) if subject_part in m.get("subject", "")]


def to_of(m):
    return (m.get("to") or [{}])[0].get("email", "")


def wait_for(cond, seconds=40):
    end = time.time() + seconds
    while time.time() < end:
        if cond():
            return True
        time.sleep(1)
    return cond()


# ── People and places, picked by query ─────────────────────────────────────────────────────────────────────────
ADMIN_ROLE = "r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0"
NO_ROLES = ("NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id=cm.fk_member_master_profile_id "
            "AND x.fk_role_id<>1 AND x.IsActive=1 AND x.isdeleted=0)")
PLAIN = (f"SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
         f"ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND IFNULL(m.isdeleted,0)=0 "
         f"AND NULLIF(TRIM(m.EmailId),'') IS NOT NULL "
         f"WHERE cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND {NO_ROLES} AND cm.fk_club_id=")
ACTIVE_CHAIN = ("JOIN district_master d ON d.pk_district_id=c.fk_district_id AND d.IsActive=1 AND d.isdeleted=0 "
                "JOIN zone_master z ON z.pk_zone_id=d.fk_zone_id AND z.IsActive=1 AND z.isdeleted=0")
clubs = [int(x) for x in sql(
    "SELECT DISTINCT r.fk_club_id FROM member_roles r JOIN club_master c ON c.pk_club_id=r.fk_club_id "
    f"{ACTIVE_CHAIN} WHERE {ADMIN_ROLE} AND c.IsActive=1 AND IFNULL(c.isdeleted,0)=0 "
    "AND (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id "
    "AND NULLIF(TRIM(m.EmailId),'') IS NOT NULL WHERE cm.fk_club_id=c.pk_club_id AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 "
    f"AND {NO_ROLES})>=3 ORDER BY 1 LIMIT 2").split()]


def admin_of(club, other):
    """An Admin of this club who is not an Admin of the other club and has no district-wide role."""
    return one(f"SELECT r.fk_member_master_profile_id FROM member_roles r WHERE {ADMIN_ROLE} AND r.fk_club_id={club} "
               "AND NOT EXISTS (SELECT 1 FROM member_roles y WHERE y.fk_member_master_profile_id=r.fk_member_master_profile_id "
               f"AND y.IsActive=1 AND y.isdeleted=0 AND (y.fk_role_id IN (3,4,7) OR y.fk_club_id={other} "
               "OR (y.fk_role_id=2 AND IFNULL(y.fk_club_id,0)=0))) ORDER BY 1 LIMIT 1")


club_a, club_b = clubs[0], clubs[1]
admin_a, admin_b = admin_of(club_a, club_b), admin_of(club_b, club_a)
plain, plain2, coord = [int(x) for x in sql(PLAIN + f"{club_a} ORDER BY 1 LIMIT 3").split()]
other = one(PLAIN + f"{club_b} AND cm.fk_member_master_profile_id NOT IN "
            f"(SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club_a}) ORDER BY 1 LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
assert None not in (admin_a, admin_b, plain, plain2, coord, other, sa), "test data missing"
email_of = lambda m: sql(f"SELECT LOWER(TRIM(EmailId)) FROM member_master_profile WHERE pk_member_master_profile_id={m}")
print(f"clubs {club_a}/{club_b}, admins {admin_a}/{admin_b}, members {plain}/{plain2}/{coord}/{other}")

t_a, t_b, t_sa = token(admin_a, "Admin"), token(admin_b, "Admin"), token(sa, "SuperAdmin")
t_plain, t_plain2, t_other = token(plain, "Member"), token(plain2, "Member"), token(other, "Member")


def cleanup():
    sql(f"DELETE FROM volunteer_sheets WHERE title LIKE '{MARK}%'; "
        f"DELETE FROM email_log WHERE subject LIKE '%{MARK}%'")


cleanup()
flag_before = sql("SELECT enabled FROM platform_features WHERE feature_key='volunteers'")
A, B = f"/api/clubs/{club_a}/volunteer-sheets", f"/api/clubs/{club_b}/volunteer-sheets"

try:
    r = call("PUT", "/api/features/volunteers", t_sa, {"enabled": True})
    check("SuperAdmin switches volunteers on", r[0] == 204, r)

    slots = [{"task": f"{MARK} soon", "startsAt": at(timedelta(days=2)), "endsAt": at(timedelta(days=2, hours=2)), "capacity": 5},
             {"task": f"{MARK} later", "startsAt": at(timedelta(days=6)), "capacity": 5}]
    form = {"title": f"{MARK} park clean-up", "description": "Bring gloves.", "isPublic": True, "status": "open", "slots": slots}
    r = call("POST", A, t_a, form)
    check("club admin creates a sheet", r[0] == 200 and r[1].get("id"), r)
    sheet = r[1]["id"]
    detail = call("GET", f"{A}/{sheet}", t_a)[1]
    soon, later = detail["slots"][0]["id"], detail["slots"][1]["id"]
    tok = detail["publicToken"]
    X = f"{A}/{sheet}"

    # ── Gating ────────────────────────────────────────────────────────────────────────────────────────────────
    check("plain member cannot read the extras", call("GET", f"{X}/extras", t_plain)[0] == 403)
    check("another club's admin cannot read them", call("GET", f"{X}/extras", t_b)[0] == 403)
    check("another club's admin cannot reach the sheet through their own club", call("GET", f"{B}/{sheet}/extras", t_b)[0] == 404)
    check("another club's admin cannot archive it", call("PUT", f"{B}/{sheet}/archive", t_b, {"archived": True})[0] == 404)
    check("another club's admin cannot copy it", call("POST", f"{B}/{sheet}/copy", t_b, {"shiftDays": 0})[0] == 404)
    check("another club's admin cannot email its list", call("POST", f"{B}/{sheet}/email-coordinators", t_b)[0] == 404)
    r = call("GET", f"{X}/extras", t_a)
    check("club admin reads the extras (empty, with the club's members to pick)", r[0] == 200 and r[1]["followups"] == []
          and r[1]["confirmationText"] is None and any(m["memberId"] == coord for m in r[1]["members"]), r)

    # ── No confirmation text: no confirmation email ───────────────────────────────────────────────────────────
    check("member signs up before a confirmation text exists", call("POST", f"/api/mobile/volunteers/slots/{soon}/signup", t_plain2)[0] == 204)
    time.sleep(1)
    check("no confirmation email without a text", mails("You are signed up") == [], [m.get("subject") for m in sent])

    # ── Save extras: validation ───────────────────────────────────────────────────────────────────────────────
    fu = [{"kind": "before", "days": 3, "subject": f"{MARK} reminder", "body": "See you there.\n\nPark gate at 9."},
          {"kind": "after", "days": 0, "subject": f"{MARK} thank you", "body": "Thank you for helping."}]
    body = {"confirmationText": f"Thanks for joining {MARK}.\nWear boots.", "followups": fu, "coordinatorIds": [coord]}
    check("a reminder 0 days before is refused", call("PUT", f"{X}/extras", t_a, dict(body, followups=[dict(fu[0], days=0)]))[0] == 400)
    check("an unknown kind is refused", call("PUT", f"{X}/extras", t_a, dict(body, followups=[dict(fu[0], kind="soon")]))[0] == 400)
    check("six follow-ups are refused", call("PUT", f"{X}/extras", t_a, dict(body, followups=[fu[1]] * 6))[0] == 400)
    r = call("PUT", f"{X}/extras", t_a, dict(body, coordinatorIds=[other]))
    check("a coordinator from another club is refused", r[0] == 400 and "members" in str(msg(r)), r)
    check("plain member cannot save extras", call("PUT", f"{X}/extras", t_plain, body)[0] == 403)
    r = call("PUT", f"{X}/extras", t_a, body)
    check("club admin saves confirmation text, two follow-ups and a coordinator", r[0] == 200 and len(r[1]["followups"]) == 2
          and r[1]["coordinatorIds"] == [coord] and "Wear boots" in (r[1]["confirmationText"] or ""), r)
    fids = {f["kind"]: f["id"] for f in r[1]["followups"]}

    # ── Confirmation emails (member and public link) ──────────────────────────────────────────────────────────
    check("member signs up for the soon slot", call("POST", f"/api/mobile/volunteers/slots/{soon}/signup", t_plain)[0] == 204)
    check("member gets the club's confirmation text", wait_for(lambda: any(
        to_of(m) == email_of(plain) and "Wear boots" in m.get("htmlContent", "") for m in mails(f"You are signed up: {MARK} soon")), 10),
        [m.get("subject") for m in sent])
    check("member signs up for the later slot", call("POST", f"/api/mobile/volunteers/slots/{later}/signup", t_plain)[0] == 204)
    ft = call("GET", f"/api/public/volunteers/{tok}")[1]["formToken"]
    time.sleep(3.3)
    ip = f"10.{random.randint(1, 254)}.{random.randint(1, 254)}.{random.randint(1, 254)}"
    person = {"slotId": soon, "name": f"{MARK} Visitor", "email": "e2e-volx-visitor@example.invalid", "consent": True, "formToken": ft}
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=person, ip=ip)
    check("non-member signs up through the public link", r[0] == 200, r)
    check("non-member gets the confirmation with the text encoded", wait_for(lambda: any(
        to_of(m) == "e2e-volx-visitor@example.invalid" and "Thanks for joining" in m.get("htmlContent", "")
        for m in mails(f"You are signed up: {MARK} soon")), 10), [m.get("subject") for m in sent])

    # ── Follow-ups: the job sends each once ───────────────────────────────────────────────────────────────────
    # the later slot is moved into the past so its thank-you is due; its 3-days-before reminder is then too late
    sql(f"UPDATE volunteer_slots SET starts_at = NOW() - INTERVAL 1 DAY, ends_at = NOW() - INTERVAL 20 HOUR WHERE pk_slot_id = {later}")
    sends = lambda: one(f"SELECT COUNT(*) FROM volunteer_followup_sends s JOIN volunteer_followups f ON f.pk_followup_id=s.fk_followup_id "
                        f"WHERE f.fk_sheet_id={sheet}")
    check("the job sends the due follow-ups", wait_for(lambda: sends() >= 4, 40), sends())
    time.sleep(12)  # two more passes: nothing is sent twice
    rem, thanks = mails(f"{MARK} reminder"), mails(f"{MARK} thank you")
    check("reminder 3 days before goes to the three people on the soon slot, once each",
          sorted(to_of(m) for m in rem) == sorted([email_of(plain), email_of(plain2), "e2e-volx-visitor@example.invalid"]),
          [to_of(m) for m in rem])
    check("reminder carries the club's text and the slot", all("Park gate at 9." in m.get("htmlContent", "") and f"{MARK} soon" in m["htmlContent"] for m in rem))
    check("thank-you goes once, only to the member on the finished slot", [to_of(m) for m in thanks] == [email_of(plain)],
          [to_of(m) for m in thanks])
    check("no reminder for a slot that already started", one(f"SELECT COUNT(*) FROM volunteer_followup_sends s JOIN volunteer_signups su "
                                                           f"ON su.pk_signup_id=s.fk_signup_id WHERE su.fk_slot_id={later} AND s.fk_followup_id={fids['before']}") == 0)
    r = call("GET", f"{X}/extras", t_a)
    check("the admin sees how many each follow-up went to", {f["kind"]: f["sentCount"] for f in r[1]["followups"]} == {"before": 3, "after": 1}, r)
    # editing a follow-up keeps what was sent
    r = call("PUT", f"{X}/extras", t_a, dict(body, followups=[dict(fu[0], id=fids["before"], subject=f"{MARK} reminder edited"), dict(fu[1], id=fids["after"])]))
    time.sleep(7)
    check("an edited follow-up is not sent again", r[0] == 200 and mails(f"{MARK} reminder edited") == [], r)

    # ── App: my sign-ups with the reminder content ───────────────────────────────────────────────────────────
    r = call("GET", "/api/mobile/volunteers/my-signups", t_plain)
    mine = [s for s in r[1] if s["slotId"] == soon] if r[0] == 200 else []
    check("app lists the member's coming sign-up with the confirmation text", len(mine) == 1 and "Wear boots" in (mine[0]["confirmationText"] or ""), r)
    rems = mine[0]["reminders"] if mine else []
    check("app shows the reminder text, when it is due and that it went", any(x["kind"] == "before" and "Park gate" in x["body"]
          and x["sentAt"] for x in rems) and any(x["kind"] == "after" and not x["sentAt"] for x in rems), rems)
    check("app does not list the finished slot", r[0] == 200 and all(s["slotId"] != later for s in r[1]))
    r = call("GET", "/api/mobile/volunteers/my-signups", t_other)
    check("another member sees none of these sign-ups", r[0] == 200 and all(s["slotId"] not in (soon, later) for s in r[1]), r)

    # ── Email the list to the coordinators ───────────────────────────────────────────────────────────────────
    check("plain member cannot email the list", call("POST", f"{X}/email-coordinators", t_plain)[0] == 403)
    r = call("POST", f"{X}/email-coordinators", t_a)
    check("club admin emails the list to the coordinator", r[0] == 200 and r[1]["sent"] == 1, r)
    lst = mails(f"Volunteer list: {MARK}")
    check("the coordinator gets the list with the volunteers", wait_for(lambda: len(mails(f"Volunteer list: {MARK}")) == 1, 10)
          and to_of(mails(f"Volunteer list: {MARK}")[0]) == email_of(coord)
          and f"{MARK} Visitor" in mails(f"Volunteer list: {MARK}")[0].get("htmlContent", ""), [to_of(m) for m in lst])
    call("PUT", f"{X}/extras", t_a, dict(body, coordinatorIds=[]))
    r = call("POST", f"{X}/email-coordinators", t_a)
    check("without coordinators the admin is told to add them", r[0] == 400 and "coordinators" in str(msg(r)), r)

    # ── Archive and copy ─────────────────────────────────────────────────────────────────────────────────────
    check("plain member cannot archive", call("PUT", f"{X}/archive", t_plain, {"archived": True})[0] == 403)
    check("club admin archives the sheet", call("PUT", f"{X}/archive", t_a, {"archived": True})[0] == 204)
    lst = [s for s in call("GET", A, t_a)[1] if s["id"] == sheet]
    check("the list marks it archived and closed", lst and lst[0]["archivedAt"] and lst[0]["status"] == "closed", lst)
    check("an archived sheet's public link is closed", call("GET", f"/api/public/volunteers/{tok}")[0] == 404)
    check("an archived sheet takes no new sign-ups", call("POST", f"/api/mobile/volunteers/slots/{soon}/signup", t_other)[0] in (403, 404))
    check("club admin unarchives it", call("PUT", f"{X}/archive", t_a, {"archived": False})[0] == 204
          and [s for s in call("GET", A, t_a)[1] if s["id"] == sheet][0]["archivedAt"] is None)
    check("a copy cannot move slots by a negative number of days", call("POST", f"{X}/copy", t_a, {"shiftDays": -1})[0] == 400)
    r = call("POST", f"{X}/copy", t_a, {"shiftDays": 7})
    check("club admin copies the sheet", r[0] == 200 and r[1].get("id") and r[1]["id"] != sheet, r)
    copy = r[1]["id"]
    c = call("GET", f"{A}/{copy}", t_a)[1]
    check("the copy is open, titled as a copy, with a new link and empty slots",
          c["status"] == "open" and c["title"] == f"{MARK} park clean-up (copy)" and c["publicToken"] != tok
          and len(c["slots"]) == 2 and all(s["filled"] == 0 and s["signups"] == [] for s in c["slots"]), c)
    moved = one(f"SELECT TIMESTAMPDIFF(DAY, o.starts_at, n.starts_at) FROM volunteer_slots o JOIN volunteer_slots n "
                f"ON n.fk_sheet_id={copy} AND n.task=o.task WHERE o.pk_slot_id={soon}")
    check("the copy's slots move by 7 days", moved == 7, moved)
    cx = call("GET", f"{A}/{copy}/extras", t_a)[1]
    check("the copy keeps the confirmation text and follow-ups, none sent yet",
          "Wear boots" in (cx["confirmationText"] or "") and len(cx["followups"]) == 2 and all(f["sentCount"] == 0 for f in cx["followups"]), cx)
finally:
    cleanup()
    call("PUT", "/api/features/volunteers", t_sa, {"enabled": flag_before == "1"})
    if flag_before == "":
        sql("DELETE FROM platform_features WHERE feature_key='volunteers'")
    brevo.shutdown()

left = one(f"SELECT COUNT(*) FROM volunteer_sheets WHERE title LIKE '{MARK}%'")
check("test rows removed", left == 0, left)
print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
