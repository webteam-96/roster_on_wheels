"""N5 Communication upgrades: templates per language, sender domains, tracking, suppression, consent, allowances,
member language, Governor note (lane d, 2026-10-23).

    python -I kb/tools/communication_upgrades_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET            the API's JwtSettings__Secret
  ROW_E2E_BREVO_WEBHOOK_SECRET  the API's Brevo__WebhookSecret
  ROW_E2E_FAKE_BREVO_PORT       port of the fake Brevo server this script starts (default 5198)
  ROW_E2E_FAKE_DNS_PORT         port of the fake DNS server this script starts (default 5397)
  ROW_E2E_GREETINGS_WORKER      optional: path to GreetingsWorker.dll; runs one scoped greeting send (language + Governor note)

Start the API with Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email, Brevo__ApiKey=<anything>,
Comms__DnsServers__0=127.0.0.1:<dns port> and Api__BaseUrl. Nothing leaves the machine: Brevo and DNS are answered
by this script. Campaign recipient addresses are rewritten to e2e-<member>@example.invalid before sending; the
optional greeting run sends to the club's real addresses, but only to the fake Brevo server here.
Local copies only. Everything created is removed at the end; audit_log rows stay (append-only by design).
"""
import base64, hashlib, hmac, json, os, re, secrets, socket, struct, subprocess, sys, threading, time
import urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
HOOK = os.environ['ROW_E2E_BREVO_WEBHOOK_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5198'))
DNS_PORT = int(os.environ.get('ROW_E2E_FAKE_DNS_PORT', '5397'))
WORKER = os.environ.get('ROW_E2E_GREETINGS_WORKER')
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
# English names on member records -> the code the API resolves them to (.NET culture data)
CODES = {"Arabic": "ar", "Nepali": "ne", "Sinhala": "si", "Tamil": "ta", "Hindi": "hi", "French": "fr",
         "German": "de", "Chinese": "zh", "Japanese": "ja", "Spanish": "es"}
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


def call(method, path, body=None, tok=None, headers=None, form=None):
    """(status, parsed JSON)."""
    h = {**({"Authorization": f"Bearer {tok}"} if tok else {}), **(headers or {})}
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
        return status, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


# ── Fake Brevo: records each send, answers a message id ────────────────────────────────────────
sent = []


class Brevo(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def body(self):
        if self.headers.get("Transfer-Encoding", "").lower() != "chunked":  # the worker's JsonContent is chunked
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
        out = json.dumps({"messageId": f"<e2e-{len(sent)}-{secrets.token_hex(4)}@e2e.invalid>"}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


brevo = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), Brevo)
threading.Thread(target=brevo.serve_forever, daemon=True).start()

# ── Fake DNS: TXT answers from this dict, NXDOMAIN for other names ──────────────────────────────
txt = {}
dns = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
dns.bind(("127.0.0.1", DNS_PORT))


def dns_loop():
    while True:
        try:
            data, addr = dns.recvfrom(4096)
        except OSError:
            return
        try:
            qid, flags = struct.unpack(">HH", data[:4])
            i, labels = 12, []
            while data[i]:
                labels.append(data[i + 1:i + 1 + data[i]].decode())
                i += data[i] + 1
            qtype = struct.unpack(">H", data[i + 1:i + 3])[0]
            name = ".".join(labels).lower()
            answers = txt.get(name, []) if qtype == 16 else []
            rcode = 0 if name in txt else 3
            out = struct.pack(">HHHHHH", qid, 0x8080 | (flags & 0x0100) | rcode, 1, len(answers), 0, 0) + data[12:i + 5]
            for a in answers:
                raw = a.encode()
                rdata = b"".join(bytes([len(raw[k:k + 255])]) + raw[k:k + 255] for k in range(0, len(raw), 255))
                out += b"\xc0\x0c" + struct.pack(">HHIH", 16, 1, 60, len(rdata)) + rdata
            dns.sendto(out, addr)
        except Exception as e:  # a broken query must not stop the server
            print("fake DNS:", e)


threading.Thread(target=dns_loop, daemon=True).start()

