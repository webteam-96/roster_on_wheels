"""Officer progression (gap 10): a club names its President-Nominee and PN, PE, P, IPP are suggested for the
following years (district: DGN, DGE, DG, IPDG). Steps are suggestions; confirming writes the board / governors row,
never over someone already in the office.

    python -I kb/tools/officer_progression_e2e.py <api_base> <mysql_port> <database>

Environment: ROW_E2E_JWT_SECRET = the API's JwtSettings__Secret (tokens are minted here, no passwords used).
Local copies only. Sends no email. Every row it creates (chains, board rows, governor rows) is removed at the end.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time
import urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, MEMBER = 341, 1068, 999
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, body=None, tok=None):
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    data = None
    if body is not None:
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
        return status, {"raw": raw[:200].decode(errors="replace")}


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
    if not ok:
        fails += 1


def chain(tok, scope, scope_id, pid):
    s, rows = call("GET", f"/api/officer-progression?scope={scope}&scopeId={scope_id}", tok=tok)
    return next((r for r in rows if r["progressionId"] == pid), None) if s == 200 else None


def step(c, role):
    return next(x for x in c["steps"] if x["role"] == role)


SA_ID = int(sql("""SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id = mr.fk_role_id
                   WHERE r.RoleName = 'SuperAdmin' AND mr.IsActive = 1 AND mr.isdeleted = 0 LIMIT 1"""))
DISTRICT = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {CLUB}"))
cur_start = int(sql("SELECT YEAR(StartDate) FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1"))
label = lambda y: f"{y}-{(y + 1) % 100:02d}"
# Nominee named last year: PN last year, PE this year, P next year, IPP the year after.
NOM_YEAR = cur_start - 1
P_YEAR_ID = sql(f"SELECT pk_year_id FROM rotary_year_master WHERE YearLabel = '{label(NOM_YEAR + 2)}' AND isdeleted = 0")
IPP_YEAR_EXISTS = sql(f"SELECT COUNT(*) FROM rotary_year_master WHERE YearLabel = '{label(NOM_YEAR + 3)}' AND isdeleted = 0") != "0"
CUR_YEAR_ID = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1")
free = sql(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm
               JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
               WHERE cm.fk_club_id = {CLUB} AND cm.IsActive = 1 AND cm.isdeleted = 0
                 AND cm.fk_member_master_profile_id NOT IN ({ADMIN}, {MEMBER})
                 AND NOT EXISTS (SELECT 1 FROM board_of_directors b WHERE b.fk_club_id = {CLUB} AND b.isdeleted = 0
                                 AND b.fk_member_master_profile_id = cm.fk_member_master_profile_id AND b.fk_year_id IN ({P_YEAR_ID or 0}, {CUR_YEAR_ID}))
               ORDER BY cm.fk_member_master_profile_id LIMIT 2""").split()
