"""Service hours and contributions: a member logs hours against a club project (or other service) from the app with a
photo, the club's admin approves or rejects, records cash and in-kind contributions, and reads the club report (with
hours recorded on a volunteer sheet counted in) and its Excel export; the district report sums per club. Also: the
feature flag, input rules, the 24-hour day limit, image-only uploads, and that members, other clubs' admins and
club admins (on the district report) are refused.

    python -I kb/tools/service_hours_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Sends no email.
Writes test rows to the given LOCAL database only and removes them at the end (one project row, one volunteer sheet,
the service_hours and service_contributions rows, uploaded photos, the feature switch). Never run it against production.
"""
import base64, hashlib, hmac, json, os, secrets, struct, subprocess, sys, time, urllib.error, urllib.request, zlib
from datetime import date, timedelta

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
WWWROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'row', 'api', 'wwwroot')
MARK = 'e2e-svchours'
FLAG = 'service_hours'
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(float(v.split()[0])) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, raw=None, ctype=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    if data is not None:
        headers["Content-Type"] = ctype or "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, rtype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, rtype = e.read(), e.code, e.headers.get("Content-Type", "")
    if "json" in rtype and payload:
        return status, json.loads(payload)
    return status, payload


def upload(path, tok, filename, content, ctype="image/png"):
    b = "----e2e" + secrets.token_hex(8)
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: {ctype}\r\n\r\n').encode() + content + f"\r\n--{b}--\r\n".encode()
    return call("POST", path, tok, raw=body, ctype=f"multipart/form-data; boundary={b}")