# ── Data: a club with an Admin, two English members and one with another language, all with emails ──
names = ",".join(f"'{n}'" for n in CODES)
club, district = [int(x) for x in sql(
    "SELECT c.pk_club_id, c.fk_district_id FROM club_master c "
    "JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1 "
    "JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1 "
    "JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 "
    "JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0 "
    "WHERE IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1 AND EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_club_id = c.pk_club_id "
    "AND r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0) "
    "GROUP BY c.pk_club_id, c.fk_district_id "
    f"HAVING SUM(m.PrimaryLanguage = 'English' AND m.EmailId <> '') >= 3 "
    f"AND SUM(m.PrimaryLanguage IN ({names}) AND m.EmailId <> '' AND m.BirthDate IS NOT NULL) >= 1 "
    "ORDER BY c.pk_club_id LIMIT 1").split()]
club_name = sql(f"SELECT ClubName FROM club_master WHERE pk_club_id = {club}")
admin = int(sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id = {club} AND fk_role_id = 2 "
                "AND IsActive = 1 AND isdeleted = 0 LIMIT 1"))
members_sql = (f"SELECT m.pk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
               f"ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0 "
               f"WHERE cm.fk_club_id = {club} AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.EmailId <> '' ")
plain_only = "AND m.pk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id <> 1 AND IsActive = 1) "
m_en, m_third = [int(x) for x in sql(members_sql + plain_only + "AND m.PrimaryLanguage = 'English' ORDER BY 1 LIMIT 2").split()]
m_loc = int(sql(members_sql + f"AND m.PrimaryLanguage IN ({names}) AND m.BirthDate IS NOT NULL ORDER BY 1 LIMIT 1"))
loc_lang = CODES[sql(f"SELECT PrimaryLanguage FROM member_master_profile WHERE pk_member_master_profile_id = {m_loc}")]
other_club = int(sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id <> {district} AND IFNULL(isdeleted, 0) = 0 ORDER BY 1 LIMIT 1"))
other_admin = sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id = {other_club} AND fk_role_id = 2 "
                  "AND IsActive = 1 AND isdeleted = 0 LIMIT 1")
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1"))
t_admin, t_sa, t_third = token(admin, "Admin"), token(sa, "SuperAdmin"), token(m_third, "Member")
t_plain = token(m_en, "Member")
t_other = token(int(other_admin), "Admin") if other_admin else None
print(f"club {club} ({club_name}), district {district}; members en={m_en}, third={m_third}, {loc_lang}={m_loc}")

# ── What to put back afterwards ─────────────────────────────────────────────────────────────────
start = sql("SELECT NOW()")
month = sql("SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m')")
had_switch = sql("SELECT COUNT(*) FROM platform_features WHERE feature_key = 'communication'") == "1"
was_on = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key = 'communication'") == "1"


def lits(cols):
    """SQL that prints the columns as one line of SQL literals (hex for text: safe for quotes, commas and newlines)."""
    return "CONCAT_WS(',', " + ", ".join(
        f"IF({c} IS NULL, 'NULL', IF(LENGTH({c}) = 0, QUOTE(''), CONCAT('0x', HEX({c}))))" for c in cols) + ")"


S_COLS = ["default_language", "governor_note_enabled", "governor_name", "governor_photo_url", "governor_message",
          "sender_from_name", "sender_from_email", "sender_reply_to"]
S_KEYS = f"(fk_club_id = {club} AND fk_district_id = 0) OR (fk_club_id = 0 AND fk_district_id = {district})"
saved_settings = sql(f"SELECT {lits(['fk_club_id', 'fk_district_id'] + S_COLS)} FROM comm_settings WHERE {S_KEYS}").splitlines()
MEMBERS = f"{m_en}, {m_third}, {m_loc}"
C_COLS = ["fk_member_id", "channel", "consented", "changed_at_utc", "source"]
saved_consents = sql(f"SELECT {lits(C_COLS)} FROM member_channel_consents WHERE fk_member_id IN ({MEMBERS})").splitlines()
saved_usage = sql(f"SELECT emails_used FROM comm_usage WHERE fk_club_id = {club} AND fk_district_id = 0 AND usage_month = '{month}'")
G_COLS = ["IsEnableBirthdayNotification", "IsEnableBirthdayEmail", "BirthdayEmailSubject", "BirthdayEmailMessage", "BirthdayGreeting"]
saved_club = sql(f"SELECT {lits(G_COLS)} FROM club_master WHERE pk_club_id = {club}")
has_credits = sql(f"SELECT COUNT(*) FROM club_credits WHERE fk_club_id = {club} AND CreditType = 'Email' AND IsActive = 1 AND isdeleted = 0") != "0"
had_birthday = sql(f"SELECT COUNT(*) FROM comm_templates WHERE fk_club_id = {club} AND fk_district_id = 0 AND template_key = 'birthday'") != "0"
campaigns = []
key = f"e2e-news-{secrets.token_hex(3)}"
domain_ok, domain_bad = f"e2e-{secrets.token_hex(3)}.example", f"e2e-{secrets.token_hex(3)}.example"
CBASE, DBASE = f"/api/clubs/{club}/comms", f"/api/districts/{district}/comms"