NOMINEE, OTHER = int(free[0]), int(free[1])
OUTSIDER = int(sql(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                       WHERE c.fk_district_id <> {DISTRICT} AND cm.IsActive = 1 AND cm.isdeleted = 0
                         AND NOT EXISTS (SELECT 1 FROM member_roles mr WHERE mr.fk_member_master_profile_id = cm.fk_member_master_profile_id
                                         AND mr.fk_role_id <> 3 AND mr.isdeleted = 0)
                         AND NOT EXISTS (SELECT 1 FROM club_members x JOIN club_master xc ON xc.pk_club_id = x.fk_club_id
                                         WHERE x.fk_member_master_profile_id = cm.fk_member_master_profile_id AND xc.fk_district_id = {DISTRICT})
                       LIMIT 1"""))
start_prog = int(sql("SELECT COALESCE(MAX(pk_progression_id), 0) FROM officer_progression"))
start_bod = int(sql("SELECT COALESCE(MAX(pk_board_director_id), 0) FROM board_of_directors"))
start_gov = int(sql("SELECT COALESCE(MAX(pk_id), 0) FROM district_governors"))
# Confirming a President goes through the board path, whose hooks add district / sub-group rows; undone at the end.
start_sg = int(sql("SELECT COALESCE(MAX(pk_sub_group_id), 0) FROM sub_groups"))
start_sgm = int(sql("SELECT COALESCE(MAX(pk_sub_group_member_id), 0) FROM sub_group_members"))
start_dcg = int(sql("SELECT COALESCE(MAX(id), 0) FROM district_committee_group"))
start_dcm = int(sql("SELECT COALESCE(MAX(id), 0) FROM district_committee_group_member"))

admin, member, sa, outsider = token(ADMIN, ["Admin"]), token(MEMBER, ["Member"]), token(SA_ID, ["SuperAdmin"]), token(OUTSIDER, ["Member"])
print(f"club {CLUB} district {DISTRICT} nominee {NOMINEE} nominee year {label(NOM_YEAR)} superadmin {SA_ID} outsider {OUTSIDER}")

try:
    # --- access ---------------------------------------------------------------------------------
    s, _ = call("GET", f"/api/officer-progression?scope=club&scopeId={CLUB}")
    check("no token is 401", s == 401, s)
    s, _ = call("GET", f"/api/officer-progression?scope=club&scopeId={CLUB}", tok=outsider)
    check("member of another district cannot view the club's chain", s == 403, s)
    s, _ = call("GET", f"/api/officer-progression?scope=club&scopeId={CLUB}", tok=member)
    check("ordinary member of the club can view", s == 200, s)
    s, _ = call("GET", "/api/officer-progression?scope=zone&scopeId=1", tok=admin)
    check("bad scope is 400", s == 400, s)
    s, _ = call("POST", "/api/officer-progression", {"scope": "club", "scopeId": CLUB, "memberId": NOMINEE, "nomineeStartYear": NOM_YEAR}, member)
    check("ordinary member cannot name a nominee", s == 403, s)
    s, _ = call("GET", f"/api/officer-progression/candidates?scope=club&scopeId={CLUB}", tok=member)
    check("ordinary member cannot list candidates", s == 403, s)

    # --- naming the nominee -------------------------------------------------------------------
    s, cands = call("GET", f"/api/officer-progression/candidates?scope=club&scopeId={CLUB}", tok=admin)
    check("club admin lists candidates", s == 200 and isinstance(cands, list) and len(cands) > 0, (s, cands))
    s, b = call("POST", "/api/officer-progression", {"scope": "club", "scopeId": CLUB, "memberId": OUTSIDER, "nomineeStartYear": NOM_YEAR}, admin)
    check("nominee from another club is 400", s == 400, (s, b))
    s, b = call("POST", "/api/officer-progression", {"scope": "club", "scopeId": CLUB, "memberId": NOMINEE, "nomineeStartYear": cur_start - 5}, admin)
    check("nominee year far in the past is 400", s == 400, (s, b))
    s, b = call("POST", "/api/officer-progression", {"scope": "club", "scopeId": CLUB, "memberId": NOMINEE, "nomineeStartYear": NOM_YEAR}, admin)
    check("club admin names the President-Nominee", s == 200 and b.get("id", 0) > 0, (s, b))
    pid = b.get("id", 0)
    s, b = call("POST", "/api/officer-progression", {"scope": "club", "scopeId": CLUB, "memberId": OTHER, "nomineeStartYear": NOM_YEAR}, admin)
    check("second nominee for the same year is 409", s == 409, (s, b))

    c = chain(member, "club", CLUB, pid)
    check("chain has PN, PE, P, IPP all pending",
          c is not None and [x["role"] for x in c["steps"]] == ["PN", "PE", "P", "IPP"] and all(x["status"] == "pending" for x in c["steps"]), c)
    check("years follow on", c and [x["yearLabel"] for x in c["steps"]] == [label(NOM_YEAR + i) for i in range(4)], c)
    # Scoped to the test members: other agents may write board rows for this club at the same time.
    bods_before = sql(f"SELECT COUNT(*) FROM board_of_directors WHERE pk_board_director_id > {start_bod} AND fk_member_master_profile_id IN ({NOMINEE}, {OTHER})")
    check("naming wrote nothing to the board (suggestions only)", bods_before == "0", bods_before)

    # --- confirming ---------------------------------------------------------------------------
    pe, p, ipp, pn = step(c, "PE"), step(c, "P"), step(c, "IPP"), step(c, "PN")
    s, _ = call("POST", f"/api/officer-progression/steps/{pe['stepId']}/confirm", tok=member)
    check("ordinary member cannot confirm", s == 403, s)
    s, b = call("POST", f"/api/officer-progression/steps/{pe['stepId']}/confirm", tok=admin)
    check("club admin confirms President-Elect (current year)", s == 200, (s, b))
    if not IPP_YEAR_EXISTS:
        s, b = call("POST", f"/api/officer-progression/steps/{ipp['stepId']}/confirm", tok=sa)
        check("IPP in a year not open yet is 409 and stays pending",
              s == 409 and "not open" in b.get("message", "") and step(chain(sa, "club", CLUB, pid), "IPP")["status"] == "pending", (s, b))
    if P_YEAR_ID:
        s, b = call("POST", f"/api/officer-progression/steps/{p['stepId']}/confirm", tok=sa)
        check("confirming President writes the board row", s == 200, (s, b))
        row = sql(f"""SELECT b.fk_member_master_profile_id FROM board_of_directors b JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                      WHERE b.fk_club_id = {CLUB} AND b.fk_year_id = {P_YEAR_ID} AND b.isdeleted = 0 AND d.designation_name = 'Club President'""")
        check("Club President of that year is the nominee", row == str(NOMINEE), row)
        c = chain(member, "club", CLUB, pid)
        check("step shows confirmed and the nominee as holder",
              step(c, "P")["status"] == "confirmed" and step(c, "P")["currentHolderIsNominee"] and step(c, "PE")["status"] == "confirmed", c)
        s, _ = call("POST", f"/api/officer-progression/steps/{p['stepId']}/confirm", tok=sa)
        check("confirming twice is 409", s == 409, s)
    s, b = call("POST", f"/api/officer-progression/steps/{pn['stepId']}/dismiss", tok=admin)
    check("club admin dismisses a suggestion", s == 200, (s, b))
    s, _ = call("POST", f"/api/officer-progression/steps/{pn['stepId']}/dismiss", tok=admin)
    check("dismissing twice is 409", s == 409, s)

    # --- never overwrite: a chain whose President year already has a president ----------------------
    clash_year = cur_start - 2  # P = this year, which club 341 already has
    holder = sql(f"""SELECT COUNT(*) FROM board_of_directors b JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                     WHERE b.fk_club_id = {CLUB} AND b.fk_year_id = {CUR_YEAR_ID} AND b.isdeleted = 0 AND d.designation_name = 'Club President'""")
    if holder != "0":
        s, b = call("POST", "/api/officer-progression", {"scope": "club", "scopeId": CLUB, "memberId": OTHER, "nomineeStartYear": clash_year}, sa)
        check("SuperAdmin names an earlier nominee", s == 200, (s, b))
        pid2 = b.get("id", 0)
        c2 = chain(sa, "club", CLUB, pid2)
        p2 = step(c2, "P")
        check("clash is visible before confirming", p2["currentHolderName"] and not p2["currentHolderIsNominee"], p2)
        s, b = call("POST", f"/api/officer-progression/steps/{p2['stepId']}/confirm", tok=sa)
        check("confirming over a sitting President is 409", s == 409 and "already holds" in b.get("message", ""), (s, b))
        check("sitting President untouched, step still pending",
              step(chain(sa, "club", CLUB, pid2), "P")["status"] == "pending"
              and sql(f"SELECT COUNT(*) FROM board_of_directors WHERE pk_board_director_id > {start_bod} AND fk_year_id = {CUR_YEAR_ID} AND fk_member_master_profile_id = {OTHER}") == "0", "")
        s, _ = call("DELETE", f"/api/officer-progression/{pid2}", tok=admin)
        check("club admin removes a chain", s == 200, s)
        s, rows = call("GET", f"/api/officer-progression?scope=club&scopeId={CLUB}", tok=admin)
        check("removed chain is gone from the list", s == 200 and all(r["progressionId"] != pid2 for r in rows), rows)

    # --- district chain: DG writes district_governors ----------------------------------------------
    s, b = call("POST", "/api/officer-progression", {"scope": "district", "scopeId": DISTRICT, "memberId": NOMINEE, "nomineeStartYear": NOM_YEAR}, member)
    check("ordinary member cannot name a district nominee", s == 403, (s, b))
    s, b = call("POST", "/api/officer-progression", {"scope": "district", "scopeId": DISTRICT, "memberId": NOMINEE, "nomineeStartYear": NOM_YEAR}, sa)
    check("SuperAdmin names a DG-Nominee", s == 200, (s, b))
    did = b.get("id", 0)
    dc = chain(member, "district", DISTRICT, did)
    check("district chain is DGN, DGE, DG, IPDG", dc and [x["role"] for x in dc["steps"]] == ["DGN", "DGE", "DG", "IPDG"], dc)
    if P_YEAR_ID:
        dg = step(dc, "DG")
        had = sql(f"SELECT COUNT(*) FROM district_governors WHERE fk_district_id = {DISTRICT} AND fk_year_id = {P_YEAR_ID} AND COALESCE(isdeleted,0) = 0")
        s, b = call("POST", f"/api/officer-progression/steps/{dg['stepId']}/confirm", tok=sa)
        if had == "0":
            check("confirming DG adds the governor", s == 200 and sql(
                f"SELECT fk_member_id FROM district_governors WHERE pk_id > {start_gov} AND fk_district_id = {DISTRICT} AND fk_year_id = {P_YEAR_ID}") == str(NOMINEE), (s, b))
        else:
            check("confirming DG over a sitting governor is 409", s == 409, (s, b))

    # --- rollover hook ----------------------------------------------------------------------------
    if P_YEAR_ID:
        s, rows = call("GET", f"/api/officer-progression/pending?yearId={P_YEAR_ID}", tok=sa)
        check("rollover hook lists pending steps of a year (SuperAdmin)", s == 200 and isinstance(rows, list), (s, rows))
        s, _ = call("GET", f"/api/officer-progression/pending?yearId={P_YEAR_ID}", tok=admin)
        check("rollover list is SuperAdmin only", s == 403, s)
    s, rows = call("GET", f"/api/officer-progression/pending?yearId={CUR_YEAR_ID}", tok=sa)
    check("pending for this year includes the district DGE step",
          s == 200 and any(r["stepId"] == step(dc, "DGE")["stepId"] for r in rows), rows if s != 200 else len(rows))
finally:
    pids = sql(f"SELECT GROUP_CONCAT(pk_progression_id) FROM officer_progression WHERE pk_progression_id > {start_prog}")
    if pids and pids != "NULL":
        sql(f"DELETE FROM officer_progression_step WHERE fk_progression_id IN ({pids})")
        sql(f"DELETE FROM officer_progression WHERE pk_progression_id IN ({pids})")
    sql(f"DELETE FROM board_of_directors WHERE pk_board_director_id > {start_bod} AND fk_club_id = {CLUB} AND fk_member_master_profile_id IN ({NOMINEE}, {OTHER})")
    sql(f"DELETE FROM district_governors WHERE pk_id > {start_gov} AND fk_member_id IN ({NOMINEE}, {OTHER})")
    time.sleep(3)  # the sub-group hook runs in the background after the board write
    if P_YEAR_ID:
        sql(f"""DELETE FROM sub_group_members WHERE pk_sub_group_member_id > {start_sgm} AND (fk_member_master_profile_id IN ({NOMINEE}, {OTHER})
                OR fk_sub_group_id IN (SELECT pk_sub_group_id FROM (SELECT pk_sub_group_id FROM sub_groups WHERE pk_sub_group_id > {start_sg} AND fk_year_id = {P_YEAR_ID}) t))""")
        sql(f"DELETE FROM sub_groups WHERE pk_sub_group_id > {start_sg} AND fk_year_id = {P_YEAR_ID}")
        sql(f"DELETE FROM district_committee_group_member WHERE id > {start_dcm} AND fk_member_id IN ({NOMINEE}, {OTHER})")
        sql(f"DELETE FROM district_committee_group WHERE id > {start_dcg} AND fk_year_id = {P_YEAR_ID} AND NOT EXISTS (SELECT 1 FROM (SELECT fk_group_id FROM district_committee_group_member) m WHERE m.fk_group_id = district_committee_group.id)")
    left = sql(f"SELECT (SELECT COUNT(*) FROM officer_progression WHERE pk_progression_id > {start_prog})"
               f" + (SELECT COUNT(*) FROM board_of_directors WHERE pk_board_director_id > {start_bod} AND fk_member_master_profile_id IN ({NOMINEE}, {OTHER}))"
               f" + (SELECT COUNT(*) FROM district_governors WHERE pk_id > {start_gov} AND fk_member_id IN ({NOMINEE}, {OTHER}))"
               f" + (SELECT COUNT(*) FROM sub_group_members WHERE pk_sub_group_member_id > {start_sgm} AND fk_member_master_profile_id IN ({NOMINEE}, {OTHER}))"
               f" + (SELECT COUNT(*) FROM district_committee_group_member WHERE id > {start_dcm} AND fk_member_id IN ({NOMINEE}, {OTHER}))")
    check("test rows cleaned up", left == "0", left)

print(f"\n{'ALL PASSED' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
