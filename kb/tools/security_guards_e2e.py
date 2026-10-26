"""Write guards added 2026-10-23: a member registers only their own push device token; only a SuperAdmin
changes the module masters; club id 0 is no club, so a district Admin row (fk_club_id = 0) does not pass club writes.
Ownership (Phase 1b): a record id from another club or district answers 404 on this club's or district's URL (reads
and writes, year-wise project tables included); sub group members must belong to the club; a district wallet is never
counted as a club wallet with the same id; payment links and the designation master are changed only by those who
manage them.

    python -I kb/tools/security_guards_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret). Local copies only, never production. It adds
temporary role rows and records (titled 'e2e-own'), switches the sub groups module on for the run, and restores all
of it at the end.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call_json(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def call(method, path, tok, body=None):
    return call_json(method, path, tok, body)[0]


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def check_not_owned(name, method, path, tok, body=None):
    # the ownership check's own 404, not a switched-off module's 404 (that one names the feature)
    s, reply = call_json(method, path, tok, body)
    check(name, s == 404 and reply == {"message": "Not found."}, (s, reply))


made, roles = [], []  # (table, key column, id) rows and member_roles ids this script adds; removed at the end


def add(table, key, cols, vals):
    # INSERT and LAST_INSERT_ID() in one mysql session: a second process would read 0
    i = int(sql(f"INSERT INTO {table} ({cols}) VALUES ({vals}); SELECT LAST_INSERT_ID()"))
    made.append((table, key, i))
    return i


def add_role(member, district_id, club_id):
    roles.append(sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, fk_club_id, "
                     f"IsActive) VALUES ({member}, 2, {district_id}, {club_id}, 1); SELECT LAST_INSERT_ID()"))


# plain members only: a SuperAdmin or Admin row in the DB would pass the caller checks under test
a, b, c = [int(x) for x in sql(
    "SELECT pk_member_master_profile_id FROM member_master_profile m WHERE IFNULL(isdeleted,0)=0 AND NOT EXISTS "
    "(SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = m.pk_member_master_profile_id "
    "AND r.fk_role_id <> 1) ORDER BY pk_member_master_profile_id LIMIT 3").split()]
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 LIMIT 1"))
sat = token(sa, ["SuperAdmin"])
district = int(sql("SELECT pk_district_id FROM district_master WHERE IFNULL(isdeleted,0)=0 LIMIT 1"))
saved = sql(f"SELECT IFNULL(LastDeviceToken,'') FROM member_master_profile WHERE pk_member_master_profile_id = {b}")
flag = None  # sub groups switch before the run: '-1' no row, else '0' or '1'
try:
    # 1. device token: only the member themself (or a SuperAdmin)
    s = call("POST", f"/api/members/{b}/device-token", token(a, ["Member"]), {"deviceToken": "e2e-hijack"})
    check("another member's device token is refused", s == 403, s)
    check("the token was not changed", sql(f"SELECT IFNULL(LastDeviceToken,'') FROM member_master_profile "
                                          f"WHERE pk_member_master_profile_id = {b}") == saved)
    s = call("POST", f"/api/members/{a}/device-token", token(a, ["Member"]), {"deviceToken": None})
    check("own device token still accepted", s == 200, s)

    # 2. module masters: SuperAdmin only
    for method, path in [("POST", "/api/module-categories"), ("PUT", "/api/module-categories/1"),
                         ("DELETE", "/api/module-categories/999999"), ("POST", "/api/modules"),
                         ("PUT", "/api/modules/1"), ("DELETE", "/api/modules/999999")]:
        s = call(method, path, token(a, ["Member", "Admin"]), {})
        check(f"{method} {path} refused for a non-SuperAdmin", s == 403, s)
    s = call("DELETE", "/api/modules/999999", sat)
    check("SuperAdmin passes the guard (unknown id is not a 403)", s != 403, s)

    # 3. club id 0: a district Admin row has fk_club_id = 0 and must not open /api/clubs/0 writes
    add_role(a, district, 0)
    s = call("POST", "/api/clubs/0/announcements", token(a, ["Admin"]), {})
    check("a district Admin cannot write to club 0", s == 403, s)
    s = call("PUT", f"/api/districts/{district}/settings-e2e-probe", token(a, ["Admin"]), {})
    check("the same district Admin still passes the district write guard", s != 403, s)

    # 4. ownership: club A's Admin (member a) and district dA's Admin (member c) against club B / district dB records
    A, mem_a = [int(x) for x in sql(
        "SELECT fk_club_id, MIN(fk_member_master_profile_id) FROM club_members WHERE IsActive = 1 AND "
        "IFNULL(isdeleted,0) = 0 AND fk_club_id > 0 GROUP BY fk_club_id ORDER BY fk_club_id LIMIT 1").split()]
    B, mem_b = [int(x) for x in sql(
        f"SELECT fk_club_id, MIN(fk_member_master_profile_id) FROM club_members WHERE IsActive = 1 AND "
        f"IFNULL(isdeleted,0) = 0 AND fk_club_id > 0 AND fk_club_id <> {A} AND fk_member_master_profile_id NOT IN "
        f"(SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = {A}) "
        f"GROUP BY fk_club_id ORDER BY fk_club_id LIMIT 1").split()]
    dA = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {A}"))
    dB = int(sql(f"SELECT pk_district_id FROM district_master WHERE pk_district_id <> {dA} "
                 f"AND IFNULL(isdeleted,0)=0 LIMIT 1"))
    year, label = sql("SELECT y.pk_year_id, REPLACE(y.YearLabel, '-', '_') FROM rotary_year_master y "
                      "JOIN information_schema.tables t ON t.table_schema = DATABASE() "
                      "AND t.table_name = CONCAT('rotary_projects_', REPLACE(y.YearLabel, '-', '_')) "
                      "ORDER BY y.pk_year_id DESC LIMIT 1").split()
    add_role(a, "NULL", A)
    add_role(c, dA, 0)
    ca, da = token(a, ["Admin"]), token(c, ["Admin"])

    ANN = "announcements", "pk_announcement_id", "fk_club_id, fk_district_id, Title, PublishDateTime, ExpiryDateTime"
    WHEN = "'e2e-own', NOW(), NOW() + INTERVAL 30 DAY"
    ann_a, ann_b = add(*ANN, f"{A}, NULL, {WHEN}"), add(*ANN, f"{B}, NULL, {WHEN}")
    ann_da, ann_db = add(*ANN, f"0, {dA}, {WHEN}"), add(*ANN, f"0, {dB}, {WHEN}")
    PP = "past_presidents", "pk_past_president_id", "fk_club_id, fk_year_id"
    pp_a, pp_b = add(*PP, f"{A}, {year}"), add(*PP, f"{B}, {year}")
    wl_b = add("weblinks", "pk_weblink_id", "fk_club_id, Title", f"{B}, 'e2e-own'")
    sg_b = add("sub_groups", "pk_sub_group_id", "fk_club_id, fk_year_id, GroupName", f"{B}, {year}, 'e2e-own'")
    link_b = add("event_payment_links", "pk_id", "fk_club_id", f"{B}")
    PRJ = f"rotary_projects_{label}", "pk_project_id", "fk_club_id, fk_district_id, fk_module_id, fk_year_id, title"
    prj_da, prj_db = add(*PRJ, f"0, {dA}, 0, {year}, 'e2e-own'"), add(*PRJ, f"0, {dB}, 0, {year}, 'e2e-own'")

    for kind, base, other, own in [("announcement", "announcements", ann_b, ann_a),
                                   ("past president", "past-presidents", pp_b, pp_a)]:
        check_not_owned(f"reading another club's {kind} through club {A} is 404", "GET",
                        f"/api/clubs/{A}/{base}/{other}", ca)
        s = call("GET", f"/api/clubs/{A}/{base}/{own}", ca)
        check(f"reading the club's own {kind} is 200", s == 200, s)
    check_not_owned("deleting another club's announcement is 404", "DELETE", f"/api/clubs/{A}/announcements/{ann_b}", ca)
    check("... and it is untouched", sql(f"SELECT CONCAT(IsActive, isdeleted) FROM announcements "
                                         f"WHERE pk_announcement_id = {ann_b}") == "10")
    check_not_owned("deleting another club's weblink is 404", "DELETE", f"/api/clubs/{A}/weblinks/{wl_b}", ca)
    check("... and it is untouched", sql(f"SELECT CONCAT(IsActive, isdeleted) FROM weblinks "
                                         f"WHERE pk_weblink_id = {wl_b}") == "10")

    flag = sql("SELECT IFNULL(MAX(enabled), -1) FROM platform_features WHERE feature_key = 'sub_groups'")
    s = call("PUT", "/api/features/sub_groups", sat, {"enabled": True})
    check("sub groups switched on for the run (the module ships off)", s in (200, 204), s)
    check_not_owned("updating another club's sub group is 404", "PUT", f"/api/clubs/{A}/sub-groups/{sg_b}", ca,
                    {"yearId": int(year), "groupName": "hijack", "memberIds": []})
    check("... and its name is unchanged", sql(f"SELECT GroupName FROM sub_groups WHERE pk_sub_group_id = {sg_b}") == "e2e-own")
    s = call("POST", f"/api/clubs/{A}/sub-groups", ca, {"yearId": int(year), "groupName": "e2e-own", "memberIds": [mem_b]})
    check("a sub group with another club's member is refused (400)", s == 400, s)
    s = call("POST", f"/api/clubs/{A}/sub-groups", ca, {"yearId": int(year), "groupName": "e2e-own", "memberIds": [mem_a]})
    check("a sub group with the club's own member is created", s == 200, s)
    for sg in sql(f"SELECT pk_sub_group_id FROM sub_groups WHERE fk_club_id = {A} AND GroupName = 'e2e-own'").split():
        made += [("sub_groups", "pk_sub_group_id", int(sg)), ("sub_group_members", "fk_sub_group_id", int(sg))]
    check("only the valid sub group exists", sql(f"SELECT COUNT(*) FROM sub_groups WHERE fk_club_id = {A} "
                                                 f"AND GroupName = 'e2e-own'") == "1")

    s, before = call_json("GET", f"/api/credit-management/club/{A}/balance", sat)
    add("club_credits", "pk_credit_id", "fk_club_id, fk_district_id, CreditType, CreditCount, UsedCount, FromDate, "
        "ToDate, IsActive, isdeleted", f"0, {A}, 'Email', 777, 0, NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 30 DAY, 1, 0")
    s2, after = call_json("GET", f"/api/credit-management/club/{A}/balance", sat)
    check(f"district wallet {A} is not counted in club {A}'s balance",
          s == s2 == 200 and before is not None and after is not None
          and after.get("emailRemaining") == before.get("emailRemaining"), (s, s2, before, after))

    s = call("DELETE", f"/api/event-payment-links/{link_b}", ca)
    check("another club's payment link cannot be deleted (403)", s == 403, s)
    check("... and it is untouched", sql(f"SELECT CONCAT(IsActive, isdeleted) FROM event_payment_links "
                                         f"WHERE pk_id = {link_b}") == "10")
    s = call("DELETE", "/api/designations/999999", ca)
    check("a club Admin cannot change the designation master (403)", s == 403, s)
    s = call("DELETE", "/api/designations/999999", sat)
    check(f"a SuperAdmin passes the designation master guard ({s})", s != 403, s)

    check_not_owned("deleting another district's announcement is 404", "DELETE",
                    f"/api/districts/{dA}/announcements/{ann_db}", da)
    check("... and it is untouched", sql(f"SELECT CONCAT(IsActive, isdeleted) FROM announcements "
                                         f"WHERE pk_announcement_id = {ann_db}") == "10")
    s = call("DELETE", f"/api/districts/{dA}/announcements/{ann_da}", da)
    check(f"deleting the district's own announcement passes ({s})", s not in (403, 404), s)
    check_not_owned("updating another district's project (year table) is 404", "PUT",
                    f"/api/districts/{dA}/projects/{year}/{prj_db}", da, {"title": "hijack"})
    check("... and its title is unchanged", sql(f"SELECT title FROM rotary_projects_{label} "
                                                f"WHERE pk_project_id = {prj_db}") == "e2e-own")
    s = call("PUT", f"/api/districts/{dA}/projects/{year}/{prj_da}", da, {"title": "e2e-own"})
    check(f"updating the district's own project passes the ownership check ({s})", s not in (403, 404), s)

    # Generic errors: a validation message still reaches the caller; a missing record is a 404 from the global handler.
    zone = sql("SELECT ZoneName FROM zone_master ORDER BY pk_zone_id LIMIT 1")
    s, reply = call_json("POST", "/api/zones", sat, {"zoneName": zone})
    check("a duplicate zone name is 409 with the service's message", s == 409
          and reply == {"message": "A zone with this name already exists."}, (s, reply))
finally:
    if flag is not None:
        call("PUT", "/api/features/sub_groups", sat, {"enabled": flag == "1"})
        if flag == "-1":
            sql("DELETE FROM platform_features WHERE feature_key = 'sub_groups'")
    for table, key, i in reversed(made):
        try:
            sql(f"DELETE FROM {table} WHERE {key} = {i}")
        except subprocess.CalledProcessError as e:
            print(f"WARN cleanup {table} {i}: {e.stderr.strip()}")
    for rid in roles:
        try:
            sql(f"DELETE FROM member_roles WHERE pk_member_role_id = {rid}")
        except subprocess.CalledProcessError:  # a hard-delete trigger: retire the row instead
            sql(f"UPDATE member_roles SET IsActive = 0, isdeleted = 1 WHERE pk_member_role_id = {rid}")
    sql(f"UPDATE member_master_profile SET LastDeviceToken = NULLIF('{saved}', '') WHERE pk_member_master_profile_id = {b}")

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)
