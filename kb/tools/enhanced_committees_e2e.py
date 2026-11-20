"""Enhanced committees (gap agent, port 5127): any-depth subcommittees with no loops, committee-private documents
served only after an access check, and committee email through the mass email pipeline with a private archive.
Club committees are sub_groups (club 341), district committees district_committee_group (district 5).

    python -I kb/tools/enhanced_committees_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET          the API's JwtSettings__Secret
  ROW_E2E_FAKE_BREVO_PORT     port of the fake Brevo server this script starts (default 5227)
  ROW_E2E_API_DIR             the API's content root (default row/api of this checkout), to check where files land

Start the API with Brevo__ApiUrl=http://127.0.0.1:<fake port>/v3/smtp/email, Brevo__ApiKey=<anything> and
BackgroundJobs__Enabled=false. Nothing leaves the machine: the only recipient (member 999) has its address rewritten to
e2e-999@example.invalid for the run (restored at the end), and every send is answered by this script.
Local copies only. Everything created (committees, members, documents and files, messages, campaigns, wallets, credit
history) is removed at the end and the feature switch is put back; audit_log rows stay (append-only by design).
"""
import base64, hashlib, hmac, json, os, secrets, shutil, subprocess, sys, threading, time
import urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5227'))
API_DIR = os.environ.get('ROW_E2E_API_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'row', 'api'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = "e2e-committees"
CLUB, DISTRICT, ADMIN, MEMBER, SA, OUTSIDER = 341, 5, 1068, 999, 1, 2
fails = 0
sent = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(v) if v.lstrip('-').isdigit() else v


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, files=None, raw=False):
    """(status, parsed JSON, or bytes + content type when raw)."""
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    data = None
    if files is not None:
        boundary = "----e2e" + secrets.token_hex(8)
        parts = []
        for name, value in files.items():
            if isinstance(value, tuple):
                fname, content = value
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{fname}"\r\n'
                             f'Content-Type: application/octet-stream\r\n\r\n'.encode() + content + b"\r\n")
            else:
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        h["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            content, status, ctype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        content, status, ctype = e.read(), e.code, e.headers.get("Content-Type", "")
    if raw:
        return status, (content, ctype)
    try:
        return status, json.loads(content or b"{}")
    except ValueError:
        return status, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


class Brevo(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            data = b""
            while True:
                size = int(self.rfile.readline().split(b";")[0], 16)
                if size == 0:
                    self.rfile.readline()
                    break
                data += self.rfile.read(size)
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


server = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), Brevo)
threading.Thread(target=server.serve_forever, daemon=True).start()

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
year = one("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")
other_club_group = one(f"SELECT pk_sub_group_id FROM sub_groups WHERE fk_club_id > 0 AND fk_club_id <> {CLUB} AND isdeleted = 0 LIMIT 1")
email_before = sql(f"SELECT IFNULL(EmailId, '') FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}")
flag_before = sql("SELECT enabled FROM platform_features WHERE feature_key = 'committees'")
t_admin, t_member, t_sa, t_out = token(ADMIN, ["Admin"]), token(MEMBER, ["Member"]), token(SA, ["SuperAdmin"]), token(OUTSIDER, ["Member"])
wallets = []


def club_groups():
    return sql(f"SELECT GROUP_CONCAT(pk_sub_group_id) FROM sub_groups WHERE GroupName LIKE '{TAG}%'")


def district_groups():
    return sql(f"SELECT GROUP_CONCAT(id) FROM district_committee_group WHERE group_name LIKE '{TAG}%'")


