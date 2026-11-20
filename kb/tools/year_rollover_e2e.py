"""Year-end rollover (gap agent, 2026-11-19): preview, apply, idempotent second apply, undo, for a club and a district.

    python -I kb/tools/year_rollover_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Optional:
ROW_E2E_ADMIN_ID (club admin, default 1068) and ROW_E2E_MEMBER_ID (ordinary member, default 999), same club.
Writes fixture rows to the given LOCAL database (a club committee, a district committee group, one board row, a
temporary district Admin role) plus whatever the rollover inserts, and hard-deletes all of them at the end.
audit_log rows stay (append-only by design). Never run it against production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
ADMIN = int(os.environ.get('ROW_E2E_ADMIN_ID', '1068'))
MEMBER = int(os.environ.get('ROW_E2E_MEMBER_ID', '999'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MARK = 'E2E Rollover'
fails = 0


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
    headers = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        payload, status = e.read(), e.code
    try:
        return status, json.loads(payload) if payload else None
    except ValueError:
        return status, payload


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


admin_tok, member_tok = token(ADMIN, "Admin"), token(MEMBER, "Member")
club = one(f"SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={ADMIN} AND fk_role_id=2 "
           "AND IsActive=1 AND isdeleted=0 AND fk_club_id>0 LIMIT 1")
district = one(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
other_club = one(f"SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND fk_district_id<>{district} LIMIT 1")
y_from = one("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1")
y_to = one(f"SELECT y2.pk_year_id FROM rotary_year_master y1 JOIN rotary_year_master y2 "
           f"ON y2.StartDate = DATE_ADD(y1.EndDate, INTERVAL 1 DAY) WHERE y1.pk_year_id={y_from}")
outsider = one(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE isdeleted=0 AND pk_member_master_profile_id "
               f"NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club} AND IsActive=1 AND isdeleted=0) LIMIT 1")
sgt = one("SELECT pk_designation_id FROM designation_master WHERE designation_name='Sergeant at Arms' AND isdeleted=0")
runs = []
temp_role = None

try:
    # ----- fixtures -----
    sg = one(f"INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, isdeleted) "
             f"VALUES ({club}, NULL, {y_from}, '{MARK} Committee', 0); SELECT LAST_INSERT_ID();")
    m_in = one(f"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, isdeleted) VALUES ({sg}, {MEMBER}, 0); SELECT LAST_INSERT_ID();")
    m_out = one(f"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, isdeleted) VALUES ({sg}, {outsider}, 0); SELECT LAST_INSERT_ID();")
    bod = one(f"INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, fk_designation_id, fk_year_id, SyncSource, isdeleted) "
              f"VALUES ({club}, {MEMBER}, {sgt}, {y_from}, 'Manual', 0); SELECT LAST_INSERT_ID();")
    dg = one(f"INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, sort_order, is_active, isdeleted) "
             f"VALUES ({district}, {y_from}, '{MARK} Group', 99, 1, 0); SELECT LAST_INSERT_ID();")
    dgm = one(f"INSERT INTO district_committee_group_member (fk_group_id, is_member, name, isdeleted) VALUES ({dg}, 0, '{MARK} Person A', 0); SELECT LAST_INSERT_ID();")
    dsg = one(f"INSERT INTO district_committee_sub_group (fk_group_id, sub_group_name, sort_order, is_active, isdeleted) VALUES ({dg}, '{MARK} Sub', 1, 1, 0); SELECT LAST_INSERT_ID();")
    dsm = one(f"INSERT INTO district_committee_sub_group_member (fk_sub_group_id, is_member, name, isdeleted) VALUES ({dsg}, 0, '{MARK} Person B', 0); SELECT LAST_INSERT_ID();")

    # ----- access -----
    s, _ = call("GET", f"/api/rollover/club/{club}", member_tok)
    check("ordinary member refused (club preview)", s == 403, s)
    s, _ = call("GET", f"/api/rollover/club/{other_club}", admin_tok)
    check("admin of another club refused", s == 403, s)
    s, _ = call("GET", f"/api/rollover/district/{district}", admin_tok)
    check("club admin refused for the district", s == 403, s)
    s, _ = call("GET", f"/api/rollover/team/{club}", admin_tok)
    check("unknown scope refused", s == 400, s)
    s, _ = call("GET", "/api/rollover/club/999999999", admin_tok)
    check("unknown club 404", s == 404, s)
    s, _ = call("GET", f"/api/rollover/club/{club}?fromYearId={y_to}", admin_tok)
    check("year with no next year set up is 409", s in (409, 403), s)
    s, _ = call("POST", f"/api/rollover/club/{club}/apply", member_tok, {"fromYearId": y_from, "committees": [{"sourceId": sg, "memberKeys": [f"m:{m_in}"]}]})
    check("ordinary member cannot apply", s == 403, s)

    # ----- club preview -----
    s, p = call("GET", f"/api/rollover/club/{club}", admin_tok)
    check("admin previews the club", s == 200 and p["fromYear"]["id"] == y_from and p["toYear"]["id"] == y_to, (s, p))
    com = next((c for c in p["committees"] if c["sourceId"] == sg), None)
    check("fixture committee listed as add", com is not None and com["action"] == "add", com)
    acts = {m["key"]: m["action"] for m in (com or {}).get("members", [])}
    check("active member add, non-member marked left", acts.get(f"m:{m_in}") == "add" and acts.get(f"m:{m_out}") == "left", acts)
    check("board mirror groups are not offered", not any(c["name"].startswith("Club President") for c in p["committees"]), [c["name"] for c in p["committees"]])
    off = next((o for o in p["officers"] if o["sourceId"] == bod), None)
    check("fixture officer listed as add", off is not None and off["action"] == "add", off)
    # Officer progression feeds the preview since the 2026-11-20 merge (OfficerProgressionRolloverSource).
    check("progression source connected", p["pendingProgression"]["connected"] is True and isinstance(p["pendingProgression"]["steps"], list), p["pendingProgression"])
    ipp_add = 1 if (p.get("ipp") or {}).get("action") == "add" else 0
    before_rows = one(f"SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id={club} AND fk_year_id={y_to} AND isdeleted=0")
    check("preview wrote nothing to the new year", one(f"SELECT COUNT(*) FROM sub_groups WHERE fk_club_id={club} AND fk_year_id={y_to} "
                                                       f"AND GroupName='{MARK} Committee'") == 0)

    # ----- club apply -----
    body = {"fromYearId": y_from, "includeIpp": True, "officerIds": [bod],
            "committees": [{"sourceId": sg, "memberKeys": [f"m:{m_in}", f"m:{m_out}"]}]}
    s, r = call("POST", f"/api/rollover/club/{club}/apply", admin_tok, body)
    check("club apply succeeds", s == 200 and r["runId"], (s, r))
    if s == 200 and r["runId"]:
        runs.append(r["runId"])
    check("apply made committee + 1 member + officer (+ IPP)", s == 200 and r["changed"] == 3 + ipp_add, r)
    new_sg = one(f"SELECT pk_sub_group_id FROM sub_groups WHERE fk_club_id={club} AND fk_year_id={y_to} AND GroupName='{MARK} Committee' AND isdeleted=0")
    check("committee exists in the new year", new_sg is not None)
    check("only the active member carried", new_sg and one(f"SELECT COUNT(*) FROM sub_group_members WHERE fk_sub_group_id={new_sg} AND isdeleted=0") == 1)
    check("officer in place for the new year", one(f"SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id={club} AND fk_year_id={y_to} "
                                                   f"AND fk_member_master_profile_id={MEMBER} AND fk_designation_id={sgt} AND isdeleted=0") == 1)
    check("board rows grew by officer + IPP", one(f"SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id={club} AND fk_year_id={y_to} AND isdeleted=0") == before_rows + 1 + ipp_add)
    check("snapshot items recorded", r.get("runId") and one(f"SELECT COUNT(*) FROM year_rollover_item WHERE fk_run_id={r['runId']}") == r["changed"])

    s, r2 = call("POST", f"/api/rollover/club/{club}/apply", admin_tok, body)
    check("second apply changes nothing (idempotent)", s == 200 and r2["changed"] == 0 and r2["runId"] is None, (s, r2))
    s, p2 = call("GET", f"/api/rollover/club/{club}", admin_tok)
    com2 = next((c for c in p2["committees"] if c["sourceId"] == sg), {})
    check("preview now shows committee and officer as already there",
          com2.get("action") == "exists" and next(o for o in p2["officers"] if o["sourceId"] == bod)["action"] == "exists", com2)
    check("history lists the run", any(x["runId"] == runs[0] and x["status"] == "applied" for x in p2["runs"]) if runs else False)

    # ----- undo never deletes what an admin added after the run -----
    later = one(f"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, isdeleted) VALUES ({new_sg}, {ADMIN}, 0); SELECT LAST_INSERT_ID();")
    s, b = call("POST", f"/api/rollover/runs/{runs[0]}/undo", admin_tok)
    check("undo refused (409) while a later member hangs off the run's committee",
          s == 409 and any("added after the rollover" in x for x in (b or {}).get("blockers", [])), (s, b))
    check("the later member is untouched", one(f"SELECT COUNT(*) FROM sub_group_members WHERE pk_sub_group_member_id={later} AND isdeleted=0") == 1)
    check("the run is still applied", sql(f"SELECT status FROM year_rollover_run WHERE pk_run_id={runs[0]}") == "applied")
    sql(f"DELETE FROM sub_group_members WHERE pk_sub_group_member_id={later}")  # the admin removes it, then undo works

    # ----- club undo -----
    s, _ = call("POST", f"/api/rollover/runs/{runs[0]}/undo", member_tok)
    check("ordinary member cannot undo", s == 403, s)
    s, u = call("POST", f"/api/rollover/runs/{runs[0]}/undo", admin_tok)
    check("undo succeeds and removes every inserted row", s == 200 and u["removed"] == 3 + ipp_add, (s, u))
    check("committee gone from the new year", one(f"SELECT COUNT(*) FROM sub_groups WHERE pk_sub_group_id={new_sg} AND isdeleted=0") == 0)
    check("board back to its size", one(f"SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id={club} AND fk_year_id={y_to} AND isdeleted=0") == before_rows)
    s, _ = call("POST", f"/api/rollover/runs/{runs[0]}/undo", admin_tok)
    check("second undo refused (409)", s == 409, s)
    s, _ = call("POST", "/api/rollover/runs/999999999/undo", admin_tok)
    check("unknown run 404", s == 404, s)

    # ----- district -----
    temp_role = one(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, fk_club_id, AllClubsAccess, IsActive, isdeleted, created_date) "
                    f"VALUES ({ADMIN}, 2, {district}, NULL, 0, 1, 0, NOW()); SELECT LAST_INSERT_ID();")
    s, d = call("GET", f"/api/rollover/district/{district}", admin_tok)
    check("district admin previews the district", s == 200, (s, d))
    grp = next((c for c in (d or {}).get("committees", []) if c["sourceId"] == dg), None)
    check("district group listed with group and sub-group members",
          grp is not None and {m["key"] for m in grp["members"]} == {f"g:{dgm}", f"s:{dsm}"} and grp["subGroups"] == [f"{MARK} Sub"], grp)
    dbody = {"fromYearId": y_from, "committees": [{"sourceId": dg, "memberKeys": [f"g:{dgm}", f"s:{dsm}"]}]}
    s, r = call("POST", f"/api/rollover/district/{district}/apply", member_tok, dbody)
    check("ordinary member cannot apply to the district", s == 403, s)
    s, r = call("POST", f"/api/rollover/district/{district}/apply", admin_tok, dbody)
    if s == 200 and r["runId"]:
        runs.append(r["runId"])
    check("district apply: group, sub-group, 2 members", s == 200 and r["changed"] == 4, (s, r))
    ng = one(f"SELECT id FROM district_committee_group WHERE fk_district_id={district} AND fk_year_id={y_to} AND group_name='{MARK} Group' AND isdeleted=0")
    check("group copied with its member", ng and one(f"SELECT COUNT(*) FROM district_committee_group_member WHERE fk_group_id={ng} AND isdeleted=0") == 1)
    check("sub-group copied with its member", ng and one(f"SELECT COUNT(*) FROM district_committee_sub_group sg JOIN district_committee_sub_group_member m "
                                                         f"ON m.fk_sub_group_id=sg.id AND m.isdeleted=0 WHERE sg.fk_group_id={ng} AND sg.isdeleted=0") == 1)
    s, r2 = call("POST", f"/api/rollover/district/{district}/apply", admin_tok, dbody)
    check("district second apply changes nothing", s == 200 and r2["changed"] == 0, (s, r2))
    s, u = call("POST", f"/api/rollover/runs/{runs[-1]}/undo", admin_tok)
    check("district undo removes all 4 rows", s == 200 and u["removed"] == 4, (s, u))
    check("district group gone from the new year", one(f"SELECT COUNT(*) FROM district_committee_group WHERE id={ng} AND isdeleted=0") == 0)
finally:
    # ----- cleanup: rollover output, runs, fixtures, temp role -----
    if runs:
        ids = ",".join(map(str, runs))
        pks = {"sub_groups": "pk_sub_group_id", "sub_group_members": "pk_sub_group_member_id", "board_of_directors": "pk_board_director_id"}
        # newest first: children (members) before their committee
        for t, tid in [tuple(x.split("\t")) for x in sql(f"SELECT target_table, target_id FROM year_rollover_item WHERE fk_run_id IN ({ids}) "
                                                         "ORDER BY pk_item_id DESC").splitlines() if x]:
            if t == "sub_groups":
                sql(f"DELETE FROM sub_group_members WHERE fk_sub_group_id={int(tid)}")
            sql(f"DELETE FROM {t} WHERE {pks.get(t, 'id')}={int(tid)}")
        sql(f"DELETE FROM year_rollover_item WHERE fk_run_id IN ({ids}); DELETE FROM year_rollover_run WHERE pk_run_id IN ({ids})")
    sql(f"DELETE FROM sub_group_members WHERE fk_sub_group_id IN (SELECT pk_sub_group_id FROM (SELECT pk_sub_group_id FROM sub_groups WHERE GroupName='{MARK} Committee') x)")
    sql(f"DELETE FROM sub_groups WHERE GroupName='{MARK} Committee'")
    sql(f"DELETE FROM board_of_directors WHERE fk_club_id={club} AND fk_member_master_profile_id={MEMBER} AND fk_designation_id={sgt} AND fk_year_id IN ({y_from},{y_to})")
    sql(f"DELETE m FROM district_committee_sub_group_member m JOIN district_committee_sub_group s ON s.id=m.fk_sub_group_id "
        f"JOIN district_committee_group g ON g.id=s.fk_group_id WHERE g.group_name='{MARK} Group'")
    sql(f"DELETE s FROM district_committee_sub_group s JOIN district_committee_group g ON g.id=s.fk_group_id WHERE g.group_name='{MARK} Group'")
    sql(f"DELETE m FROM district_committee_group_member m JOIN district_committee_group g ON g.id=m.fk_group_id WHERE g.group_name='{MARK} Group'")
    sql(f"DELETE FROM district_committee_group WHERE group_name='{MARK} Group'")
    if temp_role:
        sql(f"DELETE FROM member_roles WHERE pk_member_role_id={temp_role}")
    left = one(f"SELECT (SELECT COUNT(*) FROM sub_groups WHERE GroupName LIKE '{MARK}%') + (SELECT COUNT(*) FROM district_committee_group WHERE group_name LIKE '{MARK}%')")
    check("cleanup left no test rows", left == 0, left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
