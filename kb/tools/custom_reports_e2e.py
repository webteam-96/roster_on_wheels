"""Custom report builder (gap agent, 2026-11-19): catalog, run with filters / sort / group, the column whitelist,
parameterized filters, club and district scope (no IDOR), save / update / delete, Excel / CSV / PDF export and the
email to officers.

    python -I kb/tools/custom_reports_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET          the API's JwtSettings__Secret
  ROW_E2E_FAKE_BREVO_PORT     port of the fake Brevo server this script starts (default 5216)

Start the API with BackgroundJobs__Enabled=false, Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email and
Brevo__ApiKey=<anything>, so the officers' email goes to this script and nothing leaves the machine.
Local copies only. Removes what it creates (saved reports, email_log rows of this run, a temporary district Admin role).
"""
import base64, hashlib, hmac, json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5216'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MARK = 'e2e-custom-reports'
fails = 0
sent_mail = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(v) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {tok}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
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


class FakeBrevo(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        sent_mail.append(json.loads(body or b'{}'))
        out = json.dumps({"messageId": f"<e2e-{len(sent_mail)}@fake>"}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


server = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), FakeBrevo)
threading.Thread(target=server.serve_forever, daemon=True).start()

# ── People and places ─────────────────────────────────────────────────────────────────────────────────────────
CLUB = 341
admin = one(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=2 AND IsActive=1 AND isdeleted=0 "
            f"AND fk_club_id={CLUB} AND fk_member_master_profile_id=1068")
check("member 1068 is an Admin of club 341", admin == 1068, admin)
district = one(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}")
other_club = one(f"SELECT pk_club_id FROM club_master WHERE pk_club_id<>{CLUB} AND IFNULL(isdeleted,0)=0 "
                 "AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id=1068 AND r.IsActive=1 "
                 "AND r.isdeleted=0 AND (r.fk_club_id=club_master.pk_club_id OR r.fk_role_id=3)) ORDER BY 1 LIMIT 1")
plain = 999
dadmin = one(f"SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id "
             f"WHERE c.fk_district_id={district} AND cm.fk_club_id<>{CLUB} AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 "
             "AND NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id=cm.fk_member_master_profile_id "
             "AND x.fk_role_id<>1 AND x.IsActive=1 AND x.isdeleted=0) ORDER BY 1 LIMIT 1")
start = sql("SELECT UTC_TIMESTAMP()")
start_log = one("SELECT IFNULL(MAX(pk_id),0) FROM email_log") if sql("SHOW COLUMNS FROM email_log LIKE 'pk_id'") else None
role_id = None

A, P, D = token(admin, ["Admin"]), token(plain, ["Member"]), token(dadmin, ["Admin"])
C, DI = f"/api/clubs/{CLUB}/custom-reports", f"/api/districts/{district}/custom-reports"