def png(w=4, h=4):
    raw = b''.join(b'\x00' + b'\x17\x45\x8f' * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


# ── People and places, picked by query ────────────────────────────────────────────────────────────────────────
ADMIN_ROLE = "r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0"
NO_ROLES = ("NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id=cm.fk_member_master_profile_id "
            "AND x.fk_role_id<>1 AND x.IsActive=1 AND x.isdeleted=0)")
PLAIN = (f"SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
         f"ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND IFNULL(m.isdeleted,0)=0 "
         f"WHERE cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND {NO_ROLES} AND cm.fk_club_id=")
clubs = [int(x) for x in sql(
    "SELECT DISTINCT r.fk_club_id FROM member_roles r JOIN club_master c ON c.pk_club_id=r.fk_club_id "
    f"WHERE {ADMIN_ROLE} AND c.IsActive=1 AND IFNULL(c.isdeleted,0)=0 AND IFNULL(c.fk_district_id,0)>0 "
    "AND (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id=c.pk_club_id AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 "
    f"AND {NO_ROLES})>=2 ORDER BY 1 LIMIT 2").split()]
club_a, club_b = clubs[0], clubs[1]


def admin_of(club, other):
    return one(f"SELECT r.fk_member_master_profile_id FROM member_roles r WHERE {ADMIN_ROLE} AND r.fk_club_id={club} "
               "AND NOT EXISTS (SELECT 1 FROM member_roles y WHERE y.fk_member_master_profile_id=r.fk_member_master_profile_id "
               f"AND y.IsActive=1 AND y.isdeleted=0 AND (y.fk_role_id IN (3,4,7) OR y.fk_club_id={other} "
               "OR (y.fk_role_id=2 AND IFNULL(y.fk_club_id,0)=0))) ORDER BY 1 LIMIT 1")


admin_a, admin_b = admin_of(club_a, club_b), admin_of(club_b, club_a)
plain, plain2 = [int(x) for x in sql(PLAIN + f"{club_a} ORDER BY 1 LIMIT 2").split()]
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
district = one(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club_a}")
dist_admin = one(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=2 AND IFNULL(fk_club_id,0)=0 "
                 f"AND fk_district_id={district} AND IsActive=1 AND isdeleted=0 LIMIT 1")
year = one("SELECT pk_year_id FROM rotary_year_master WHERE CURDATE() BETWEEN StartDate AND EndDate AND isdeleted=0 LIMIT 1")
projects_table = "rotary_projects_" + sql(f"SELECT YearLabel FROM rotary_year_master WHERE pk_year_id={year}").replace("-", "_")
module_id = one("SELECT pk_module_id FROM module_master WHERE isdeleted=0 ORDER BY pk_module_id LIMIT 1")
assert None not in (admin_a, admin_b, plain, plain2, sa, district, year, module_id), "test data missing"
print(f"clubs {club_a}/{club_b}, admins {admin_a}/{admin_b}, members {plain}/{plain2}, district {district} "
      f"(district admin {dist_admin or 'none: SuperAdmin stands in'}), year {year}")

t_a, t_b, t_sa = token(admin_a, "Admin"), token(admin_b, "Admin"), token(sa, "SuperAdmin")
t_plain, t_plain2 = token(plain, "Member"), token(plain2, "Member")
t_dist = token(dist_admin, "Admin") if dist_admin else t_sa
folder = os.path.join(WWWROOT, 'Documents', 'ServiceHours', f'Group{club_a}')


def cleanup():
    for sid in sql(f"SELECT pk_service_hours_id FROM service_hours WHERE note LIKE '{MARK}%'").split():
        for f in (os.listdir(folder) if os.path.isdir(folder) else []):
            if f.startswith(f"service-{sid}-"):
                os.remove(os.path.join(folder, f))
    for d in (folder, os.path.dirname(folder)):  # empty folders only
        if os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
    sql(f"DELETE FROM service_hours WHERE note LIKE '{MARK}%'; DELETE FROM service_contributions WHERE description LIKE '{MARK}%'; "
        f"DELETE FROM volunteer_sheets WHERE title LIKE '{MARK}%'; DELETE FROM `{projects_table}` WHERE title LIKE '{MARK}%'")


cleanup()
flag_before = sql(f"SELECT enabled FROM platform_features WHERE feature_key='{FLAG}'")
sql(f"INSERT INTO `{projects_table}` (fk_club_id, fk_module_id, fk_year_id, title, project_date, man_hours, Currency, isdeleted) "
    f"VALUES ({club_a}, {module_id}, {year}, '{MARK} project', CURDATE(), 10, 'LKR', 0)")
project = one(f"SELECT MAX(pk_project_id) FROM `{projects_table}` WHERE title='{MARK} project'")
today = date.today().isoformat()
yesterday = (date.today() - timedelta(days=1)).isoformat()
MINE, CLUB, CLUB_B = "/api/mobile/service-hours", f"/api/clubs/{club_a}/service-hours", f"/api/clubs/{club_b}/service-hours"
DIST = f"/api/districts/{district}/service-hours"

try:
    # ── Feature flag ───────────────────────────────────────────────────────────────────────────────────────────
    if flag_before != "1":
        check("module is off until switched on (app route 404)", call("GET", MINE, t_plain)[0] == 404)
        check("module off: club route 404", call("GET", CLUB, t_a)[0] == 404)
    r = call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": True})
    check("SuperAdmin switches the module on", r[0] in (200, 204), r)

    # ── The app: options and logging ───────────────────────────────────────────────────────────────────────────
    r = call("GET", f"{MINE}/options?date={today}", t_plain)
    opt = next((c for c in r[1] if c["clubId"] == club_a), None) if r[0] == 200 else None
    check("options list the member's club with this year's projects", opt and opt["yearId"] == year
          and any(p["id"] == project for p in opt["projects"]), r)
    base = {"clubId": club_a, "projectId": project, "serviceDate": today, "hours": 2.5, "note": f"{MARK} soup kitchen"}
    r = call("POST", MINE, t_plain, base)
    e1 = r[1].get("id") if r[0] == 200 else None
    check("member logs hours on a project (pending)", r[0] == 200 and r[1]["status"] == "pending"
          and r[1]["projectTitle"] == f"{MARK} project" and r[1]["yearId"] == year, r)
    r = call("POST", MINE, t_plain, {**base, "projectId": None, "otherService": f"{MARK} beach clean-up", "hours": 1, "serviceDate": yesterday})
    e2 = r[1].get("id") if r[0] == 200 else None
    check("member logs other service", r[0] == 200 and r[1]["projectId"] is None, r)
    check("other service needs a description", call("POST", MINE, t_plain, {**base, "projectId": None})[0] == 400)
    check("more than 24 hours refused", call("POST", MINE, t_plain, {**base, "hours": 25})[0] == 400)
    check("zero hours refused", call("POST", MINE, t_plain, {**base, "hours": 0})[0] == 400)
    future = (date.today() + timedelta(days=5)).isoformat()
    check("future date refused", call("POST", MINE, t_plain, {**base, "serviceDate": future})[0] == 400)
    check("unknown project refused", call("POST", MINE, t_plain, {**base, "projectId": 999999999})[0] == 400)
    r = call("POST", MINE, t_plain, {**base, "hours": 22})
    check("a day holds 24 hours at most across entries", r[0] == 400, r)
    check("cannot log for a club one is not a member of", call("POST", MINE, t_plain, {**base, "clubId": club_b})[0] == 403)

    # ── Photo ──────────────────────────────────────────────────────────────────────────────────────────────────
    r = upload(f"{MINE}/{e1}/photo", t_plain, "selfie.png", png())
    photo = r[1].get("photoPath") if r[0] == 200 else None
    check("member adds a service photo", photo and photo.startswith(f"/Documents/ServiceHours/Group{club_a}/service-{e1}-")
          and os.path.isfile(os.path.join(WWWROOT, photo.lstrip('/'))), r)
    check("a non-image is refused", upload(f"{MINE}/{e1}/photo", t_plain, "notes.png", b"just text, not an image")[0] == 400)
    check("a PDF is refused", upload(f"{MINE}/{e1}/photo", t_plain, "doc.pdf", b"%PDF-1.4 x", "application/pdf")[0] == 400)
    check("another member cannot add a photo to it", upload(f"{MINE}/{e1}/photo", t_plain2, "x.png", png())[0] == 404)
    check("an oversized photo is refused", upload(f"{MINE}/{e1}/photo", t_plain, "big.png", png() + b"\0" * (7 * 1024 * 1024))[0] in (400, 413))

    # ── Lists and access ───────────────────────────────────────────────────────────────────────────────────────
    r = call("GET", MINE, t_plain)
    check("member sees own history", r[0] == 200 and {e1, e2} <= {e["id"] for e in r[1]["entries"] if e["source"] == "logged"}, r)
    r = call("GET", MINE, t_plain2)
    check("another member does not see it", r[0] == 200 and all(e["id"] not in (e1, e2) for e in r[1]["entries"] if e["source"] == "logged"), r)
    r = call("GET", f"{CLUB}?status=pending&yearId={year}", t_a)
    check("club admin lists pending entries", r[0] == 200 and {e1, e2} <= {e["id"] for e in r[1]}, r)
    check("plain member cannot list the club's entries", call("GET", CLUB, t_plain)[0] == 403)
    check("another club's admin cannot list them", call("GET", CLUB, t_b)[0] == 403)
    check("bad status filter refused", call("GET", f"{CLUB}?status=bogus", t_a)[0] == 400)

    # ── Review ─────────────────────────────────────────────────────────────────────────────────────────────────
    check("another club's admin cannot review it (own club path)", call("POST", f"{CLUB_B}/{e1}/review", t_b, {"approve": True})[0] == 404)
    check("plain member cannot review", call("POST", f"{CLUB}/{e1}/review", t_plain, {"approve": True})[0] == 403)
    r = call("POST", f"{CLUB}/{e1}/review", t_a, {"approve": True, "note": "Thank you"})
    check("club admin approves", r[0] == 200 and r[1]["status"] == "approved" and r[1]["reviewedAt"], r)
    r = call("POST", f"{CLUB}/{e2}/review", t_a, {"approve": False, "note": "Not club service"})
    check("club admin rejects", r[0] == 200 and r[1]["status"] == "rejected" and r[1]["reviewNote"] == "Not club service", r)
    check("photo cannot change once approved", upload(f"{MINE}/{e1}/photo", t_plain, "y.png", png())[0] == 404)
    check("approved entry cannot be removed by the member", call("DELETE", f"{MINE}/{e1}", t_plain)[0] == 404)
    check("another member cannot remove the rejected one", call("DELETE", f"{MINE}/{e2}", t_plain2)[0] == 404)
    check("member removes the rejected entry", call("DELETE", f"{MINE}/{e2}", t_plain)[0] == 204)

    # ── Contributions ──────────────────────────────────────────────────────────────────────────────────────────
    r = call("GET", f"{CLUB}/projects?yearId={year}", t_a)
    check("club admin lists the year's projects", r[0] == 200 and any(p["id"] == project for p in r[1]), r)
    cash = {"projectId": project, "yearId": year, "kind": "cash", "amount": 1000, "contributor": "A donor",
            "description": f"{MARK} cash", "contributionDate": today}
    r = call("POST", f"{CLUB}/contributions", t_a, cash)
    c1 = r[1].get("id") if r[0] == 200 else None
    check("cash contribution recorded in the project's currency", r[0] == 200 and r[1]["currency"] == "LKR", r)
    r = call("POST", f"{CLUB}/contributions", t_a, {**cash, "kind": "in_kind", "amount": 250, "description": f"{MARK} rice bags"})
    c2 = r[1].get("id") if r[0] == 200 else None
    check("in-kind contribution recorded", r[0] == 200, r)
    check("in-kind needs a description", call("POST", f"{CLUB}/contributions", t_a, {**cash, "kind": "in_kind", "description": ""})[0] == 400)
    check("negative amount refused", call("POST", f"{CLUB}/contributions", t_a, {**cash, "amount": -5})[0] == 400)
    check("plain member cannot record one", call("POST", f"{CLUB}/contributions", t_plain, cash)[0] == 403)
    check("another club's project refused", call("POST", f"{CLUB_B}/contributions", t_b, cash)[0] == 400)
    r = call("GET", f"{CLUB}/contributions?yearId={year}", t_a)
    check("contributions listed", r[0] == 200 and {c1, c2} <= {x["id"] for x in r[1]}, r)
    check("another club's admin cannot delete it", call("DELETE", f"{CLUB_B}/contributions/{c2}", t_b)[0] == 404)

    # ── Volunteer sheet hours count in ─────────────────────────────────────────────────────────────────────────
    sql(f"INSERT INTO volunteer_sheets (fk_club_id, title, fk_year_id, fk_project_id, public_token, status, created_by) "
        f"VALUES ({club_a}, '{MARK} sheet', {year}, {project}, '{secrets.token_hex(16)}', 'closed', {admin_a})")
    sheet = one(f"SELECT MAX(pk_sheet_id) FROM volunteer_sheets WHERE title='{MARK} sheet'")
    sql(f"INSERT INTO volunteer_slots (fk_sheet_id, task, starts_at, capacity, filled) VALUES ({sheet}, 'Serve', UTC_TIMESTAMP(), 5, 1)")
    slot = one(f"SELECT MAX(pk_slot_id) FROM volunteer_slots WHERE fk_sheet_id={sheet}")
    sql(f"INSERT INTO volunteer_signups (fk_slot_id, fk_member_id, hours) VALUES ({slot}, {plain2}, 1.5)")

    # ── Reports ────────────────────────────────────────────────────────────────────────────────────────────────
    r = call("GET", f"{CLUB}/report?yearId={year}", t_a)
    row = next((p for p in r[1]["byProject"] if p["projectId"] == project), None) if r[0] == 200 else None
    check("club report by project: logged, volunteer, members, money", row and row["hours"] == 2.5 and row["volunteerHours"] == 1.5
          and row["members"] == 2 and row["projectManHours"] == 10 and row["cash"] == [{"currency": "LKR", "amount": 1000.0}]
          and row["inKind"] == [{"currency": "LKR", "amount": 250.0}], row or r)
    mem = {m["memberId"]: m for m in r[1]["byMember"]} if r[0] == 200 else {}
    check("club report by member", mem.get(plain, {}).get("hours") == 2.5 and mem.get(plain2, {}).get("volunteerHours") == 1.5, mem)
    check("rejected hours are not counted", r[0] == 200 and all(p["projectId"] is not None or p["hours"] == 0 for p in r[1]["byProject"]), r)
    check("plain member cannot read the club report", call("GET", f"{CLUB}/report", t_plain)[0] == 403)
    r = call("GET", f"{CLUB}/report/export?yearId={year}", t_a)
    check("Excel export", r[0] == 200 and isinstance(r[1], bytes) and r[1][:2] == b"PK", r[0])
    r = call("GET", f"{DIST}/report?yearId={year}", t_dist)
    crow = next((c for c in r[1]["byClub"] if c["clubId"] == club_a), None) if r[0] == 200 else None
    check("district report per club", crow and crow["hours"] >= 2.5 and crow["volunteerHours"] >= 1.5, r)
    check("district Excel export", (lambda x: x[0] == 200 and x[1][:2] == b"PK")(call("GET", f"{DIST}/report/export?yearId={year}", t_dist)))
    check("club admin cannot read the district report", call("GET", f"{DIST}/report", t_a)[0] == 403)
    check("plain member cannot read the district report", call("GET", f"{DIST}/report", t_plain)[0] == 403)
    check("unknown year refused", call("GET", f"{CLUB}/report?yearId=999999", t_a)[0] == 400)
    r = call("GET", MINE, t_plain2)
    check("member's history shows volunteer sheet hours", r[0] == 200 and any(e["source"] == "volunteer" and e["hours"] == 1.5
          and e["projectTitle"] == f"{MARK} project" for e in r[1]["entries"]), r)
    r = call("GET", MINE, t_plain)
    yr = next((y for y in r[1]["years"] if y["yearId"] == year), None) if r[0] == 200 else None
    check("member's year totals", yr and yr["approvedHours"] == 2.5 and yr["pendingHours"] == 0, r)

    check("club admin deletes a contribution", call("DELETE", f"{CLUB}/contributions/{c2}", t_a)[0] == 204)
finally:
    cleanup()
    call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": flag_before == "1"})
    if flag_before == "":
        sql(f"DELETE FROM platform_features WHERE feature_key='{FLAG}'")
    left = one(f"SELECT (SELECT COUNT(*) FROM service_hours WHERE note LIKE '{MARK}%') + "
               f"(SELECT COUNT(*) FROM service_contributions WHERE description LIKE '{MARK}%') + "
               f"(SELECT COUNT(*) FROM volunteer_sheets WHERE title LIKE '{MARK}%') + (SELECT COUNT(*) FROM `{projects_table}` WHERE title LIKE '{MARK}%')")
    check("cleanup left no test rows", left == 0, left)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
