"""Live target dashboard (N10, feature target_dashboard, 2026-10-23).

    python -I kb/tools/target_dashboard_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Writes test rows to the given
LOCAL database and removes them at the end. Rows are marked 'E2E N10' in a name column or -10 in created_by /
modified_by: goal entries, a growth target, a District Dues roster, attendance, Foundation giving, projects, an AG
assignment, a district admin role, and a synthetic load on the district with the most clubs for the timing check.
"""
import base64, datetime, hashlib, hmac, json, os, statistics, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
FEATURE = "target_dashboard"
M = -10  # created_by / modified_by marker of this script's rows
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(v) if v and v != "NULL" else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1200}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, json.loads(data) if data else None
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data) if data else None
        except ValueError:
            return e.code, data.decode(errors="replace")[:200]


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


# ── Year, district, clubs and people, all picked by query ──────────────────────────────────────────────────────────────
year, label, start, end = sql("SELECT pk_year_id, YearLabel, StartDate, EndDate FROM rotary_year_master "
                              "WHERE IsCurrent=1 AND COALESCE(isdeleted,0)=0 ORDER BY StartDate DESC LIMIT 1").split()
year = int(year)
projects_table = "rotary_projects_" + label.replace("-", "_")
has_projects = one(f"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='{projects_table}'") > 0
active_member = "cm.IsActive=1 AND cm.isdeleted=0 AND cm.IsHonoraryMember=0"
# The district with the most clubs that have a club admin, with no District Dues or district goals for this year yet.
district = one(f"""SELECT c.fk_district_id FROM club_master c JOIN member_roles r ON r.fk_club_id=c.pk_club_id
    AND r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0 WHERE c.isdeleted=0 AND c.IsActive=1
    AND NOT EXISTS (SELECT 1 FROM club_dues d WHERE d.fk_district_id=c.fk_district_id AND d.RotaryYear='{label}')
    AND NOT EXISTS (SELECT 1 FROM goal_entries e WHERE e.EntityType='District' AND e.fk_district_id=c.fk_district_id
                    AND e.fk_year_id={year})
    GROUP BY c.fk_district_id ORDER BY COUNT(DISTINCT c.pk_club_id) DESC LIMIT 1""")
# Club A: a club admin, at least 3 members, no club goals and no AG for this year.
club = one(f"""SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id={district} AND c.isdeleted=0 AND c.IsActive=1
    AND EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_club_id=c.pk_club_id AND r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0)
    AND NOT EXISTS (SELECT 1 FROM goal_entries e WHERE e.EntityType='Club' AND e.fk_club_id=c.pk_club_id AND e.fk_year_id={year})
    AND NOT EXISTS (SELECT 1 FROM district_ag a WHERE a.fk_club_id=c.pk_club_id AND a.fk_year_id={year})
    AND (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id=c.pk_club_id AND {active_member}) >= 3
    ORDER BY c.pk_club_id LIMIT 1""")
admin = one(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={club} AND fk_role_id=2 "
            "AND IsActive=1 AND isdeleted=0 ORDER BY 1 LIMIT 1")
# Club B: same district, the admin of A has no role there and is not a member there.
other = one(f"""SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id={district} AND c.isdeleted=0 AND c.IsActive=1
    AND c.pk_club_id<>{club}
    AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_club_id=c.pk_club_id AND r.fk_member_master_profile_id={admin})
    AND NOT EXISTS (SELECT 1 FROM club_members cm WHERE cm.fk_club_id=c.pk_club_id AND cm.fk_member_master_profile_id={admin})
    ORDER BY c.pk_club_id LIMIT 1""")
roster = [int(x) for x in sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} "
                              f"AND {active_member} ORDER BY 1 LIMIT 3").split()]
no_roles = "NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id<>1 AND IsActive=1 AND isdeleted=0)"
plain = one(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND {active_member} "
            f"AND cm.fk_member_master_profile_id {no_roles} ORDER BY 1 LIMIT 1")