try:
    # ── Access ────────────────────────────────────────────────────────────────────────────────────────────────
    s, cat = call("GET", C + "/catalog", A)
    check("club admin gets the catalog", s == 200 and {x['key'] for x in cat} >= {"members", "attendance", "dues", "projects"}, cat)
    check("an ordinary member is refused", call("GET", C + "/catalog", P)[0] == 403)
    check("club admin is refused another club (IDOR)", call("POST", f"/api/clubs/{other_club}/custom-reports/run", A,
                                                            {"source": "members", "columns": ["name"]})[0] == 403)
    check("club admin is refused the district scope", call("GET", DI, A)[0] == 403)
    check("no token is refused", call("GET", C + "/catalog", "x")[0] == 401)

    # ── Run ───────────────────────────────────────────────────────────────────────────────────────────────────
    active = one(f"SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id "
                 f"WHERE cm.fk_club_id={CLUB} AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND IFNULL(m.isdeleted,0)=0")
    s, r = call("POST", C + "/run", A, {"source": "members", "columns": ["name", "email", "joinedDate", "active"],
                                         "filters": [{"field": "active", "op": "eq", "value": "true"}], "sortBy": "name"})
    check("members run returns the club's active members", s == 200 and len(r['rows']) == active, (s, r if s != 200 else len(r['rows']), active))
    names = [x[0] or "" for x in r['rows']] if s == 200 else []
    check("rows are sorted by name", names == sorted(names, key=lambda n: n.lower()) or len(names) < 2, names[:5])
    check("columns carry labels and types", s == 200 and [c['type'] for c in r['columns']] == ["text", "text", "date", "bool"], r.get('columns') if s == 200 else r)

    s, r = call("POST", C + "/run", A, {"source": "members", "columns": ["name", "PasswordHash"]})
    check("a column outside the whitelist is rejected", s == 400, r)
    s, r = call("POST", C + "/run", A, {"source": "member_credentials", "columns": ["name"]})
    check("a source outside the whitelist is rejected", s == 400, r)
    s, r = call("POST", C + "/run", A, {"source": "members", "columns": ["name"],
                                         "filters": [{"field": "name", "op": "eq", "value": "x' OR '1'='1"}]})
    check("an injection attempt in a filter value matches nothing", s == 200 and r['rows'] == [], r)
    s, r = call("POST", C + "/run", A, {"source": "members", "columns": ["name"],
                                         "filters": [{"field": "yearsInClub", "op": "gt", "value": "ten"}]})
    check("a bad filter value is rejected", s == 400, r)

    s, r = call("POST", C + "/run", A, {"source": "members", "groupBy": "active", "sumFields": ["yearsInClub"], "sortBy": "count", "sortDesc": True})
    all_members = one(f"SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id "
                      f"WHERE cm.fk_club_id={CLUB} AND IFNULL(cm.isdeleted,0)=0 AND IFNULL(m.isdeleted,0)=0")
    check("group by gives counts that add up", s == 200 and sum(x[1] for x in r['rows']) == all_members
          and [c['key'] for c in r['columns']] == ["active", "count", "sum_yearsInClub"], (s, r, all_members))

    for src, cols in (("attendance", ["meeting", "date", "present"]), ("dues", ["member", "rate", "paid"]),
                      ("projects", ["title", "date", "cost"])):
        s, r = call("POST", C + "/run", A, {"source": src, "columns": cols})
        check(f"{src} source runs", s == 200 and isinstance(r.get('rows'), list), (s, r))
    year = one("SELECT pk_year_id FROM rotary_year_master WHERE YearLabel='2025-26'")
    s, r = call("POST", "/api/clubs/1/custom-reports/run", token(sa := one(
        "SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"), ["SuperAdmin"]),
        {"source": "projects", "columns": ["title"], "yearId": year})
    expected = one("SELECT COUNT(*) FROM rotary_projects_2025_26 WHERE fk_club_id=1 AND IFNULL(isdeleted,0)=0")
    check("projects read the chosen year's table", s == 200 and len(r['rows']) == min(expected, 5000), (s, r if s != 200 else len(r['rows']), expected))

    # ── District scope ────────────────────────────────────────────────────────────────────────────────────────
    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, fk_district_id, AllClubsAccess, IsActive, isdeleted, created_by) "
        f"VALUES ({dadmin}, 2, 0, {district}, 0, 1, 0, 0)")
    role_id = one(f"SELECT MAX(pk_member_role_id) FROM member_roles WHERE fk_member_master_profile_id={dadmin} AND fk_district_id={district}")
    s, r = call("POST", DI + "/run", D, {"source": "members", "groupBy": "club"})
    dist_total = one(f"SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id "
                     f"JOIN club_master c ON c.pk_club_id=cm.fk_club_id JOIN district_master d ON d.pk_district_id=c.fk_district_id "
                     f"LEFT JOIN zone_master z ON z.pk_zone_id=d.fk_zone_id WHERE c.fk_district_id={district} AND IFNULL(c.isdeleted,0)=0 "
                     "AND COALESCE(c.IsActive,1)=1 AND COALESCE(d.IsActive,1)=1 AND COALESCE(z.IsActive,1)=1 "
                     "AND COALESCE(c.ClubType,'')<>'Rotaract Club' AND IFNULL(cm.isdeleted,0)=0 AND IFNULL(m.isdeleted,0)=0")
    check("district admin sees all the district's clubs, grouped", s == 200 and sum(x[1] for x in r['rows']) == dist_total, (s, r if s != 200 else sum(x[1] for x in r['rows']), dist_total))
    check("district admin is refused another district", call("GET", f"/api/districts/{district + 1}/custom-reports", D)[0] == 403)

    # ── Save, list, update, delete ────────────────────────────────────────────────────────────────────────────
    definition = {"source": "members", "columns": ["name", "email", "mobile"], "filters": [{"field": "active", "op": "eq", "value": "true"}], "sortBy": "name"}
    s, saved = call("POST", C, A, {"name": f"{MARK} members", "definition": definition, "scheduleMonthly": True, "scheduleDay": 3, "scheduleFormat": "xlsx"})
    check("save a report", s == 200 and saved.get('id'), saved)
    rid = saved.get('id')
    s, lst = call("GET", C, A)
    check("it is listed for the club", s == 200 and any(x['id'] == rid and x['definition']['columns'] == ["name", "email", "mobile"] for x in lst), lst)
    s, lst = call("GET", DI, D)
    check("it is not listed for the district", s == 200 and all(x['id'] != rid for x in lst), lst)
    check("the district path cannot read the club's report", call("GET", f"{DI}/{rid}", D)[0] == 404)
    s, r = call("PUT", f"{C}/{rid}", A, {"name": f"{MARK} members v2", "definition": definition, "scheduleMonthly": True, "scheduleDay": 40, "scheduleFormat": "xlsx"})
    check("an invalid schedule day is rejected", s == 400, r)
    s, r = call("PUT", f"{C}/{rid}", A, {"name": f"{MARK} members v2", "definition": definition, "scheduleMonthly": True, "scheduleDay": 3, "scheduleFormat": "pdf"})
    check("update a report", s == 200 and call("GET", f"{C}/{rid}", A)[1].get('name') == f"{MARK} members v2", r)
    check("a stored timestamp is UTC", one(f"SELECT ABS(TIMESTAMPDIFF(MINUTE, modified_date, UTC_TIMESTAMP())) FROM custom_reports WHERE pk_report_id={rid}") <= 5)

    # ── Export ────────────────────────────────────────────────────────────────────────────────────────────────
    s, x = call("POST", C + "/export?format=xlsx&title=Members", A, definition)
    check("Excel export", s == 200 and x[:2] == b"PK", (s, x[:80]))
    s, x = call("POST", C + "/export?format=csv&title=Members", A, definition)
    check("CSV export has a header and one line per member", s == 200 and x.decode('utf-8-sig').splitlines()[0] == "Name,Email,Mobile"
          and len(x.decode('utf-8-sig').splitlines()) >= active + 1, (s, x[:120]))
    s, x = call("POST", C + "/export?format=pdf&title=Members", A, definition)
    check("PDF export", s == 200 and x[:4] == b"%PDF", (s, x[:80]))
    check("an unknown format is rejected", call("POST", C + "/export?format=exe", A, definition)[0] == 400)
    check("export is refused to an ordinary member", call("POST", C + "/export?format=csv", P, definition)[0] == 403)

    # ── Email to officers ─────────────────────────────────────────────────────────────────────────────────────
    officers = one(f"SELECT COUNT(DISTINCT TRIM(m.EmailId)) FROM member_roles mr JOIN member_master_profile m ON m.pk_member_master_profile_id=mr.fk_member_master_profile_id "
                   f"AND IFNULL(m.isdeleted,0)=0 WHERE mr.fk_role_id=2 AND mr.IsActive=1 AND mr.isdeleted=0 AND m.EmailId LIKE '%@%' AND mr.fk_club_id={CLUB}")
    before = len(sent_mail)
    s, r = call("POST", f"{C}/{rid}/send", A)
    mails = sent_mail[before:]
    check("send emails each officer once", s == 200 and r.get('sent') == officers == len(mails), (s, r, officers, len(mails)))
    check("the email carries the PDF", all(m.get('attachment') and m['attachment'][0]['name'].endswith('.pdf') for m in mails), [m.get('attachment', [{}])[0].get('name') for m in mails])
    check("send is refused to an ordinary member", call("POST", f"{C}/{rid}/send", P)[0] == 403)

    s, _ = call("DELETE", f"{C}/{rid}", A)
    check("delete a report", s == 204 and call("GET", f"{C}/{rid}", A)[0] == 404)
    check("delete keeps the row (soft delete)", one(f"SELECT isdeleted FROM custom_reports WHERE pk_report_id={rid}") == 1)
finally:
    sql(f"DELETE FROM custom_reports WHERE name LIKE '{MARK}%'")
    if role_id:
        sql(f"DELETE FROM member_roles WHERE pk_member_role_id={role_id}")
    if start_log is not None:
        sql(f"DELETE FROM email_log WHERE pk_id>{start_log} AND email_type='custom_report'")
    server.shutdown()
    left = one(f"SELECT COUNT(*) FROM custom_reports WHERE name LIKE '{MARK}%'")
    check("test rows removed", left == 0, left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