def cleanup():
    cg, dg = club_groups(), district_groups()
    for kind, ids in (("club", cg), ("district", dg)):
        for i in (ids.split(",") if ids and ids != "NULL" else []):
            shutil.rmtree(os.path.join(API_DIR, "App_Data", "committee-files", f"{kind}-{i}"), ignore_errors=True)
    conds = []
    if cg and cg != "NULL":
        conds.append(f"(committee_kind = 'club' AND fk_committee_id IN ({cg}))")
    if dg and dg != "NULL":
        conds.append(f"(committee_kind = 'district' AND fk_committee_id IN ({dg}))")
    if conds:
        where = " OR ".join(conds)
        emails = sql(f"SELECT GROUP_CONCAT(fk_mass_email_id) FROM committee_messages WHERE fk_mass_email_id > 0 AND ({where})")
        if emails and emails != "NULL":
            sql(f"DELETE FROM club_mass_email_recipients WHERE fk_mass_email_id IN ({emails}); "
                f"DELETE FROM club_credit_usage_history WHERE Source = 'MassEmail' AND SourceId IN ({emails}); "
                f"DELETE FROM club_mass_emails WHERE pk_mass_email_id IN ({emails})")
        sql(f"DELETE FROM committee_messages WHERE {where}; DELETE FROM committee_documents WHERE {where}")
    # drafts a failed send left behind (none expected)
    sql(f"DELETE r FROM club_mass_email_recipients r JOIN club_mass_emails e ON e.pk_mass_email_id = r.fk_mass_email_id WHERE e.Subject LIKE '{TAG}%'; "
        f"DELETE FROM club_mass_emails WHERE Subject LIKE '{TAG}%'")
    if cg and cg != "NULL":
        sql(f"DELETE FROM sub_group_members WHERE fk_sub_group_id IN ({cg}); DELETE FROM sub_groups WHERE pk_sub_group_id IN ({cg})")
    if dg and dg != "NULL":
        sql(f"DELETE FROM district_committee_group_member WHERE fk_group_id IN ({dg}); DELETE FROM district_committee_group WHERE id IN ({dg})")
    if wallets:
        sql(f"DELETE FROM club_credits WHERE pk_credit_id IN ({','.join(map(str, wallets))})")


def club_group(name):
    return one(f"INSERT INTO sub_groups (fk_club_id, fk_year_id, GroupName, created_by, isdeleted) "
               f"VALUES ({CLUB}, {year}, '{TAG} {name}', {ADMIN}, 0); SELECT LAST_INSERT_ID();")


def district_group(name):
    return one(f"INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, isdeleted) "
               f"VALUES ({DISTRICT}, {year}, '{TAG} {name}', 0); SELECT LAST_INSERT_ID();")


def wallet(club, district):
    wid = one("INSERT INTO club_credits (fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount, FromDate, ToDate, IsActive, isdeleted) "
              f"VALUES ({district}, {club}, 'Email', 50, 0, CURDATE() - INTERVAL 1 DAY, CURDATE() + INTERVAL 30 DAY, 1, 0); SELECT LAST_INSERT_ID();")
    wallets.append(wid)


def wait_sent(email_id):
    for _ in range(40):
        if sql(f"SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = {email_id}") in ("Sent", "Failed"):
            break
        time.sleep(0.5)
    return sql(f"SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = {email_id}")


