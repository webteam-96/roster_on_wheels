"""Email bulletin builder, resend to non-openers, story approval and non-member subscribers (competitor gap #6).

    python -I kb/tools/bulletins_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET       the API's JwtSettings__Secret
  ROW_E2E_EMAIL_SAFE=1     required for the send steps: says the API runs with
                           Brevo__ApiUrl=http://127.0.0.1:<ROW_E2E_FAKE_BREVO_PORT>/v3/smtp/email (any Brevo__ApiKey)
                           and Api__BaseUrl=<api_base> (the confirm and unsubscribe links point there)
  ROW_E2E_FAKE_BREVO_PORT  port of the fake Brevo server this script starts (default 5192)

Nothing leaves the machine: every send is answered by the fake Brevo here. The script also checks that each recipient
of the bulletin reached the fake server before it goes on. Club 341 (Colombo West), admin 1068, member 999. The club
has no email credits in the copy, so a temporary credit row is added and removed. Everything created is removed.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, threading, time
import re, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
EMAIL_SAFE = os.environ.get('ROW_E2E_EMAIL_SAFE') == '1'
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5192'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, MEMBER, OTHER_CLUB = 341, 1068, 999, 342
OUTSIDER = 2193  # active member of a club in another district, no roles
fails = 0


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


def call(method, path, body=None, tok=None, form=None):
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    data = None
    if form is not None:
        data, h["Content-Type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
    elif body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        return status, json.loads(raw or b"{}")
    except ValueError:
        return status, {"text": raw.decode("utf-8", "replace")}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


# ── Fake Brevo: records each send ───────────────────────────────────────────────────────────────
sent = []


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
        sent.append(json.loads(self.body() or b"{}"))
        out = json.dumps({"messageId": f"<e2e-{len(sent)}-{secrets.token_hex(4)}@e2e.invalid>"}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


def wait_status(cid, want=("Sent", "Failed")):
    status = ""
    for _ in range(120):
        status = sql(f"SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = {cid}")
        if status in want:
            return status
        time.sleep(0.5)
    return status


t_admin, t_member, t_none = token(ADMIN, ["Member"]), token(MEMBER, ["Member"]), token(OUTSIDER, ["Member"])
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {CLUB}")
tag = f"e2e-bulletin-{secrets.token_hex(3)}"
ann_ids, ev_ids, bulletin_ids, mail_ids, credit_id, board_id, sg_id = [], [], [], [], None, None, None
B = f"/api/clubs/{CLUB}/bulletins"
S = f"/api/club-stories/{CLUB}"
SUB1, SUB2 = f"e2e-sub1-{tag}@example.invalid", f"e2e-sub2-{tag}@example.invalid"


def to(p):
    return p.get("to", [{}])[0].get("email")


def wait_for(fn, tries=60):
    for _ in range(tries):
        v = fn()
        if v:
            return v
        time.sleep(0.5)
    return fn()

try:
    # ── test content: two news items and two events in the club ──
    for i in (1, 2):
        ann_ids.append(int(sql(f"INSERT INTO announcements (fk_district_id, fk_club_id, Title, Description, PublishDateTime, ExpiryDateTime, created_by) "
                               f"VALUES ({district}, {CLUB}, '{tag} news {i}', 'News body {i} <b>bold</b>', UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL 7 DAY, {ADMIN}); "
                               f"SELECT LAST_INSERT_ID();")))
        ev_ids.append(int(sql(f"INSERT INTO upcoming_events (fk_district_id, fk_club_id, Title, Description, EventDate, PublishDate, ExpiryDate, EventVenue, created_by) "
                              f"VALUES ({district}, {CLUB}, '{tag} event {i}', 'Event body {i}', UTC_TIMESTAMP() + INTERVAL {i} DAY, UTC_TIMESTAMP(), "
                              f"UTC_TIMESTAMP() + INTERVAL 9 DAY, 'Hall {i}', {ADMIN}); SELECT LAST_INSERT_ID();")))

    # ── stories: submit, review, only Approved reach the picker and the website ──
    s, b = call("POST", S, {"title": f"{tag} story A", "body": "Our <b>visit</b> to the school"}, t_member)
    story_a = b.get("id", 0)
    check("a member submits a story", s == 200 and story_a > 0, (s, b))
    s, b = call("POST", S, {"title": f"{tag} story X", "body": "x"}, t_none)
    check("a member of another club cannot submit", s == 403, (s, b))
    s, b = call("POST", S, {"title": "", "body": "x"}, t_member)
    check("a story needs a title", s == 400, (s, b))
    s, b = call("GET", S, tok=t_member)
    check("the author sees it, cannot review", s == 200 and b.get("canReview") is False and story_a in [x["id"] for x in b.get("items", [])], (s, b))
    s, b = call("POST", f"{S}/{story_a}/review", {"decision": "approve"}, t_member)
    check("a plain member cannot review", s == 403, (s, b))
    s, b = call("GET", f"/api/public/club/{CLUB}/stories")
    check("a pending story is not public", s == 200 and story_a not in [x["id"] for x in b], (s, b))
    s, b = call("POST", f"{S}/{story_a}/review", {"decision": "changes"}, t_admin)
    check("asking for changes needs a note", s == 400, (s, b))
    s, b = call("POST", f"{S}/{story_a}/review", {"decision": "changes", "note": "Add the date"}, t_admin)
    check("the editor asks for changes", s == 200, (s, b))
    s, b = call("GET", S, tok=t_member)
    mine = next((x for x in b.get("items", []) if x["id"] == story_a), {})
    check("the author sees the request and the note", mine.get("status") == "ChangesRequested" and mine.get("reviewNote") == "Add the date", mine)
    s, b = call("PUT", f"{S}/{story_a}", {"title": f"{tag} story A", "body": "Our visit to the school on 12 November"}, t_member)
    s2, b2 = call("PUT", f"{S}/{story_a}", {"title": "hijack", "body": "x"}, t_admin)
    check("the author edits it (Pending again); nobody else can", s == 200 and s2 == 404, (s, s2))
    s, b = call("POST", f"{S}/{story_a}/review", {"decision": "approve"}, t_admin)
    s2, _ = call("POST", f"{S}/{story_a}/review", {"decision": "reject", "note": "late"}, t_admin)
    check("approve; a decided story is not decided again", s == 200 and s2 == 404, (s, s2))
    s, b = call("DELETE", f"{S}/{story_a}", tok=t_member)
    check("an approved story cannot be withdrawn", s == 404, (s, b))
    s, b = call("POST", S, {"title": f"{tag} story B", "body": "Off topic"}, t_member)
    story_b = b.get("id", 0)
    # an editor office on this year's board may review too
    year = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted, 0) = 0 LIMIT 1")
    board_id = sql(f"INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, fk_designation_id, custom_designation, fk_year_id, created_by) "
                   f"SELECT {CLUB}, {MEMBER}, MIN(pk_designation_id), 'Bulletin Editor', {year}, {ADMIN} FROM designation_master WHERE designation_name NOT LIKE '%Public Image%'; SELECT LAST_INSERT_ID();")
    s, b = call("GET", S, tok=t_member)
    check("the bulletin editor office sees every story", s == 200 and b.get("canReview") is True, (s, b.get("canReview")))
    s, b = call("POST", f"{S}/{story_b}/review", {"decision": "reject", "note": "Not club news"}, t_member)
    check("the editor office rejects a story", s == 200, (s, b))
    sql(f"DELETE FROM board_of_directors WHERE pk_board_director_id = {board_id}")
    board_id = None
    s, b = call("GET", f"/api/public/club/{CLUB}/stories")
    ids = [x["id"] for x in b]
    check("the website lists the approved story only", s == 200 and story_a in ids and story_b not in ids
          and all("author" not in json.dumps(x).lower() for x in b), (s, b))

    # ── access ──
    s, _ = call("GET", B)
    check("no token: 401", s == 401, s)
    s, _ = call("GET", B, tok=t_none)
    check("a member of another club cannot list", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{OTHER_CLUB}/bulletins", tok=t_admin)
    check("the admin cannot list another club's bulletins", s == 403, s)
    s, _ = call("GET", f"{B}/options", tok=t_member)
    check("a plain member cannot see the picker options", s == 403, s)

    # ── options + validation ──
    s, opts = call("GET", f"{B}/options", tok=t_admin)
    check("options list the new news and events",
          s == 200 and set(ann_ids) <= {o["id"] for o in opts.get("announcements", [])} and set(ev_ids) <= {o["id"] for o in opts.get("events", [])}, (s, opts))
    story_opts = [o["id"] for o in opts.get("stories", [])]
    check("the picker offers approved stories only", story_a in story_opts and story_b not in story_opts, story_opts)
    s, b = call("POST", B, {"title": " ", "layout": "classic"}, t_admin)
    check("an empty heading is refused", s == 400, (s, b))
    s, b = call("POST", B, {"title": "x", "layout": "neon"}, t_admin)
    check("an unknown layout is refused", s == 400, (s, b))

    # ── draft: picked order is kept ──
    draft = {"title": f"{tag} weekly <script>", "intro": "Hello members", "presidentMessage": "Thanks all",
             "layout": "classic", "announcementIds": [ann_ids[1], ann_ids[0]], "eventIds": [ev_ids[1], ev_ids[0]], "storyIds": [story_a, story_b],
             "includeBirthdays": True, "includeSpeakers": True}
    s, b = call("POST", f"{B}/preview", draft, t_admin)
    html = b.get("html", "")
    check("preview renders picked items in the picked order",
          s == 200 and html.find(f"{tag} news 2") < html.find(f"{tag} news 1") != -1 and html.find(f"{tag} event 2") < html.find(f"{tag} event 1"), (s, html[:300]))
    check("preview encodes user text", "<script>" not in html and "&lt;b&gt;" in html, html[:300])
    check("preview carries the approved story, not the rejected one", f"{tag} story A" in html and f"{tag} story B" not in html, html[:300])
    s, b = call("POST", B, draft, t_admin)
    bid = b.get("id", 0)
    if bid:
        bulletin_ids.append(bid)
    check("create draft", s == 200 and bid > 0, (s, b))
    s, b = call("POST", f"/api/clubs/{OTHER_CLUB}/bulletins", draft, t_admin)
    check("cannot create a draft in another club", s == 403, (s, b))
    s, b = call("POST", B, draft, t_member)
    check("a plain member cannot create a draft", s == 403, (s, b))
    s, b = call("GET", f"{B}/{bid}", tok=t_admin)
    check("draft reads back with its order", s == 200 and b.get("announcementIds") == [ann_ids[1], ann_ids[0]]
          and b.get("eventIds") == [ev_ids[1], ev_ids[0]] and b.get("includeBirthdays") is True and b.get("html"), (s, b))
    draft["eventIds"] = [ev_ids[0]]
    draft["title"] = f"{tag} weekly"
    s, _ = call("PUT", f"{B}/{bid}", draft, t_admin)
    s2, b = call("GET", f"{B}/{bid}", tok=t_admin)
    check("update draft", s == 200 and b.get("eventIds") == [ev_ids[0]] and b.get("title") == f"{tag} weekly", (s, b))
    s, b = call("GET", f"{B}/{bid}", tok=t_member)
    check("a member cannot read a draft", s == 404, (s, b))
    s, b = call("GET", B, tok=t_member)
    check("a member's list holds no drafts", s == 200 and bid not in [x["id"] for x in b], (s, b))

    # deleting a draft
    s, b = call("POST", B, draft, t_admin)
    tmp = b.get("id", 0)
    bulletin_ids.append(tmp)
    s, _ = call("DELETE", f"{B}/{tmp}", tok=t_admin)
    s2, _ = call("GET", f"{B}/{tmp}", tok=t_admin)
    check("delete draft", s == 200 and s2 == 404, (s, s2))

    if not EMAIL_SAFE:
        print("SKIP send + resend (set ROW_E2E_EMAIL_SAFE=1 once the API points Brevo__ApiUrl at this script's fake server)")
    else:
        brevo = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), Brevo)
        threading.Thread(target=brevo.serve_forever, daemon=True).start()
        # ── subscribers: double opt-in ──
        S_UP = f"/api/public/club/{CLUB}/bulletin/subscribe"
        s, b = call("POST", S_UP, {"email": "not an email"})
        check("sign-up refuses a bad address", s == 400, (s, b))
        n0 = len(sent)
        s, b = call("POST", S_UP, {"email": f"e2e-bot-{tag}@example.invalid", "website": "http://spam"})
        check("the honeypot answers as usual and sends nothing", s == 200 and len(sent) == n0, (s, len(sent) - n0))
        s, b = call("POST", S_UP, {"email": SUB1.upper(), "name": "Sub One"})
        s2, _ = call("POST", S_UP, {"email": SUB2})
        check("two sign-ups accepted", s == 200 and s2 == 200, (s, s2))
        mails = wait_for(lambda: [p for p in sent if to(p) in (SUB1, SUB2)] if len([p for p in sent if to(p) in (SUB1, SUB2)]) >= 2 else None)
        check("each got a confirm email (address lower-cased)", mails and len(mails) == 2, mails)
        token1 = re.search(r"/api/public/bulletin/confirm/([0-9a-f]{64})", next(p for p in mails if to(p) == SUB1).get("htmlContent", "")).group(1)
        check("both are Pending", sql(f"SELECT GROUP_CONCAT(status) FROM club_bulletin_subscribers WHERE email IN ('{SUB1}', '{SUB2}')") == "Pending,Pending")
        s, b = call("GET", f"/api/public/bulletin/confirm/{token1}")
        check("the confirm link shows a button and changes nothing (mail scanners)", s == 200 and "<form" in b.get("text", "")
              and sql(f"SELECT status FROM club_bulletin_subscribers WHERE email = '{SUB1}'") == "Pending", (s, b))
        s, b = call("POST", f"/api/public/bulletin/confirm/{token1}", form={})
        check("confirm", s == 200 and sql(f"SELECT status FROM club_bulletin_subscribers WHERE email = '{SUB1}'") == "Confirmed", (s, b))
        s, _ = call("POST", f"/api/public/bulletin/confirm/{token1}", form={})
        check("a used confirm link does nothing", s == 404, s)
        s, _ = call("POST", f"/api/public/bulletin/confirm/{'0' * 64}", form={})
        check("an unknown confirm link does nothing", s == 404, s)
        n0 = len(sent)
        s, _ = call("POST", S_UP, {"email": SUB1})
        time.sleep(1)
        check("signing up again when confirmed sends nothing", s == 200 and len(sent) == n0, len(sent) - n0)
        s, b = call("GET", f"/api/clubs/{CLUB}/bulletin-subscribers", tok=t_admin)
        rows = {x["email"]: x["status"] for x in b} if s == 200 else {}
        check("managers list subscribers", rows.get(SUB1) == "Confirmed" and rows.get(SUB2) == "Pending", (s, rows))
        s, _ = call("GET", f"/api/clubs/{CLUB}/bulletin-subscribers", tok=t_member)
        s2, _ = call("GET", f"/api/clubs/{OTHER_CLUB}/bulletin-subscribers", tok=t_admin)
        check("members and other clubs' admins cannot list them", s == 403 and s2 == 403, (s, s2))
        s, b = call("GET", f"{B}/options", tok=t_admin)
        check("the editor shows the confirmed subscriber count", b.get("confirmedSubscribers", -1) >= 1, b.get("confirmedSubscribers"))

        credit_id = sql(f"INSERT INTO club_credits (fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount, FromDate, ToDate, IsActive, created_by) "
                        f"VALUES ({district}, {CLUB}, 'Email', 1000, 0, UTC_DATE() - INTERVAL 1 DAY, UTC_DATE() + INTERVAL 30 DAY, 1, {ADMIN}); SELECT LAST_INSERT_ID();")

        # ── send the bulletin ──
        before = len(sent)
        s, b = call("POST", f"{B}/{bid}/send", {"recipientType": 1}, t_admin)
        check("send says subscribers get it too", s == 200 and b.get("subscribers", 0) >= 1, b)
        mid = b.get("massEmailId", 0)
        if mid:
            mail_ids.append(mid)
        check("send bulletin", s == 200 and mid > 0, (s, b))
        status = wait_status(mid)
        total = int(sql(f"SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id = {mid} AND isdeleted = 0"))
        check("the mass email finished as Sent", status == "Sent", status)
        sub_rows = wait_for(lambda: sql(f"SELECT COUNT(*) FROM club_bulletin_deliveries WHERE fk_bulletin_id = {bid} AND status = 'Pending'") == "0")
        new = sent[before:]
        member_copies = [p for p in new if not (to(p) or "").startswith("e2e-sub")]
        sub_copies = [p for p in new if to(p) == SUB1]
        subs_confirmed = int(sql(f"SELECT COUNT(*) FROM club_bulletin_deliveries WHERE fk_bulletin_id = {bid} AND status = 'Sent'"))
        check("every member recipient reached the fake Brevo", total > 0 and len(member_copies) == total, (total, len(member_copies)))
        check("subscriber copies all went out (deliveries Sent)", sub_rows and subs_confirmed >= 1 and len(new) == total + subs_confirmed, (subs_confirmed, len(new), total))
        check("the confirmed subscriber got one copy, the unconfirmed none",
              len(sub_copies) == 1 and not [p for p in new if to(p) == SUB2], (len(sub_copies), [to(p) for p in new if "sub2" in (to(p) or "")]))
        check("the email carries the bulletin", all(f"{tag} news 2" in (p.get("htmlContent") or "") for p in new), new[:1])
        sub_html = sub_copies[0].get("htmlContent", "") if sub_copies else ""
        m = re.search(r"/api/public/bulletin/unsubscribe/([0-9]+\.[A-Za-z0-9_-]+)", sub_html)
        check("the subscriber copy has an unsubscribe link and one-click headers",
              m is not None and "List-Unsubscribe" in json.dumps(sub_copies[0].get("headers", {})), sub_copies[:1])
        check("credits were used for the subscribers", sql(f"SELECT COUNT(*) FROM club_credit_usage_history WHERE Source = 'BulletinSubscribers' AND SourceId = {bid}") == "1")
        s, b = call("POST", f"{B}/{bid}/send", {"recipientType": 1}, t_admin)
        check("a sent bulletin cannot be sent again", s == 400, (s, b))
        s, _ = call("PUT", f"{B}/{bid}", draft, t_admin)
        check("a sent bulletin cannot be edited", s == 404, s)
        s, b = call("GET", B, tok=t_member)
        check("the member's archive lists it", s == 200 and bid in [x["id"] for x in b], (s, b))
        s, b = call("GET", f"{B}/{bid}", tok=t_member)
        check("the member reads the archived copy", s == 200 and f"{tag} news 2" in (b.get("html") or ""), (s, b))

        # ── unsubscribe ──
        utok = m.group(1) if m else "x"
        s, b = call("GET", f"/api/public/bulletin/unsubscribe/{utok}")
        check("the unsubscribe link shows a button and changes nothing", s == 200 and "<form" in b.get("text", "")
              and sql(f"SELECT status FROM club_bulletin_subscribers WHERE email = '{SUB1}'") == "Confirmed", s)
        s, _ = call("POST", f"/api/public/bulletin/unsubscribe/{utok[:-2]}xx", form={"List-Unsubscribe": "One-Click"})
        check("a tampered unsubscribe link is refused", s == 404, s)
        s, _ = call("POST", f"/api/public/bulletin/unsubscribe/{utok}", form={"List-Unsubscribe": "One-Click"})
        check("one-click unsubscribe", s == 200 and sql(f"SELECT status FROM club_bulletin_subscribers WHERE email = '{SUB1}'") == "Unsubscribed", s)

        # ── a second bulletin to a sub group: the unsubscribed and the unconfirmed get nothing ──
        # a temporary sub group holding the admin and the member (the copy's sub groups have no addresses)
        year = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted, 0) = 0 LIMIT 1")
        sg = sql(f"INSERT INTO sub_groups (fk_district_id, fk_club_id, fk_year_id, GroupName, created_by, created_date, isdeleted, Scope) "
                 f"VALUES ({district}, {CLUB}, {year}, '{tag} group', {ADMIN}, UTC_TIMESTAMP(), 0, 'club'); SELECT LAST_INSERT_ID();")
        sg_id = int(sg)
        sql(f"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date, isdeleted) "
            f"VALUES ({sg_id}, {ADMIN}, {ADMIN}, UTC_TIMESTAMP(), 0), ({sg_id}, {MEMBER}, {ADMIN}, UTC_TIMESTAMP(), 0)")
        if sg:
            s, b = call("POST", B, {**draft, "title": f"{tag} second"}, t_admin)
            bid2 = b.get("id", 0)
            bulletin_ids.append(bid2)
            before = len(sent)
            s, b = call("POST", f"{B}/{bid2}/send", {"recipientType": 2, "subgroupIds": [int(sg)]}, t_admin)
            mid2 = b.get("massEmailId", 0)
            if mid2:
                mail_ids.append(mid2)
            n_sg = int(sql(f"SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id = {mid2} AND isdeleted = 0")) if mid2 else -1
            check("send to a sub group", s == 200 and mid2 > 0 and wait_status(mid2) == "Sent" and 0 < n_sg < total, (s, b, n_sg))
            time.sleep(1)
            check("no subscriber copy after unsubscribe", not [p for p in sent[before:] if (to(p) or "").startswith("e2e-sub")]
                  and sql(f"SELECT COUNT(*) FROM club_bulletin_deliveries WHERE fk_bulletin_id = {bid2}") == "0", [to(p) for p in sent[before:]])

        # ── resend to non-openers ──
        # Brevo's webhook would set these; here: all delivered, all opened except the admin and the member.
        sql(f"UPDATE club_mass_email_recipients SET DeliveryStatus = 'Delivered', OpenCount = IF(fk_member_id IN ({ADMIN}, {MEMBER}), 0, 1) "
            f"WHERE fk_mass_email_id = {mid}")
        expected = int(sql(f"SELECT COUNT(DISTINCT LOWER(TRIM(Email))) FROM club_mass_email_recipients WHERE fk_mass_email_id = {mid} "
                           f"AND fk_member_id IN ({ADMIN}, {MEMBER}) AND Status = 'Sent'"))
        s, b = call("GET", f"/api/clubs/{CLUB}/mass-emails/{mid}/non-openers", tok=t_admin)
        check("non-openers counted", s == 200 and b.get("count") == expected and expected > 0, (s, b, expected))
        s, b = call("GET", f"/api/clubs/{OTHER_CLUB}/mass-emails/{mid}/non-openers", tok=t_admin)
        check("non-openers of another club's email: refused", s in (403, 404), (s, b))
        s, b = call("POST", f"/api/clubs/{CLUB}/mass-emails/{mid}/resend-non-openers", {"subject": "x" * 501}, t_admin)
        check("an over-long subject is refused", s == 400, (s, b))
        s, b = call("POST", f"/api/clubs/{CLUB}/mass-emails/{mid}/resend-non-openers", {"subject": None}, t_member)
        check("a plain member cannot resend", s == 403, (s, b))
        before = len(sent)
        s, b = call("POST", f"/api/clubs/{CLUB}/mass-emails/{mid}/resend-non-openers", {"subject": f"{tag} reminder"}, t_admin)
        rid = b.get("id", 0)
        if rid:
            mail_ids.append(rid)
        check("resend creates a follow-up", s == 200 and rid > 0 and rid != mid, (s, b))
        check("the follow-up went out", wait_status(rid) == "Sent")
        resent = sent[before:]
        check("only the non-openers got it, with the new subject",
              len(resent) == expected and all(p.get("subject") == f"{tag} reminder" for p in resent), (len(resent), expected))
        s, b = call("GET", f"/api/clubs/{CLUB}/mass-emails/{mid}", tok=t_admin)
        check("detail reports opened count", s == 200 and b.get("openedCount") == total - expected, (s, b.get("openedCount")))
        # everyone opened: nothing left to resend
        sql(f"UPDATE club_mass_email_recipients SET OpenCount = 1 WHERE fk_mass_email_id = {mid}")
        s, b = call("POST", f"/api/clubs/{CLUB}/mass-emails/{mid}/resend-non-openers", {}, t_admin)
        check("nothing to resend when all opened", s == 400, (s, b))
finally:
    if sg_id:
        sql(f"DELETE FROM sub_group_members WHERE fk_sub_group_id = {sg_id}")
        sql(f"DELETE FROM sub_groups WHERE pk_sub_group_id = {sg_id}")
    if bulletin_ids:  # a mass email a failed bulletin send left behind
        mail_ids += [int(x) for x in sql(f"SELECT fk_mass_email_id FROM club_bulletins WHERE pk_bulletin_id IN ({','.join(map(str, bulletin_ids))}) "
                                         f"AND fk_mass_email_id IS NOT NULL").split() if int(x) not in mail_ids]
    if board_id:
        sql(f"DELETE FROM board_of_directors WHERE pk_board_director_id = {board_id}")
    sql(f"DELETE FROM club_stories WHERE fk_club_id = {CLUB} AND title LIKE '{tag}%'")
    sql(f"DELETE FROM club_bulletin_subscribers WHERE fk_club_id = {CLUB} AND email LIKE 'e2e-%{tag}@example.invalid'")
    if bulletin_ids:
        bids = ",".join(map(str, bulletin_ids))
        sql(f"DELETE FROM club_bulletin_deliveries WHERE fk_bulletin_id IN ({bids})")
        sql(f"DELETE FROM club_credit_usage_history WHERE Source = 'BulletinSubscribers' AND SourceId IN ({bids})")
    if mail_ids:
        ids = ",".join(map(str, mail_ids))
        sql(f"DELETE FROM club_credit_usage_history WHERE Source = 'MassEmail' AND SourceId IN ({ids})")
        sql(f"DELETE FROM club_mass_email_recipients WHERE fk_mass_email_id IN ({ids})")
        sql(f"DELETE FROM club_mass_emails WHERE pk_mass_email_id IN ({ids})")
    if credit_id:
        sql(f"DELETE FROM club_credits WHERE pk_credit_id = {credit_id}")
    if bulletin_ids:
        sql(f"DELETE FROM club_bulletins WHERE pk_bulletin_id IN ({','.join(map(str, bulletin_ids))})")
    if ann_ids:
        sql(f"DELETE FROM announcements WHERE pk_announcement_id IN ({','.join(map(str, ann_ids))})")
    if ev_ids:
        sql(f"DELETE FROM upcoming_events WHERE pk_upcoming_event_id IN ({','.join(map(str, ev_ids))})")
    left = sql(f"SELECT (SELECT COUNT(*) FROM club_bulletins WHERE title LIKE '{tag}%') + (SELECT COUNT(*) FROM announcements WHERE Title LIKE '{tag}%') "
               f"+ (SELECT COUNT(*) FROM club_mass_emails WHERE Subject LIKE '{tag}%') + (SELECT COUNT(*) FROM club_stories WHERE title LIKE '{tag}%') "
               f"+ (SELECT COUNT(*) FROM club_bulletin_subscribers WHERE email LIKE 'e2e-%{tag}@example.invalid')")
    check("cleanup left nothing", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