def switch(on):
    return call("PUT", "/api/features/communication", {"enabled": on}, t_sa)[0]


def rewrite_recipients(cid):
    sql(f"UPDATE club_mass_email_recipients SET Email = CONCAT('e2e-', fk_member_id, '@example.invalid') WHERE fk_mass_email_id = {cid}")


def campaign(members, template_key=None):
    s, b = call("POST", f"/api/clubs/{club}/mass-emails", {
        "recipientType": 3, "memberIds": members, "fromName": "E2E Club", "subject": "Fallback subject {{member_name}}",
        "emailBody": "<p>Fallback body</p>", "saveAsDraft": True, "templateKey": template_key}, t_admin)
    cid = b.get("id", 0) if s == 200 else 0
    if cid:
        campaigns.append(cid)
        rewrite_recipients(cid)
    return s, cid


def wait_sent(cid):
    for _ in range(40):
        status = sql(f"SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = {cid}")
        if status not in ("Sending", "Draft"):
            return status
        time.sleep(0.5)
    return status


def recipient(cid, member):
    row = sql(f"SELECT CONCAT_WS('|', Status, IFNULL(MessageId, ''), IFNULL(Language, ''), IFNULL(DeliveryStatus, ''), OpenCount, ClickCount, "
              f"IFNULL(ErrorMessage, '')) FROM club_mass_email_recipients WHERE fk_mass_email_id = {cid} AND fk_member_id = {member}")
    return dict(zip(["status", "mid", "lang", "delivery", "opens", "clicks", "error"], row.split("|")))


def hook(events, secret=HOOK):
    return call("POST", "/api/webhooks/brevo", events, headers={"Authorization": f"Bearer {secret}"} if secret else None)


def mail_to(member):
    return [p for p in sent if p.get("to", [{}])[0].get("email") == f"e2e-{member}@example.invalid"]


