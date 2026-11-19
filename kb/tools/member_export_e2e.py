"""Club member directory export: GET api/clubs/{id}/members/export (2026-11-19).

    python -I kb/tools/member_export_e2e.py <api_base> <mysql_port> <database>

Environment: ROW_E2E_ADMIN_ID (a club Admin, role 2 on one club), ROW_E2E_MEMBER_ID (an ordinary member of the same
club, role 1 only), ROW_E2E_PASSWORD (both accounts' password in the local copy). Local copies only, never production.
Checks: the club's admin gets Excel and PDF, the Excel holds every member the list holds, an unknown format is refused,
an ordinary member and the admin of another club get 403, and each download is written to audit_log. Nothing is changed
except the audit rows.
"""
import io, json, os, subprocess, sys, urllib.error, urllib.request, zipfile

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
ADMIN, MEMBER, PASSWORD = int(os.environ['ROW_E2E_ADMIN_ID']), int(os.environ['ROW_E2E_MEMBER_ID']), os.environ['ROW_E2E_PASSWORD']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def email(member_id):
    return sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={member_id}")


club = int(sql(f"SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={ADMIN} AND fk_role_id=2 "
               "AND IsActive=1 AND isdeleted=0 AND fk_club_id>0 LIMIT 1"))
other = int(sql(f"SELECT pk_club_id FROM club_master WHERE IsActive=1 AND isdeleted=0 AND pk_club_id<>{club} AND pk_club_id NOT IN "
                f"(SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={ADMIN} AND IsActive=1 AND isdeleted=0 "
                f"AND fk_club_id IS NOT NULL) AND fk_district_id NOT IN (SELECT fk_district_id FROM member_roles WHERE "
                f"fk_member_master_profile_id={ADMIN} AND fk_role_id=2 AND IFNULL(fk_club_id,0)=0 AND IsActive=1 AND isdeleted=0 "
                f"AND fk_district_id IS NOT NULL) LIMIT 1"))

s, _, b = call("POST", "/api/auth/login", {"email": email(ADMIN), "password": PASSWORD})
check("admin signs in", s == 200, s)
admin_token = json.loads(b)["token"]
s, _, b = call("POST", "/api/mobile/auth/login", {"email": email(MEMBER), "password": PASSWORD})
check("member signs in (app)", s == 200, s)
j = json.loads(b)
member_token = j.get("token") or (j.get("data") or {}).get("token")  # the app API may wrap replies in {data: ...}

audit_before = int(sql(f"SELECT COUNT(*) FROM audit_log WHERE action='EXPORT' AND entity_type='club_members' AND entity_id={club}"))

s, ctype, xlsx = call("GET", f"/api/clubs/{club}/members/export?format=xlsx", token=admin_token)
check("admin downloads Excel", s == 200 and "spreadsheetml" in ctype and xlsx[:2] == b"PK", (s, ctype))
s, _, listing = call("GET", f"/api/clubs/{club}/members?page=1&pageSize=5000", token=admin_token)
total = json.loads(listing)["totalCount"]
sheet = zipfile.ZipFile(io.BytesIO(xlsx)).read("xl/worksheets/sheet1.xml").decode()
rows = sheet.count("<x:row ") + sheet.count("<row ")
# Written rows above the data: title, subtitle, header (row 3 is an empty spacer and is not stored).
check("Excel holds every listed member", rows - 3 == total, f"sheet rows {rows} (3 above the data), list {total}")

s, ctype, pdf = call("GET", f"/api/clubs/{club}/members/export?format=pdf", token=admin_token)
check("admin downloads PDF", s == 200 and ctype.startswith("application/pdf") and pdf[:4] == b"%PDF", (s, ctype))

s, _, _ = call("GET", f"/api/clubs/{club}/members/export?format=csv", token=admin_token)
check("unknown format refused", s == 400, s)
s, _, _ = call("GET", f"/api/clubs/{club}/members/export?format=xlsx", token=member_token)
check("ordinary member refused", s == 403, s)
s, _, _ = call("GET", f"/api/clubs/{other}/members/export?format=xlsx", token=admin_token)
check("admin of another club refused", s == 403, s)
s, _, _ = call("GET", f"/api/clubs/{club}/members/export?format=xlsx")
check("anonymous refused", s == 401, s)

audit_after = int(sql(f"SELECT COUNT(*) FROM audit_log WHERE action='EXPORT' AND entity_type='club_members' AND entity_id={club}"))
check("both downloads audit-logged", audit_after - audit_before == 2, audit_after - audit_before)

# Printable outputs: GET members/print (labels, badges, tents) on A4 and Letter.
for kind in ("labels", "badges", "tents"):
    for paper in ("a4", "letter"):
        req = urllib.request.Request(f"{API}/api/clubs/{club}/members/print?kind={kind}&paper={paper}",
                                     headers={"Authorization": f"Bearer {admin_token}"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                ok, body, skipped = r.status == 200, r.read(), r.headers.get("X-Members-Without-Address")
        except urllib.error.HTTPError as e:
            ok, body, skipped = False, b"", e.code
        check(f"print {kind} {paper}", ok and body[:4] == b"%PDF" and (kind != "labels" or skipped is not None), skipped)
s, _, _ = call("GET", f"/api/clubs/{club}/members/print?kind=badges", token=member_token)
check("ordinary member refused print", s == 403, s)
s, _, _ = call("GET", f"/api/clubs/{club}/members/print?kind=posters", token=admin_token)
check("unknown print kind refused", s == 400, s)

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
