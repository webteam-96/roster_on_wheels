"""Speakers in the bulletin (build spec 3.13): a club newsletter email lists the next 30 days' speakers.

    python -I kb/tools/bulletin_speakers_e2e.py <api_base> <mysql_port> <database>
Environment: ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret); ROW_E2E_FAKE_BREVO_PORT (default 5198).
Start the API with BackgroundJobs__Enabled=true, Brevo__ApiUrl=http://127.0.0.1:<port>/v3/smtp/email and Brevo__ApiKey=<anything>: the newsletter
goes to the club's real member addresses, but only to the fake Brevo server this script runs, so nothing leaves the
machine. The scheduled sender polls every 10 seconds. Local copies only: it also sends any other pending newsletter or
event email of the copy (to the fake server) and deducts the club's email credits as a real send would. The test
newsletter, speakers and the 'volunteers' switch are restored at the end.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5198'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TITLE = "e2e bulletin " + secrets.token_hex(3)
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


def put(path, body, token):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="PUT",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


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

token = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
# the active club with the fewest members who have an email, so the send is small
club = int(sql("""SELECT cm.fk_club_id FROM club_members cm
    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
    JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.IsActive = 1 AND d.isdeleted = 0
    JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.IsActive = 1 AND z.isdeleted = 0
    WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND IFNULL(m.EmailId, '') <> ''
    GROUP BY cm.fk_club_id ORDER BY COUNT(*) LIMIT 1"""))
was = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='volunteers'")
nid = None
try:
    check("the volunteers module is switched on", put("/api/features/volunteers", {"enabled": True}, token) in (200, 204))
    sql(f"""INSERT INTO club_speakers (fk_club_id, meeting_date, name, topic, show_on_website, created_by) VALUES
        ({club}, CURDATE() + INTERVAL 3 DAY, 'E2E Speaker Soon', 'Clean water', 0, 0),
        ({club}, CURDATE() + INTERVAL 45 DAY, 'E2E Speaker Later', 'Too far ahead', 1, 0)""")
    nid = int(sql(f"""INSERT INTO newsletters (fk_club_id, Title, PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl,
        Status, Scope, IsSendEmail) VALUES ({club}, '{TITLE}', NOW() - INTERVAL 1 MINUTE, NOW() + INTERVAL 30 DAY, 'link',
        'https://example.org/bulletin.pdf', 'Published', 'club', 1); SELECT LAST_INSERT_ID();"""))
    mine = []
    for _ in range(40):
        mine = [m for m in sent if TITLE in m.get("subject", "")]
        if mine and sql(f"SELECT EmailSentDate IS NOT NULL FROM newsletters WHERE pk_newsletter_id={nid}") == "1":
            break
        time.sleep(1.5)
    check("the newsletter was emailed", bool(mine), len(sent))
    html = mine[0].get("htmlContent", "") if mine else ""
    check("the bulletin lists the speaker booked in the next 30 days", "Upcoming speakers" in html
          and "E2E Speaker Soon: Clean water" in html, html[-600:])
    check("a speaker beyond 30 days is left out", "E2E Speaker Later" not in html)
    check("no speaker contact details", "@" not in html.split("Upcoming speakers")[-1].split("</table>")[0])
finally:
    if nid:
        sql(f"DELETE FROM newsletters WHERE pk_newsletter_id={nid}")
    sql(f"DELETE FROM club_speakers WHERE fk_club_id={club} AND name IN ('E2E Speaker Soon', 'E2E Speaker Later')")
    put("/api/features/volunteers", {"enabled": was == "1"}, token)
    brevo.shutdown()

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