try:
    # ── switched off: the module answers 404, campaigns keep the old credit rule ──
    check("switch off", switch(False) == 204)
    for name, method, path, tok in [("club settings", "GET", f"{CBASE}/settings", t_admin),
                                    ("district usage", "GET", f"{DBASE}/usage", t_sa),
                                    ("member preferences", "GET", "/api/mobile/comms/preferences", t_third)]:
        s, b = call(method, path, tok=tok)
        check(f"off: {name} is closed", s == 404 and b.get("feature") == "communication", (s, b))
    if not has_credits:  # with credits the send would go out (to the fake Brevo) and use them
        s, cid0 = campaign([m_en])
        s, b = call("POST", f"/api/clubs/{club}/mass-emails/{cid0}/send", tok=t_admin)
        check("off: a send still needs email credits", s == 400 and "credits" in b.get("message", "").lower(), (s, b))

    # ── switched on ──
    check("switch on", switch(True) == 204)
    s, _ = call("GET", f"{CBASE}/settings", tok=t_plain)
    check("a plain member cannot read the club's settings", s == 403, s)
    if t_other:
        s, _ = call("GET", f"{CBASE}/usage", tok=t_other)
        check("another club's admin cannot read this club's usage", s == 403, s)

    # settings: language, Governor note (district only), validation
    s, b = call("PUT", f"{CBASE}/settings", {"defaultLanguage": "en"}, t_admin)
    check("club language saved", s == 200 and b.get("effectiveLanguage") == "en", (s, b))
    s, b = call("PUT", f"{CBASE}/settings", {"defaultLanguage": "english!"}, t_admin)
    check("a malformed language is refused", s == 400, (s, b))
    s, b = call("PUT", f"{CBASE}/settings", {"defaultLanguage": "en", "governorNoteEnabled": True, "governorName": "X", "governorMessage": "Y"}, t_admin)
    check("a club cannot hold a Governor note", s == 200 and not b.get("governorNoteEnabled") and b.get("governorName") is None, (s, b))
    photo = f"{API}/uploads/mass-email/e2e-governor.jpg"
    s, b = call("PUT", f"{DBASE}/settings", {"governorNoteEnabled": True, "governorName": "E2E Governor", "governorPhotoUrl": photo}, t_sa)
    check("the Governor note needs a message", s == 400, (s, b))
    s, b = call("PUT", f"{DBASE}/settings", {"governorNoteEnabled": True, "governorName": "E2E Governor", "governorMessage": "Keep serving. <b>",
                                             "governorPhotoUrl": "https://evil.example.com/uploads/mass-email/pixel.gif"}, t_sa)
    check("a Governor photo from another host is refused", s == 400, (s, b))
    s, b = call("PUT", f"{DBASE}/settings", {"governorNoteEnabled": True, "governorName": "E2E Governor",
                                             "governorMessage": "Keep serving. <b>", "governorPhotoUrl": photo}, t_sa)
    check("the district's Governor note is saved", s == 200 and b.get("governorNoteEnabled") and b.get("governorPhotoUrl") == photo, (s, b))

    # templates
    s, b = call("PUT", f"{CBASE}/templates", {"templateKey": key, "language": "en", "subject": "Hello {{member_name}}",
                                              "bodyHtml": "<p>English news for {{member_name}}</p><script>alert(1)</script>"}, t_admin)
    check("an English template is saved and cleaned of scripts", s == 200 and "<script" not in b.get("bodyHtml", "") and b.get("reviewed"), (s, b))
    s, b = call("PUT", f"{CBASE}/templates", {"templateKey": key, "language": loc_lang, "subject": f"[{loc_lang}] news",
                                              "bodyHtml": f"<p>[{loc_lang}] body</p>", "reviewed": False}, t_admin)
    check(f"a machine-translated {loc_lang} version is saved as beta", s == 200 and b.get("reviewed") is False, (s, b))
    s, b = call("PUT", f"{CBASE}/templates", {"templateKey": "Bad Key", "language": "en", "subject": "x", "bodyHtml": "<p>x</p>"}, t_admin)
    check("a malformed template key is refused", s == 400, (s, b))
    s, b = call("GET", f"{CBASE}/templates", tok=t_admin)
    check("both versions are listed", s == 200 and sum(1 for t in b if t["templateKey"] == key) == 2, (s, b))

    # sender domains (fake DNS)
    s, b = call("POST", f"{CBASE}/domains", {"domain": "https://evil.example.com/x"}, t_admin)
    check("a URL is not a domain", s == 400, (s, b))
    s, b = call("POST", f"{CBASE}/domains", {"domain": "127.0.0.1"}, t_admin)
    check("an IP address is not a domain", s == 400, (s, b))
    s, d_ok = call("POST", f"{CBASE}/domains", {"domain": domain_ok.upper()}, t_admin)
    check("a sender domain is added with its DNS records", s == 200 and d_ok.get("domain") == domain_ok and len(d_ok.get("records", [])) == 4, (s, d_ok))
    s, d_bad = call("POST", f"{CBASE}/domains", {"domain": domain_bad}, t_admin)
    txt[domain_ok] = [f"row-verification={d_ok.get('verifyToken')}", "v=spf1 include:spf.brevo.com ~all"]
    txt[f"{d_ok.get('dkimSelector')}._domainkey.{domain_ok}"] = ["v=DKIM1; k=rsa; p=" + "A" * 300]
    txt[f"_dmarc.{domain_ok}"] = ["v=DMARC1; p=none"]
    txt[domain_bad] = ["v=spf1 include:_spf.google.com ~all", "row-verification=wrong"]
    s, b = call("POST", f"{CBASE}/domains/{d_ok.get('id')}/verify", tok=t_admin)
    check("DNS check: ownership, SPF, DKIM and DMARC all pass", s == 200 and b.get("verified")
          and all(b.get(k) for k in ("ownershipOk", "spfOk", "dkimOk", "dmarcOk")), (s, b))
    s, b = call("POST", f"{CBASE}/domains/{d_bad.get('id')}/verify", tok=t_admin)
    check("DNS check: a domain without Brevo SPF, DKIM, DMARC or our token fails each check", s == 200 and not any(
        b.get(k) for k in ("ownershipOk", "spfOk", "dkimOk", "dmarcOk", "verified")), (s, b))
    s, b = call("POST", f"/api/clubs/{other_club}/comms/domains/{d_ok.get('id')}/verify", tok=t_sa)
    check("another club cannot verify this club's domain", s == 404, (s, b))
    s, b = call("PUT", f"{CBASE}/settings", {"defaultLanguage": "en", "senderFromEmail": f"news@{domain_bad}"}, t_admin)
    check("a from address on an unverified domain is refused", s == 400, (s, b))
    s, b = call("PUT", f"{CBASE}/settings", {"defaultLanguage": "en", "senderFromName": "E2E Club",
                                             "senderFromEmail": f"news@{domain_ok}", "senderReplyTo": "secretary@example.org"}, t_admin)
    check("the sender profile is saved", s == 200 and b.get("senderFromEmail") == f"news@{domain_ok}", (s, b))

    # consent from the app: the third member switches email off
    s, b = call("PUT", "/api/mobile/comms/preferences", {"email": False}, t_third)
    email_pref = next((c for c in b.get("consents", []) if c.get("channel") == "email"), {})
    check("a member switches email off in the app (with a timestamp)", s == 200 and email_pref.get("consented") is False
          and email_pref.get("changedAtUtc"), (s, b))

    # ── a localised campaign ──
    sent.clear()
    s, cid = campaign([m_en, m_third, m_loc], key)
    s, b = call("POST", f"/api/clubs/{club}/mass-emails/{cid}/send", tok=t_admin)
    check("campaign send accepted without email credits (allowance instead)", s == 200, (s, b))
    check("campaign finished", wait_sent(cid) == "Sent")
    en_mail, loc_mail = mail_to(m_en), mail_to(m_loc)
    check("the unsubscribed member is skipped", not mail_to(m_third) and recipient(cid, m_third)["status"] == "Skipped", recipient(cid, m_third))
    check("the English member gets the English version", len(en_mail) == 1 and en_mail[0]["subject"].startswith("Hello ")
          and "English news" in en_mail[0]["htmlContent"], en_mail)
    check(f"the {loc_lang} member gets the {loc_lang} version", len(loc_mail) == 1 and loc_mail[0]["subject"] == f"[{loc_lang}] news", loc_mail)
    unsub = re.search(r'/unsubscribe/([0-9]+\.[A-Za-z0-9_-]+)"', en_mail[0]["htmlContent"] if en_mail else "")
    check("every message carries an unsubscribe link", unsub is not None and all("/unsubscribe/" in p["htmlContent"] for p in sent), sent[:1])
    check("and one-click List-Unsubscribe headers", all("List-Unsubscribe" in (p.get("headers") or {})
          and p["headers"].get("List-Unsubscribe-Post") == "List-Unsubscribe=One-Click" for p in sent), [p.get("headers") for p in sent])
    check("the verified tenant address is the sender", all(p["sender"]["email"] == f"news@{domain_ok}" for p in sent), [p["sender"] for p in sent])
    r_en, r_loc = recipient(cid, m_en), recipient(cid, m_loc)
    check("per-recipient message id and language are stored", r_en["mid"].startswith("<e2e-") and r_en["lang"] == "en"
          and r_loc["lang"] == loc_lang, (r_en, r_loc))
    s, b = call("GET", f"{CBASE}/usage", tok=t_admin)
    check("usage counts the two sends", s == 200 and b.get("used") == (int(saved_usage or 0) + 2) and b.get("perMember") == 25
          and b.get("allowance") == 25 * b.get("members", 0), (s, b))

    # ── Brevo webhook: auth, tracking, idempotency, suppression ──
    s, _ = hook({"event": "delivered"}, secret=None)
    check("webhook without the secret is refused", s == 401, s)
    s, _ = hook({"event": "delivered"}, secret="wrong-secret-0123456789")
    check("webhook with a wrong secret is refused", s == 401, s)
    ts = int(time.time() * 1000)
    ev = lambda e, mid, email, n, **x: {"event": e, "message-id": mid, "email": email, "ts_epoch": ts + n, **x}
    a_en = f"e2e-{m_en}@example.invalid"
    s, b = hook([ev("delivered", r_en["mid"], a_en, 1), ev("opened", r_en["mid"], a_en, 2), ev("opened", r_en["mid"], a_en, 3),
                 ev("click", r_en["mid"], a_en, 4, link="https://example.org/a")])
    check("batched delivery, open and click events are processed", s == 200 and b.get("processed") == 4, (s, b))
    s, b = hook(ev("opened", r_en["mid"], a_en, 2))
    check("a repeated event is ignored (idempotent)", s == 200 and b.get("processed") == 0 and b.get("duplicates") == 1, (s, b))
    r = recipient(cid, m_en)
    check("delivered, 2 opens and 1 click on the recipient", r["delivery"] == "Delivered" and r["opens"] == "2" and r["clicks"] == "1", r)
    a_loc = f"e2e-{m_loc}@example.invalid"
    s, b = hook(ev("hard_bounce", r_loc["mid"], a_loc, 5, reason="mailbox does not exist"))
    check("a hard bounce is processed", s == 200 and b.get("processed") == 1, (s, b))
    check("the bounce is on the recipient", recipient(cid, m_loc)["delivery"] == "Bounced", recipient(cid, m_loc))
    s, sup = call("GET", f"{CBASE}/suppressions", tok=t_admin)
    check("the bounced address is suppressed for the club", s == 200 and any(x["email"] == a_loc and x["reason"] == "hard_bounce" for x in sup), (s, sup))
    s, b = call("GET", f"{CBASE}/campaigns/{cid}", tok=t_admin)
    check("campaign tracking: 1 delivered (+bounced), opens, clicks, skipped", s == 200 and b.get("sent") == 2 and b.get("opened") == 1
          and b.get("clicked") == 1 and b.get("bounced") == 1 and b.get("skipped") == 1
          and any(x.get("openCount") == 2 for x in b.get("recipientRows", [])), (s, b))
    s, _ = call("GET", f"/api/clubs/{other_club}/comms/campaigns/{cid}", tok=t_sa)
    check("tracking of a campaign through another club's URL is not found", s == 404, s)
    s, _ = call("GET", f"/api/clubs/{other_club}/mass-emails/{cid}", tok=t_sa)
    check("mass email detail through another club's URL is not found (IDOR fix)", s == 404, s)
    s, _ = call("POST", f"/api/clubs/{other_club}/mass-emails/{cid}/send", tok=t_sa)
    check("mass email send through another club's URL is not found (IDOR fix)", s == 404, s)

    # ── the next send skips the suppressed address; the allowance is enforced ──
    sent.clear()
    s, cid2 = campaign([m_en, m_loc])
    s, b = call("POST", f"/api/clubs/{club}/mass-emails/{cid2}/send", tok=t_admin)
    check("second campaign accepted", s == 200 and wait_sent(cid2) == "Sent", (s, b))
    check("the suppressed address is skipped on send", not mail_to(m_loc) and len(mail_to(m_en)) == 1
          and recipient(cid2, m_loc)["status"] == "Skipped", (recipient(cid2, m_loc), len(sent)))
    allowance = call("GET", f"{CBASE}/usage", tok=t_admin)[1].get("allowance", 0)
    sql(f"UPDATE comm_usage SET emails_used = {allowance} WHERE fk_club_id = {club} AND fk_district_id = 0 AND usage_month = '{month}'")
    s, cid3 = campaign([m_en])
    s, b = call("POST", f"/api/clubs/{club}/mass-emails/{cid3}/send", tok=t_admin)
    check("a send over the monthly allowance is refused", s == 400 and "allowance" in b.get("message", ""), (s, b))
    check("the refused campaign stays a draft", sql(f"SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = {cid3}") == "Draft")

    # ── unsubscribe page API (signed token, no login) ──
    tok_en = unsub.group(1) if unsub else "0.x"
    s, b = call("GET", f"/api/public/comms/unsubscribe/{tok_en}")
    check("the unsubscribe link opens without login (masked address)", s == 200 and b.get("subscribed") is True and "***@" in b.get("maskedEmail", ""), (s, b))
    s, _ = call("GET", f"/api/public/comms/unsubscribe/{tok_en[:-2]}xx")
    check("a tampered token is refused", s == 404, s)
    s, _ = call("GET", f"/api/public/comms/unsubscribe/{m_third}.{tok_en.split('.')[1]}")
    check("a signature for another member is refused", s == 404, s)
    s, b = call("POST", f"/api/public/comms/unsubscribe/{tok_en}", {"subscribe": False})
    check("unsubscribe", s == 200 and b.get("subscribed") is False, (s, b))
    check("consent row with timestamp and source", sql(f"SELECT CONCAT(consented, source) FROM member_channel_consents "
                                                         f"WHERE fk_member_id = {m_en} AND channel = 'email'") == "0unsubscribe_link")
    s, b = call("POST", f"/api/public/comms/unsubscribe/{tok_en}", {"subscribe": True})
    check("subscribe again", s == 200 and b.get("subscribed") is True, (s, b))
    s, b = call("POST", f"/api/public/comms/unsubscribe/{tok_en}", form={"List-Unsubscribe": "One-Click"})
    check("one-click unsubscribe from the mail client (RFC 8058)", s == 200 and b.get("subscribed") is False, (s, b))
    s, b = call("GET", f"{CBASE}/opt-outs", tok=t_admin)
    check("opt-outs list both members with channel and time", s == 200 and {m_en, m_third} <= {x["memberId"] for x in b}, (s, b))

    # ── lifting a suppression ──
    sup_id = next((x["id"] for x in sup if x["email"] == a_loc), 0)
    s, _ = call("DELETE", f"/api/clubs/{other_club}/comms/suppressions/{sup_id}", tok=t_sa)
    check("another club cannot lift this club's suppression", s == 404, s)
    s, _ = call("DELETE", f"{CBASE}/suppressions/{sup_id}", tok=t_admin)
    check("the admin lifts the suppression", s == 204 and sql(f"SELECT COUNT(*) FROM comm_suppressions WHERE pk_suppression_id = {sup_id}") == "0", s)

    # ── greetings: member language + Governor note (optional, runs the worker against the fake Brevo) ──
    if WORKER and not had_birthday:
        s, b = call("PUT", f"{CBASE}/templates", {"templateKey": "birthday", "language": loc_lang, "subject": f"[{loc_lang}] birthday {{{{member_name}}}}",
                                                  "bodyHtml": f"<p>[{loc_lang}] many happy returns</p>"}, t_admin)
        check(f"a {loc_lang} birthday template is saved", s == 200, (s, b))
        sql(f"UPDATE club_master SET IsEnableBirthdayNotification = 0, IsEnableBirthdayEmail = 1, BirthdayEmailSubject = NULL, "
            f"BirthdayEmailMessage = NULL, BirthdayGreeting = NULL WHERE pk_club_id = {club}")
        bday = sql(f"SELECT DATE_FORMAT(BirthDate, CONCAT(YEAR(CURDATE()), '-%m-%d')) FROM member_master_profile WHERE pk_member_master_profile_id = {m_loc}")
        if bday.endswith("-02-29"):
            bday = bday[:4] + "-02-28"
        sent.clear()
        env = {**os.environ, "ConnectionStrings__DefaultConnection": f"Server=127.0.0.1;Port={PORT};Database={DB};User Id=root;Password=;",
               "Brevo__ApiUrl": f"http://127.0.0.1:{BREVO_PORT}/v3/smtp/email", "Brevo__ApiKey": "e2e-fake-key",
               "Greetings__DeductCredits": "false"}
        run = subprocess.run(["dotnet", WORKER, "--send", "--club-name", club_name, "--date", bday], env=env,
                             capture_output=True, text=True, timeout=300)
        real = sql(f"SELECT LOWER(TRIM(EmailId)) FROM member_master_profile WHERE pk_member_master_profile_id = {m_loc}")
        mine = [p for p in sent if p.get("to", [{}])[0].get("email", "").lower() == real]
        check("the worker ran", run.returncode == 0, run.stdout[-600:] + run.stderr[-600:])
        check(f"the {loc_lang} member's birthday email uses the {loc_lang} template", len(mine) == 1
              and mine[0]["subject"].startswith(f"[{loc_lang}] birthday ") and f"[{loc_lang}] many happy returns" in mine[0]["htmlContent"],
              (mine, [p.get("to") for p in sent], real))
        check("it carries the Governor's note, name and photo", bool(mine) and "E2E Governor" in mine[0]["htmlContent"]
              and "Keep serving. &lt;b&gt;" in mine[0]["htmlContent"] and photo in mine[0]["htmlContent"], mine[:1])
        check("the club president's signature stays", bool(mine) and ("Club President" in mine[0]["htmlContent"]
              or "Warm regards" in mine[0]["htmlContent"]), mine[:1])
    else:
        print("SKIP greetings worker run (set ROW_E2E_GREETINGS_WORKER; the club must have no 'birthday' template yet)")

    # ── switched off again: the unsubscribe link keeps working ──
    check("switch off at the end", switch(False) == 204)
    s, b = call("GET", f"/api/public/comms/unsubscribe/{tok_en}")
    check("off: an unsubscribe link already sent still works", s == 200, (s, b))
