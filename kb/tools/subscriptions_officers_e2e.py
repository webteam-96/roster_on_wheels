"""Subscriptions, officer changes (KIS/ROW/SUB/01 section 4.6 step 3): the daily pass reads officers from RI, ends the
edit rights of an officer who left, keeps roles given by hand, and changes nothing when RI fails.

    python -I kb/tools/subscriptions_officers_e2e.py <api_base> <mysql_port> <database>

This script is the RI server: it listens on 127.0.0.1:5599, so the API must run with
RotaryOrgApi__BaseUrl=http://127.0.0.1:5599, any RotaryOrgApi__Username / __Password, Subscriptions__Enforce=true.
JWT secret from ROW_E2E_JWT_SECRET. Local copies only, never production: it writes a subscription, officer rows and
three role rows for one club, and removes them at the end.
"""
import base64, datetime, hashlib, hmac, http.server, json, os, re, subprocess, sys, threading, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0
ri = {"fail": False, "officers": []}  # what the stand-in RI answers


class FakeRi(http.server.BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self._send(200, "e2e-token")

    def do_GET(self):
        if ri["fail"]:
            return self._send(500, {"message": "down"})
        self._send(200, ri["officers"] if re.search(r"/officers(\?|$)", self.path) else [])

    def log_message(self, *args):
        pass


threading.Thread(target=http.server.HTTPServer(("127.0.0.1", 5599), FakeRi).serve_forever, daemon=True).start()


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


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        fails += 1


# A club RI knows (numeric club id) with three members RI knows, none of them an admin of that club yet.
club, district = (int(x) for x in sql("""
    SELECT c.pk_club_id, c.fk_district_id FROM club_master c
    WHERE c.isdeleted = 0 AND c.IsActive = 1 AND c.ClubRotaryId REGEXP '^[0-9]+$'
      AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions t WHERE t.fk_district_id = c.fk_district_id)
      AND (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
           WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0 AND m.isdeleted = 0
             AND m.RotaryId REGEXP '^[0-9]+$'
             AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = m.pk_member_master_profile_id
                             AND r.fk_club_id = c.pk_club_id AND r.fk_role_id = 2 AND r.isdeleted = 0)) >= 3
    ORDER BY c.pk_club_id LIMIT 1""").split("\t"))
people = [line.split("\t") for line in sql(f"""
    SELECT m.pk_member_master_profile_id, m.RotaryId FROM club_members cm
    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
    WHERE cm.fk_club_id = {club} AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0 AND m.isdeleted = 0
      AND m.RotaryId REGEXP '^[0-9]+$'
      AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND r.fk_club_id = {club} AND r.fk_role_id = 2 AND r.isdeleted = 0)
    ORDER BY m.pk_member_master_profile_id LIMIT 3""").splitlines()]
(old_id, old_ri), (new_id, new_ri), (hand_id, _) = ((int(a), b) for a, b in people)
sa = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id "
         "WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 LIMIT 1")
SA = token(sa, "SuperAdmin")
print(f"club {club}, outgoing officer {old_id}, incoming officer {new_id}, hand-given admin {hand_id}")

today = datetime.date.today()
start = datetime.date(today.year if today.month >= 7 else today.year - 1, 7, 1)
end = datetime.date(start.year + 1, 6, 30)


def secretary(ri_id):
    return [{"Role": "Club Secretary", "Id": str(ri_id), "FirstName": "E2E", "LastName": "Officer",
             "StartDate": start.strftime("%m/%d/%Y"), "EndDate": end.strftime("%m/%d/%Y")}]


def role(member, via):
    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted, AssignedDate, AssignedBy, via_subscription) "
        f"VALUES ({member}, 2, {club}, 1, 0, NOW(), {sa}, {via})")


def active(member):
    return sql(f"SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = {member} AND fk_club_id = {club} "
               f"AND fk_role_id = 2 AND IsActive = 1 AND isdeleted = 0") == "1"


def on_record():
    return set(sql(f"SELECT ri_member_id FROM ri_club_officers WHERE fk_club_id = {club}").split())


def status():
    return sql(f"SELECT status FROM ri_club_officer_sync WHERE fk_club_id = {club}")


def cleanup():
    sql(f"DELETE FROM member_roles WHERE fk_club_id = {club} AND fk_role_id = 2 AND fk_member_master_profile_id IN ({old_id}, {new_id}, {hand_id})")
    sql(f"DELETE FROM ri_club_officers WHERE fk_club_id = {club}")
    sql(f"DELETE FROM ri_club_officer_sync WHERE fk_club_id = {club}")
    sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id = {district} AND fk_club_id = {club}")
    sql(f"DELETE FROM subscription_orders WHERE fk_district_id = {district} AND fk_club_id = {club}")


cleanup()
try:
    # the club subscribes; RI has the outgoing officer as Secretary
    ri["officers"] = secretary(old_ri)
    st, r = call("POST", "/api/subscriptions/activate-offline", SA, {"kind": "club", "districtId": 0, "clubId": club, "amount": 1, "currency": "USD"})
    check("subscribe: officers are read from RI", st == 200 and on_record() == {old_ri} and status() == "ok", f"{st} {on_record()} {status()}")
    role(old_id, 1)    # what the executive's email-code sign-in gives them
    role(hand_id, 0)   # an admin role an executive gave by hand

    # RI now records a new Secretary
    ri["officers"] = secretary(new_ri)
    st, r = call("POST", "/api/subscriptions/run-daily", SA)
    check("officer change: the pass runs", st == 200, str(r)[:200])
    check("officer change: RI's new officer is on record", on_record() == {new_ri}, str(on_record()))
    check("officer change: the old officer loses edit rights", not active(old_id))
    check("officer change: a role given by hand stays", active(hand_id))
    check("officer change: one role ended is reported", st == 200 and any("1 roles ended" in x for x in r["done"]), str(r)[:200])

    # RI fails: nothing is known, so nothing changes
    role(new_id, 1)
    ri["fail"] = True
    st, r = call("POST", "/api/subscriptions/run-daily", SA)
    check("RI down: the pass still runs", st == 200, str(r)[:200])
    check("RI down: the officer keeps their rights", active(new_id))
    check("RI down: officers on record are kept, the club is marked", on_record() == {new_ri} and status() == "error", f"{on_record()} {status()}")

    # RI answers again and says nobody holds an office
    ri["fail"] = False
    ri["officers"] = []
    st, r = call("POST", "/api/subscriptions/run-daily", SA)
    check("no officers: the club is flagged", st == 200 and status() == "no_officers", status())
    check("no officers: the office's rights end", not active(new_id))
    check("no officers: the hand-given role still stays", active(hand_id))
    st, d = call("GET", f"/api/subscriptions/district/{district}", SA)
    check("no officers: the district sees the club flagged", st == 200 and any(c["clubId"] == club and c["reason"] == "No executives on record" for c in d["flaggedClubs"]), str(d)[:200])
finally:
    cleanup()

print("FAILED" if fails else "ALL PASS", f"({fails} failures)" if fails else "")
sys.exit(1 if fails else 0)