cleanup()
try:
    sql(f"UPDATE member_master_profile SET EmailId = 'e2e-{MEMBER}@example.invalid' WHERE pk_member_master_profile_id = {MEMBER}")
    P, C, G = club_group("parent"), club_group("child"), club_group("grandchild")
    sql(f"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, isdeleted) VALUES ({P}, {MEMBER}, {ADMIN}, 0)")
    DP, DC = district_group("parent"), district_group("child")
    sql(f"INSERT INTO district_committee_group_member (fk_group_id, fk_member_id, is_member, name, fk_club_id, isdeleted) "
        f"VALUES ({DP}, {MEMBER}, 1, 'e2e member', {CLUB}, 0)")

    # ── Feature switch ────────────────────────────────────────────────────────────────────────────────────────
    if flag_before != "1":
        check("module off: committee routes answer 404", call("GET", "/api/committees/mine", t_member)[0] == 404)
    check("club admin cannot switch the feature", call("PUT", "/api/features/committees", t_admin, {"enabled": True})[0] == 403)
    s, _ = call("PUT", "/api/features/committees", t_sa, {"enabled": True})
    check("SuperAdmin switches the feature on", s in (200, 204), s)
    time.sleep(1)

    # ── Member's committees ───────────────────────────────────────────────────────────────────────────────────
    s, mine = call("GET", "/api/committees/mine", t_member)
    keys = {(m["kind"], m["id"]) for m in mine} if s == 200 else set()
    check("member sees his club and district committees", ("club", P) in keys and ("district", DP) in keys, (s, mine))
    check("member does not see committees he is not in", ("club", C) not in keys and ("club", G) not in keys, keys)

    # ── Subcommittee tree ─────────────────────────────────────────────────────────────────────────────────────
    check("ordinary member cannot read the club's committee tree",
          call("GET", f"/api/committees/tree?kind=club&scopeId={CLUB}&yearId={year}", t_member)[0] == 403)
    check("child under parent", call("PUT", f"/api/committees/club/{C}/parent", t_admin, {"parentId": P})[0] == 200)
    check("grandchild under child (third level)", call("PUT", f"/api/committees/club/{G}/parent", t_admin, {"parentId": C})[0] == 200)
    s, b = call("PUT", f"/api/committees/club/{P}/parent", t_admin, {"parentId": G})
    check("loop refused (parent under its own grandchild)", s == 400 and "itself" in b.get("message", ""), (s, b))
    check("committee under itself refused", call("PUT", f"/api/committees/club/{P}/parent", t_admin, {"parentId": P})[0] == 400)
    check("parent from another club refused", call("PUT", f"/api/committees/club/{P}/parent", t_admin, {"parentId": other_club_group})[0] == 400)
    check("member of the committee cannot move it (403)", call("PUT", f"/api/committees/club/{P}/parent", t_member, {"parentId": None})[0] == 403)
    check("non-member cannot even see another committee (404)", call("PUT", f"/api/committees/club/{C}/parent", t_member, {"parentId": None})[0] == 404)
    check("bad kind answers 404", call("GET", f"/api/committees/zone/{P}", t_admin)[0] == 404)
    s, tree = call("GET", f"/api/committees/tree?kind=club&scopeId={CLUB}&yearId={year}", t_admin)
    parents = {n["id"]: n["parentId"] for n in tree} if s == 200 else {}
    check("club tree shows three levels", parents.get(P) is None and parents.get(C) == P and parents.get(G) == C, (s, parents))
    s, d = call("GET", f"/api/committees/club/{G}", t_admin)
    check("grandchild detail has the full path", s == 200 and [x["id"] for x in d["path"]] == [P, C, G] and d["canManage"], (s, d))
    s, d = call("GET", f"/api/committees/club/{P}", t_member)
    check("member reads his committee: children listed, cannot manage",
          s == 200 and [x["id"] for x in d["children"]] == [C] and d["isMember"] and not d["canManage"], (s, d))
    check("outsider cannot read the committee (404)", call("GET", f"/api/committees/club/{P}", t_out)[0] == 404)
    check("district child under parent (district manager)", call("PUT", f"/api/committees/district/{DC}/parent", t_sa, {"parentId": DP})[0] == 200)
    check("club admin is no district manager (404 on a district committee he is not in)",
          call("PUT", f"/api/committees/district/{DC}/parent", t_admin, {"parentId": None})[0] == 404)
    s, tree = call("GET", f"/api/committees/tree?kind=district&scopeId={DISTRICT}&yearId={year}", t_sa)
    check("district tree shows the subcommittee", s == 200 and {n["id"]: n["parentId"] for n in tree}.get(DC) == DP, (s, tree))

    # ── Documents ─────────────────────────────────────────────────────────────────────────────────────────────
    s, b = call("POST", f"/api/committees/club/{P}/documents", t_member, files={"title": f"{TAG} minutes", "file": ("minutes.pdf", PDF)})
    doc = b.get("id") if s == 200 else None
    check("committee member uploads a document", s == 200 and doc, (s, b))
    s, b = call("POST", f"/api/committees/club/{P}/documents", t_member, files={"title": "fake", "file": ("fake.pdf", b"<html>not a pdf</html>")})
    check("file whose content does not match its type refused", s == 400, (s, b))
    s, b = call("POST", f"/api/committees/club/{P}/documents", t_member, files={"title": "exe", "file": ("tool.exe", b"MZ")})
    check("executable refused", s == 400, (s, b))
    check("outsider cannot upload (404)",
          call("POST", f"/api/committees/club/{P}/documents", t_out, files={"title": "x", "file": ("x.pdf", PDF)})[0] == 404)
    stored = sql(f"SELECT stored_name FROM committee_documents WHERE pk_id = {doc or 0}")
    path = os.path.join(API_DIR, "App_Data", "committee-files", f"club-{P}", stored)
    check("file is stored under App_Data (outside the web root)", bool(stored) and os.path.isfile(path), path)
    check("no copy under wwwroot", not any(stored in f for _, _, fs in os.walk(os.path.join(API_DIR, "wwwroot")) for f in fs) if stored else False)
    check("App_Data is not served as a static file",
          call("GET", f"/App_Data/committee-files/club-{P}/{stored}", raw=True)[0] in (401, 403, 404))
    s, docs = call("GET", f"/api/committees/club/{P}/documents", t_member)
    check("member lists the documents (own upload removable)", s == 200 and len(docs) == 1 and docs[0]["canDelete"], (s, docs))
    s, (content, ctype) = call("GET", f"/api/committees/club/{P}/documents/{doc}/file", t_member, raw=True)
    check("member downloads the file after the access check", s == 200 and content == PDF and "pdf" in ctype, (s, ctype))
    check("outsider cannot list (404)", call("GET", f"/api/committees/club/{P}/documents", t_out)[0] == 404)
    check("outsider cannot download (404)", call("GET", f"/api/committees/club/{P}/documents/{doc}/file", t_out, raw=True)[0] == 404)
    check("anonymous cannot download (401)", call("GET", f"/api/committees/club/{P}/documents/{doc}/file", raw=True)[0] == 401)
    check("document id under another committee answers 404",
          call("GET", f"/api/committees/club/{C}/documents/{doc}/file", t_admin, raw=True)[0] == 404)
    check("non-member of the child committee cannot list its documents",
          call("GET", f"/api/committees/club/{C}/documents", t_member)[0] == 404)
    s, b = call("POST", f"/api/committees/club/{P}/documents", t_admin, files={"title": f"{TAG} budget", "file": ("budget.pdf", PDF)})
    admin_doc = b.get("id") if s == 200 else 0
    check("manager uploads too", s == 200 and admin_doc, (s, b))
    check("member cannot remove the manager's document",
          call("DELETE", f"/api/committees/club/{P}/documents/{admin_doc}", t_member)[0] == 404)
    check("member removes his own document", call("DELETE", f"/api/committees/club/{P}/documents/{doc}", t_member)[0] == 200)
    check("removed file is gone from disk", not os.path.exists(path), path)
    check("manager removes any document", call("DELETE", f"/api/committees/club/{P}/documents/{admin_doc}", t_admin)[0] == 200)
    s, b = call("POST", f"/api/committees/district/{DP}/documents", t_member, files={"title": f"{TAG} plan", "file": ("plan.pdf", PDF)})
    check("district committee member uploads", s == 200, (s, b))
    s, docs = call("GET", f"/api/committees/district/{DP}/documents", t_sa)
    check("district manager sees it", s == 200 and len(docs) == 1, (s, docs))

    # ── Committee email ───────────────────────────────────────────────────────────────────────────────────────
    wallet(CLUB, DISTRICT)
    wallet(0, DISTRICT)
    check("empty subject refused", call("POST", f"/api/committees/club/{P}/messages", t_member, {"subject": " ", "body": "x"})[0] == 400)
    check("outsider cannot write to the committee (404)",
          call("POST", f"/api/committees/club/{P}/messages", t_out, {"subject": "x", "body": "x"})[0] == 404)
    s, b = call("POST", f"/api/committees/club/{P}/messages", t_member, {"subject": f"{TAG} club note", "body": "Line one\n<b>two</b>"})
    check("member emails his committee", s == 200, (s, b))
    email_id = one(f"SELECT fk_mass_email_id FROM committee_messages WHERE pk_id = {b.get('id', 0)}") if s == 200 else 0
    status = wait_sent(email_id) if email_id else ""
    recips = sql(f"SELECT GROUP_CONCAT(fk_member_id) FROM club_mass_email_recipients WHERE fk_mass_email_id = {email_id or 0} AND isdeleted = 0")
    check("sent through the mass email pipeline to the committee only", status == "Sent" and recips == str(MEMBER), (status, recips))
    to = [t["email"] for p in sent for t in p.get("to", [])]
    check("every send went to the fake server, to the rewritten address only",
          to and set(to) == {f"e2e-{MEMBER}@example.invalid"}, to)
    check("message body is escaped HTML", any("&lt;b&gt;two&lt;/b&gt;" in p.get("htmlContent", "") for p in sent), sent[-1:] if sent else None)
    s, arch = call("GET", f"/api/committees/club/{P}/messages", t_member)
    check("member sees the archive", s == 200 and len(arch) == 1 and arch[0]["subject"] == f"{TAG} club note" and arch[0]["status"] == "Sent", (s, arch))
    check("manager sees the archive", call("GET", f"/api/committees/club/{P}/messages", t_admin)[0] == 200)
    check("outsider cannot read the archive (404)", call("GET", f"/api/committees/club/{P}/messages", t_out)[0] == 404)
    check("member of the parent cannot read the child's archive (404)", call("GET", f"/api/committees/club/{C}/messages", t_member)[0] == 404)
    s, b = call("POST", f"/api/committees/district/{DP}/messages", t_sa, {"subject": f"{TAG} district note", "body": "hello"})
    d_email = one(f"SELECT fk_mass_email_id FROM committee_messages WHERE pk_id = {b.get('id', 0)}") if s == 200 else 0
    d_recips = sql(f"SELECT GROUP_CONCAT(fk_member_id) FROM club_mass_email_recipients WHERE fk_mass_email_id = {d_email or 0} AND isdeleted = 0")
    check("district manager emails the district committee (its members only)",
          s == 200 and wait_sent(d_email) == "Sent" and d_recips == str(MEMBER), (s, b, d_recips))
    s, arch = call("GET", f"/api/committees/district/{DP}/messages", t_member)
    check("district committee member sees the district archive", s == 200 and len(arch) == 1, (s, arch))
    sql(f"INSERT INTO committee_messages (committee_kind, fk_committee_id, fk_mass_email_id, sent_by, subject, body, created_date) "
        + "SELECT 'club', " + str(P) + f", 0, {MEMBER}, '{TAG} filler', 'x', UTC_TIMESTAMP() FROM "
        + "(SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) n")
    s, b = call("POST", f"/api/committees/club/{P}/messages", t_member, {"subject": f"{TAG} eleventh", "body": "x"})
    check("daily message limit (10 per committee)", s == 400 and "at most" in b.get("message", ""), (s, b))
finally:
    cleanup()
    sql(f"UPDATE member_master_profile SET EmailId = {('NULL' if email_before == '' else repr(email_before))} WHERE pk_member_master_profile_id = {MEMBER}")
    call("PUT", "/api/features/committees", t_sa, {"enabled": flag_before == "1"})
    if flag_before == "":
        sql("DELETE FROM platform_features WHERE feature_key = 'committees'")
    server.shutdown()
    left = one(f"SELECT (SELECT COUNT(*) FROM sub_groups WHERE GroupName LIKE '{TAG}%') + "
               f"(SELECT COUNT(*) FROM district_committee_group WHERE group_name LIKE '{TAG}%') + "
               f"(SELECT COUNT(*) FROM committee_documents WHERE title LIKE '{TAG}%') + "
               f"(SELECT COUNT(*) FROM committee_messages WHERE subject LIKE '{TAG}%') + "
               f"(SELECT COUNT(*) FROM club_mass_emails WHERE Subject LIKE '{TAG}%')")
    check("cleanup left no test rows", left == 0, left)
    check("member's address restored",
          sql(f"SELECT IFNULL(EmailId, '') FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}") == email_before)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