finally:
    ids = ",".join(str(c) for c in campaigns) or "0"
    sql(f"DELETE FROM comm_webhook_events WHERE message_id IN (SELECT MessageId FROM club_mass_email_recipients WHERE fk_mass_email_id IN ({ids}))")
    sql(f"DELETE FROM club_mass_email_recipients WHERE fk_mass_email_id IN ({ids})")
    sql(f"DELETE FROM club_mass_emails WHERE pk_mass_email_id IN ({ids})")
    sql(f"DELETE FROM comm_templates WHERE fk_club_id = {club} AND fk_district_id = 0 AND template_key = '{key}'")
    if not had_birthday:
        sql(f"DELETE FROM comm_templates WHERE fk_club_id = {club} AND fk_district_id = 0 AND template_key = 'birthday'")
    sql(f"DELETE FROM comm_sender_domains WHERE domain IN ('{domain_ok}', '{domain_bad}')")
    sql("DELETE FROM comm_suppressions WHERE email LIKE 'e2e-%@example.invalid'")
    sql(f"DELETE FROM comm_settings WHERE {S_KEYS}")
    for row in saved_settings:
        sql(f"INSERT INTO comm_settings (fk_club_id, fk_district_id, {', '.join(S_COLS)}) VALUES ({row})")
    sql(f"DELETE FROM member_channel_consents WHERE fk_member_id IN ({MEMBERS})")
    for row in saved_consents:
        sql(f"INSERT INTO member_channel_consents ({', '.join(C_COLS)}) VALUES ({row})")
    sql(f"DELETE FROM comm_usage WHERE fk_club_id = {club} AND fk_district_id = 0 AND usage_month = '{month}'")
    if saved_usage:
        sql(f"INSERT INTO comm_usage (fk_club_id, fk_district_id, usage_month, emails_used) VALUES ({club}, 0, '{month}', {saved_usage})")
    sql(f"UPDATE club_master SET {', '.join(f'{c} = {v}' for c, v in zip(G_COLS, saved_club.split(',')))} WHERE pk_club_id = {club}")
    # GreetingsWorker creates greeting_send_log on its first run; a database it never ran on has no such table
    if sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'greeting_send_log'") != "0":
        sql(f"DELETE FROM greeting_send_log WHERE created_at >= '{start}' AND SourceType = 'Club' AND SourceId IN "
            f"(SELECT pk_club_id FROM club_master WHERE ClubName = {json.dumps(club_name)})")
    if had_switch:
        sql(f"UPDATE platform_features SET enabled = {1 if was_on else 0} WHERE feature_key = 'communication'")
    else:
        sql("DELETE FROM platform_features WHERE feature_key = 'communication'")
    left = sql(f"SELECT (SELECT COUNT(*) FROM club_mass_emails WHERE pk_mass_email_id IN ({ids})) "
               f"+ (SELECT COUNT(*) FROM comm_sender_domains WHERE domain IN ('{domain_ok}', '{domain_bad}')) "
               "+ (SELECT COUNT(*) FROM comm_suppressions WHERE email LIKE 'e2e-%@example.invalid') "
               f"+ (SELECT COUNT(*) FROM comm_templates WHERE template_key = '{key}')")
    check("cleanup: no test rows left", left == "0", left)
    brevo.shutdown()
    dns.close()

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