# The AG and the district admin: plain members of other clubs of the district, not members of A or B.
others = [int(x) for x in sql(f"""SELECT DISTINCT cm.fk_member_master_profile_id FROM club_members cm
    JOIN club_master c ON c.pk_club_id=cm.fk_club_id WHERE c.fk_district_id={district} AND {active_member}
    AND cm.fk_club_id NOT IN ({club},{other}) AND cm.fk_member_master_profile_id {no_roles}
    AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members
        WHERE fk_club_id IN ({club},{other}))
    ORDER BY 1 LIMIT 2""").split()]
ag, dg = others
outsider = one(f"SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id "
               f"WHERE c.fk_district_id<>{district} AND {active_member} AND cm.fk_member_master_profile_id NOT IN "
               f"(SELECT x.fk_member_master_profile_id FROM club_members x JOIN club_master y ON y.pk_club_id=x.fk_club_id "
               f"WHERE y.fk_district_id={district}) AND cm.fk_member_master_profile_id {no_roles} ORDER BY 1 LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
fund = one("SELECT pk_fund_id FROM trf_fund_master ORDER BY pk_fund_id LIMIT 1")
prev_year = one(f"SELECT pk_year_id FROM rotary_year_master WHERE StartDate < '{start}' AND COALESCE(isdeleted,0)=0 "
                "ORDER BY StartDate DESC LIMIT 1")
modules = dict(x.split("\t") for x in sql("SELECT ModuleKey, pk_module_id FROM module_master "
                                          "WHERE ModuleKey IN ('community_service','club_service')").splitlines())
fields = dict(x.split("\t") for x in sql("SELECT FieldKey, pk_field_id FROM goal_fields WHERE FieldKey IN "
                                         "('new_members','club_annual_fund_ytd_target','club_polioplus_ytd_target',"
                                         "'total_contributions_target')").splitlines())
print(f"year {label} ({year}), district {district}, club A {club} (admin {admin}), club B {other}, AG {ag}, "
      f"district admin {dg}, member {plain}, outsider {outsider}, SuperAdmin {sa}")
t = {k: token(v, r) for k, v, r in [("sa", sa, "SuperAdmin"), ("admin", admin, "Admin"), ("ag", ag, "Member"),
                                     ("dg", dg, "Admin"), ("plain", plain, "Member"), ("outsider", outsider, "Member")]}
was_on = sql(f"SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='{FEATURE}'") == "1"
old_growth = one(f"SELECT target_net_growth FROM club_growth_targets WHERE fk_club_id={club} AND fk_year_id={year}")
D, C = f"/api/districts/{district}/targets", f"/api/clubs/{club}/targets"


def cleanup():
    steps = [
        "DELETE am FROM club_attendance_members am JOIN club_attendance a ON a.pk_attendance_id=am.fk_attendance_id "
        "WHERE a.EventName LIKE 'E2E N10%'",
        "DELETE FROM club_attendance WHERE EventName LIKE 'E2E N10%'",
        "DELETE FROM trf_contributions WHERE DonorName LIKE 'E2E N10%'",
        f"DELETE FROM goal_entries WHERE created_by={M}",
        f"DELETE FROM district_project_target WHERE created_by={M}",
        f"DELETE FROM club_growth_targets WHERE modified_by={M}",
        f"DELETE m FROM club_dues_members m JOIN club_dues d ON d.pk_club_dues_id=m.fk_club_dues_id WHERE d.created_by={M}",
        f"DELETE FROM club_dues WHERE created_by={M}",
        f"DELETE FROM district_ag WHERE created_by={M}",
        f"DELETE FROM member_roles WHERE created_by={M}",
    ]
    if has_projects:
        steps.append(f"DELETE FROM `{projects_table}` WHERE title LIKE 'E2E N10%'")
    if old_growth is not None:  # the club had its own target: put it back
        steps.append(f"INSERT INTO club_growth_targets (fk_club_id, fk_year_id, target_net_growth) VALUES ({club},{year},"
                     f"{old_growth}) ON DUPLICATE KEY UPDATE target_net_growth={old_growth}")
    for q in steps:  # one failing step must not leave the others undone
        try:
            sql(q)
        except subprocess.CalledProcessError as e:
            print(f"WARN cleanup step failed: {q[:60]}... {e.stderr.strip()[:200]}")


def set_feature(on):
    return call("PUT", f"/api/features/{FEATURE}", t["sa"], {"enabled": on})[0]


start_d, end_d = datetime.date.fromisoformat(start), datetime.date.fromisoformat(end)
elapsed = min(1.0, max(0.0, ((datetime.date.today() - start_d).days + 1) / ((end_d - start_d).days + 1)))


def status(actual, target):  # the API's rule, see TargetDashboardService.StatusOf
    if target is None:
        return "none"
    if target <= 0:
        return "green" if actual >= target else "red"
    p = actual / target
    return "green" if p >= elapsed else "amber" if p >= 0.75 * elapsed else "red"


def worst(statuses):
    return next((s for s in ("red", "amber", "green") if s in statuses), "none")


cleanup()
try:
    # ── Feature switch ─────────────────────────────────────────────────────────────────────────────────────────────
    set_feature(False)
    check("off: district targets answer 404", call("GET", D, t["sa"])[0] == 404)
    check("off: club targets answer 404", call("GET", C, t["sa"])[0] == 404)
    s = set_feature(True)
    check("SuperAdmin switches the feature on", s == 204, s)

    # ── Test data for club A (and a little for club B) ─────────────────────────────────────────────────────────────
    day = (start_d + datetime.timedelta(days=10)).isoformat()
    sql(f"INSERT INTO club_growth_targets (fk_club_id, fk_year_id, target_net_growth, modified_by, modified_date) "
        f"VALUES ({club},{year},5,{M},NOW()) ON DUPLICATE KEY UPDATE target_net_growth=5, modified_by={M}")
    sql("INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by) VALUES "
        f"({fields['new_members']},{year},'Club',{club},0,4,{M}),"
        f"({fields['club_annual_fund_ytd_target']},{year},'Club',{club},0,600,{M}),"
        f"({fields['club_polioplus_ytd_target']},{year},'Club',{club},0,400,{M}),"
        f"({fields['new_members']},{year},'District',0,{district},50,{M}),"
        f"({fields['total_contributions_target']},{year},'District',0,{district},20000,{M})")
    project_goal = one(f"SELECT COUNT(*) FROM district_project_target WHERE fk_district_id={district} AND fk_year_id={year}") == 0
    if project_goal:
        sql(f"INSERT INTO district_project_target (fk_district_id, fk_year_id, fk_module_id, target_count, created_by) "
            f"VALUES ({district},{year},{modules['community_service']},30,{M})")
    dues_id = int(sql(f"INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, created_by) VALUES "
                      f"({district},'{label}','E2E N10 dues',{M}); SELECT LAST_INSERT_ID();"))
    sql("INSERT INTO club_dues_members (fk_club_dues_id, fk_club_id, fk_member_profile_id, IsHonorary, Rate, IsPaid) VALUES "
        f"({dues_id},{club},{roster[0]},0,10,1),({dues_id},{club},{roster[1]},0,10,1),({dues_id},{club},{roster[2]},0,10,0),"
        f"({dues_id},{club},{ag},1,10,1),({dues_id},{other},{dg},0,10,0)")  # an honorary row does not count
    for n, (present, deleted) in enumerate([(roster[:2], 0), (roster[:1], 0), (roster[:1], 1)]):
        meeting = int(sql(f"INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, EventDateTime, isdeleted, created_by) "
                          f"VALUES ({club},{year},'E2E N10 meeting {n}','{day} 19:00:00',{deleted},{M}); SELECT LAST_INSERT_ID();"))
        sql("INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id) VALUES "
            + ",".join(f"({meeting},{p})" for p in present))
    sql("INSERT INTO trf_contributions (fk_club_id, fk_year_id, TrfDate, DonorName, AmountUSD, fk_fund_id, FundType, isdeleted) VALUES "
        f"({club},{year},'{day}','E2E N10 donor',250,{fund},'Annual',0),({club},{year},'{day}','E2E N10 donor',50,{fund},'Annual',0),"
        f"({club},{year},'{day}','E2E N10 donor deleted',999,{fund},'Annual',1)"
        + (f",({club},{prev_year},'{day}','E2E N10 donor last year',77,{fund},'Annual',0)" if prev_year else ""))
    if has_projects:
        cs, club_service = modules["community_service"], modules["club_service"]
        sql(f"INSERT INTO `{projects_table}` (fk_club_id, fk_module_id, fk_year_id, title, isdeleted) VALUES "
            f"({club},{cs},{year},'E2E N10 project',0),({club},{cs},{year},'E2E N10 project',0),"
            f"({club},{club_service},{year},'E2E N10 project club service',0),({club},{cs},{year},'E2E N10 project deleted',1)")
    sql(f"INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, is_active, isdeleted, created_by) "
        f"VALUES ({district},{ag},{club},{year},1,0,{M})")
    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, fk_district_id, IsActive, isdeleted, created_by) "
        f"VALUES ({dg},2,NULL,{district},1,0,{M})")

    # Expected figures for club A, from the database
    members = one(f"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm WHERE cm.fk_club_id={club} AND {active_member}")
    joined = one(f"SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members WHERE fk_club_id={club} "
                 f"AND IsHonoraryMember=0 AND JoinedDate BETWEEN '{start}' AND '{end}'")
    left = one(f"SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members WHERE fk_club_id={club} "
               f"AND IsHonoraryMember=0 AND TerminationDate BETWEEN '{start}' AND '{end}'")
    district_clubs = one(f"SELECT COUNT(*) FROM club_master WHERE fk_district_id={district} AND isdeleted=0 AND IsActive=1")
    growth_sum = one(f"SELECT COALESCE(SUM(t.target_net_growth),0) FROM club_growth_targets t JOIN club_master c ON "
                     f"c.pk_club_id=t.fk_club_id WHERE c.fk_district_id={district} AND c.isdeleted=0 AND c.IsActive=1 AND t.fk_year_id={year}")
    attendance_pct = min(100.0, round(100 * 3 / (2 * members), 1))
    expect = {
        "members": (members, None), "growth": (joined - left, 5), "newMembers": (joined, 4), "dues": (2, 3),
        "attendance": (attendance_pct, None), "meetings": (2, None), "projects": (2 if has_projects else 0, None),
        "foundation": (300, 1000),
    }

    # ── SuperAdmin: the whole district ─────────────────────────────────────────────────────────────────────────────
    s, b = call("GET", D, t["sa"])
    check("SuperAdmin reads the district dashboard", s == 200, (s, b))
    rows = {r["clubId"]: r for r in b["clubs"]} if s == 200 else {}
    check("whole district: every active club", s == 200 and b["wholeDistrict"] and len(rows) == district_clubs, (len(rows), district_clubs))
    check("year and share of the year passed", s == 200 and b["yearId"] == year and b["yearLabel"] == label
          and b["yearElapsedPercent"] == round(elapsed * 100), (b.get("yearElapsedPercent"), round(elapsed * 100)))
    a = rows.get(club, {"metrics": {}})
    for key, (actual, target) in expect.items():
        m = a["metrics"].get(key, {})
        ok = abs(float(m.get("actual", -1)) - actual) < 0.01 and (m.get("target") is None if target is None
                                                                   else abs(float(m.get("target") or -1) - target) < 0.01)
        check(f"club A {key}: actual {actual}, target {target}", ok, m)
        check(f"club A {key}: status {status(actual, target)}", m.get("status") == status(actual, target), m)
    check("club A percent of target (dues 2 of 3 = 67%, Foundation 300 of 1000 = 30%)",
          a["metrics"].get("dues", {}).get("percent") == 67 and a["metrics"].get("foundation", {}).get("percent") == 30, a["metrics"])
    check("club A status is its worst metric", a.get("status") == worst([status(*v) for v in expect.values()]), a.get("status"))
    ag_name = sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={ag}")
    check("club A shows its Assistant Governor", a.get("agMemberId") == ag and a.get("agName") == ag_name, (a.get("agMemberId"), a.get("agName")))
    check("AG group listed with one club", s == 200 and {"memberId": ag, "name": ag_name, "clubs": 1} in b["agGroups"], b.get("agGroups"))
    bm = rows.get(other, {"metrics": {}})["metrics"]
    check("club B dues: 0 of 1 on its roster", bm.get("dues", {}).get("actual") == 0 and bm.get("dues", {}).get("target") == 1, bm.get("dues"))
    tot = b.get("totals", {}) if s == 200 else {}
    check("totals: district new member goal (50) over the club targets", tot.get("newMembers", {}).get("target") == 50, tot.get("newMembers"))
    check("totals: district Foundation goal (20000)", tot.get("foundation", {}).get("target") == 20000, tot.get("foundation"))
    if project_goal:
        check("totals: district project target (30)", tot.get("projects", {}).get("target") == 30, tot.get("projects"))
    check("totals: dues roster of the district (2 of 4)", tot.get("dues", {}).get("actual") == 2 and tot.get("dues", {}).get("target") == 4, tot.get("dues"))
    check("totals: growth target is the sum of club targets", tot.get("growth", {}).get("target") == growth_sum, (tot.get("growth"), growth_sum))
    check("totals: members add up", tot.get("members", {}).get("actual") == sum(r["metrics"]["members"]["actual"] for r in b["clubs"]), tot.get("members"))

    s, b = call("GET", f"{D}?yearId={prev_year}", t["sa"]) if prev_year else (200, {"clubs": []})
    pm = {r["clubId"]: r for r in b.get("clubs", [])}.get(club, {"metrics": {}})["metrics"]
    check("last year: only last year's giving, no targets of this year", s == 200 and pm.get("foundation", {}).get("actual") == 77
          and pm.get("growth", {}).get("target") is None and b.get("yearElapsedPercent") == 100, (s, pm.get("foundation")))
    check("unknown year answers 404", call("GET", f"{D}?yearId=99999999", t["sa"])[0] == 404)
    check("unknown club answers 404", call("GET", "/api/clubs/999999999/targets", t["sa"])[0] == 404)

    # ── District admin, AG, club admin, member, outsider ──────────────────────────────────────────────────────────
    s, b = call("GET", D, t["dg"])
    check("district admin sees the whole district", s == 200 and b["wholeDistrict"] and len(b["clubs"]) == district_clubs, (s, b if s != 200 else len(b["clubs"])))
    check("district admin opens any club of the district", call("GET", f"/api/clubs/{other}/targets", t["dg"])[0] == 200)
    s, b = call("GET", D, t["ag"])
    check("AG sees only their group", s == 200 and not b["wholeDistrict"] and [r["clubId"] for r in b["clubs"]] == [club], (s, b))
    check("AG totals use club targets, not the district goals", s == 200 and b["totals"]["newMembers"]["target"] == 4
          and b["totals"]["projects"]["target"] is None, b.get("totals", {}).get("newMembers") if s == 200 else b)
    check("AG opens their club", call("GET", C, t["ag"])[0] == 200)
    check("AG cannot open a club outside the group (403)", call("GET", f"/api/clubs/{other}/targets", t["ag"])[0] == 403)
    admin_clubs = sorted(int(x) for x in sql(f"SELECT DISTINCT r.fk_club_id FROM member_roles r JOIN club_master c ON c.pk_club_id=r.fk_club_id "
                                             f"WHERE r.fk_member_master_profile_id={admin} AND r.fk_role_id=2 AND r.IsActive=1 "
                                             f"AND r.isdeleted=0 AND c.fk_district_id={district} AND c.isdeleted=0 AND c.IsActive=1").split())
    s, b = call("GET", D, t["admin"])
    check("club admin sees only their own club(s)", s == 200 and not b["wholeDistrict"] and sorted(r["clubId"] for r in b["clubs"]) == admin_clubs, (s, b))
    s, b = call("GET", C, t["admin"])
    check("club admin opens their club", s == 200 and [r["clubId"] for r in b["clubs"]] == [club], (s, b))
    check("club admin cannot open another club (403)", call("GET", f"/api/clubs/{other}/targets", t["admin"])[0] == 403)
    check("plain member cannot read the district targets (403)", call("GET", D, t["plain"])[0] == 403)
    check("plain member cannot read the club targets (403)", call("GET", C, t["plain"])[0] == 403)
    check("member of another district cannot read them (403)", call("GET", D, t["outsider"])[0] == 403)
    check("no token answers 401", call("GET", D)[0] == 401)

    # ── Timing: the district with the most clubs, with synthetic figures for every club ─────────────────────────────
    big, big_clubs = [int(x) for x in sql("SELECT fk_district_id, COUNT(*) n FROM club_master WHERE isdeleted=0 AND IsActive=1 "
                                          "GROUP BY fk_district_id ORDER BY n DESC LIMIT 1").split()]
    seq = lambda n: f"(WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k<{n - 1}) SELECT k FROM s)"
    in_big = f"c.fk_district_id={big} AND c.isdeleted=0 AND c.IsActive=1"
    sql(f"INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, EventDateTime, created_by) SELECT c.pk_club_id, {year}, "
        f"'E2E N10 load', DATE_ADD('{start}', INTERVAL n.k*7 DAY), {M} FROM club_master c JOIN {seq(20)} n WHERE {in_big}")
    sql(f"INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id) SELECT a.pk_attendance_id, n.k+1 "
        f"FROM club_attendance a JOIN {seq(25)} n WHERE a.EventName='E2E N10 load'")
    sql(f"INSERT INTO trf_contributions (fk_club_id, fk_year_id, TrfDate, DonorName, AmountUSD, fk_fund_id, FundType) "
        f"SELECT c.pk_club_id, {year}, '{day}', 'E2E N10 load', 100, {fund}, 'Annual' FROM club_master c JOIN {seq(10)} n WHERE {in_big}")
    sql(f"INSERT IGNORE INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by) "
        f"SELECT f.pk_field_id, {year}, 'Club', c.pk_club_id, 0, 10, {M} FROM club_master c JOIN goal_fields f "
        f"ON f.FieldKey IN ('new_members','club_annual_fund_ytd_target','club_polioplus_ytd_target') WHERE {in_big}")
    sql(f"INSERT IGNORE INTO club_growth_targets (fk_club_id, fk_year_id, target_net_growth, modified_by) "
        f"SELECT c.pk_club_id, {year}, 3, {M} FROM club_master c WHERE {in_big}")
    if has_projects:
        sql(f"INSERT INTO `{projects_table}` (fk_club_id, fk_module_id, fk_year_id, title) SELECT c.pk_club_id, "
            f"{modules['community_service']}, {year}, 'E2E N10 load' FROM club_master c JOIN {seq(5)} n WHERE {in_big}")
    load = one("SELECT COUNT(*) FROM club_attendance_members am JOIN club_attendance a ON a.pk_attendance_id=am.fk_attendance_id "
               "WHERE a.EventName='E2E N10 load'")
    times = []
    for _ in range(5):
        t0 = time.perf_counter()
        s, b = call("GET", f"/api/districts/{big}/targets", t["sa"])
        times.append((time.perf_counter() - t0) * 1000)
    median = statistics.median(times)
    print(f"INFO district {big}: {big_clubs} clubs, {load} attendance rows; response ms "
          f"min {min(times):.0f}, median {median:.0f}, max {max(times):.0f}")
    check(f"{big_clubs} clubs answer in under a second (median {median:.0f} ms)",
          s == 200 and len(b["clubs"]) == big_clubs and median < 1000, (s, median))
    check("load figures are counted per club", s == 200 and all(r["metrics"]["meetings"]["actual"] >= 20 for r in b["clubs"]), s)
finally:
    cleanup()
    if not was_on:
        set_feature(False)
    left_rows = sql(f"SELECT (SELECT COUNT(*) FROM club_attendance WHERE EventName LIKE 'E2E N10%') + "
                    f"(SELECT COUNT(*) FROM trf_contributions WHERE DonorName LIKE 'E2E N10%') + "
                    f"(SELECT COUNT(*) FROM goal_entries WHERE created_by={M}) + (SELECT COUNT(*) FROM member_roles WHERE created_by={M}) + "
                    f"(SELECT COUNT(*) FROM district_ag WHERE created_by={M}) + (SELECT COUNT(*) FROM club_dues WHERE created_by={M})")
    check("test rows removed", left_rows == "0", left_rows)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
