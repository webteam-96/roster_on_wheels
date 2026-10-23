"""Planning mode, elect access and cut-over (ROW build spec 3.1, N7: Services/PlanningService.cs, PlanningAccess.cs).

    python -I kb/tools/planning_mode_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). A district in
planning: its DGE invites a PE and an SE; all three edit next year's officers, committees and calendar while the
current year stays untouched; the launchpad shows progress; the cut-over flips the tenant live and queues next
year's officers for RI. Also: the feature switch, who may start / invite / appoint / revoke / cut over, a PE only
on their own club's next year, the RI-fed elect role, record ownership, dues collection off while planning, the
archived year after cut-over, the 60-day trial and its conversion.
Writes test rows to the given LOCAL database only and removes them at the end (the district's tenant rows, planning
roles, the member_roles rows the cut-over adds, next-year officers / events / committees / goal, the hooks' auto
groups, the queued RI rows, a test RI officer row, a test dues row, the email_log rows of the invitations, the
feature switch). audit_log rows stay (append-only by design); so do the next year's project tables, which the app
creates anyway. Never run it against production.
"""
import base64, hashlib, hmac, json, os, re, subprocess, sys, time, urllib.error, urllib.request
from datetime import date, datetime, timedelta

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
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


def call(method, path, tok=None, body=None):
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        payload, status = e.read(), e.code
    try:
        return status, json.loads(payload) if payload else {}
    except ValueError:
        return status, payload


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def msg(r):
    return r[1].get("message", "") if isinstance(r[1], dict) else str(r[1])


# ── People and places, picked by query ────────────────────────────────────────────────────────────────────────
current = one("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 AND isdeleted=0 LIMIT 1")
current_label = sql(f"SELECT YearLabel FROM rotary_year_master WHERE pk_year_id={current}")
current_start = sql(f"SELECT StartDate FROM rotary_year_master WHERE pk_year_id={current}")
nxt = one(f"SELECT pk_year_id FROM rotary_year_master WHERE isdeleted=0 AND StartDate > '{current_start}' ORDER BY StartDate LIMIT 1")
PLAIN = ("cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND m.isdeleted=0 AND IFNULL(m.EmailId,'')<>'' "
         "AND NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id=m.pk_member_master_profile_id "
         "AND x.fk_role_id<>1)")
# Club A: six plain members with an email (the elect people), in a district with no tenant row and another club (B),
# with no next-year officers yet.
club_a, district = [int(x) for x in sql(
    "SELECT c.pk_club_id, c.fk_district_id FROM club_master c WHERE IFNULL(c.isdeleted,0)=0 "
    "AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions t WHERE t.fk_district_id=c.fk_district_id) "
    "AND EXISTS (SELECT 1 FROM club_master b WHERE b.fk_district_id=c.fk_district_id AND b.pk_club_id<>c.pk_club_id "
    "AND IFNULL(b.isdeleted,0)=0) "
    f"AND NOT EXISTS (SELECT 1 FROM board_of_directors bd WHERE bd.fk_club_id=c.pk_club_id AND bd.fk_year_id={nxt or 0}) "
    f"AND NOT EXISTS (SELECT 1 FROM district_ag ag WHERE ag.fk_club_id=c.pk_club_id AND ag.fk_year_id IN ({current},{nxt or 0})) "
    "AND (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id="
    f"cm.fk_member_master_profile_id WHERE cm.fk_club_id=c.pk_club_id AND {PLAIN})>=6 ORDER BY c.pk_club_id LIMIT 1").split()]
club_b = one(f"SELECT pk_club_id FROM club_master WHERE fk_district_id={district} AND pk_club_id<>{club_a} "
             "AND IFNULL(isdeleted,0)=0 ORDER BY pk_club_id LIMIT 1")
club_b_type = sql(f"SELECT COALESCE(ClubType,'') FROM club_master WHERE pk_club_id={club_b}")
people = [int(x) for x in sql(
    "SELECT m.pk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
    f"ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id WHERE cm.fk_club_id={club_a} AND {PLAIN} "
    "ORDER BY 1 LIMIT 6").split()]
dge, ds, pe, se, ri_se, plain = people
admin_a = one(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={club_a} AND fk_role_id=2 "
              "AND IsActive=1 AND isdeleted=0 ORDER BY 1 LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
foreign_officer = one(f"SELECT b.pk_board_director_id FROM board_of_directors b JOIN club_master c ON c.pk_club_id=b.fk_club_id "
                      f"WHERE c.fk_district_id<>{district} AND b.isdeleted=0 ORDER BY 1 LIMIT 1")
des = dict(tuple(r.split("\t")[::-1]) for r in sql(
    "SELECT pk_designation_id, designation_name FROM designation_master WHERE isdeleted=0 "
    "AND designation_name IN ('Club President','Club Secretary','Club Treasurer')").splitlines())
assert None not in (current, nxt, club_b, sa, foreign_officer) and len(des) == 3, "test data missing"
p_label = sql(f"SELECT YearLabel FROM rotary_year_master WHERE pk_year_id={nxt}")
p_start = sql(f"SELECT StartDate FROM rotary_year_master WHERE pk_year_id={nxt}")
p_day = (date.fromisoformat(p_start) + timedelta(days=75)).isoformat()      # a day inside next year
o_day = (date.fromisoformat(current_start) + timedelta(days=200)).isoformat()  # a day inside the current year
print(f"district {district}, clubs {club_a}/{club_b}, years {current_label}->{p_label}, "
      f"dge {dge} ds {ds} pe {pe} se {se} ri_se {ri_se} plain {plain} admin {admin_a}")

t_sa, t_plain = token(sa, "SuperAdmin"), token(plain, "Member")
t_dge, t_ds, t_pe, t_se = token(dge, "Elect"), token(ds, "Elect"), token(pe, "Elect"), token(se, "Elect")
t_admin = token(admin_a, "Admin") if admin_a else None

TABLES = {"planning_roles": "pk_planning_role_id", "ri_outbound_queue": "pk_outbound_id", "member_roles": "pk_member_role_id",
          "board_of_directors": "pk_board_director_id", "upcoming_events": "pk_upcoming_event_id",
          "district_committee_group": "id", "district_committee_group_member": "id", "district_committee_member": "id",
          "sub_groups": "pk_sub_group_id", "sub_group_members": "pk_sub_group_member_id", "email_log": "pk_id",
          "membership_dues": "pk_membership_dues_id", "district_membership_goal": "pk_id"}
before = {t: one(f"SELECT COALESCE(MAX({pk}),0) FROM {t}") for t, pk in TABLES.items()}
flag_before = sql("SELECT enabled FROM platform_features WHERE feature_key='planning_mode'")


def untouched():
    """Current-year records of the district: officers, committees, club and district calendar."""
    in_o = (f"isdeleted=0 AND DATE(EventDate) BETWEEN (SELECT StartDate FROM rotary_year_master WHERE pk_year_id={current}) "
            f"AND (SELECT EndDate FROM rotary_year_master WHERE pk_year_id={current})")
    return (sql(f"SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id={club_a} AND fk_year_id={current} AND isdeleted=0"),
            sql(f"SELECT COUNT(*) FROM district_committee_group WHERE fk_district_id={district} AND fk_year_id={current} AND isdeleted=0"),
            sql(f"SELECT COUNT(*) FROM district_committee_member WHERE fk_district_id={district} AND fk_year_id={current} AND isdeleted=0"),
            sql(f"SELECT COUNT(*) FROM upcoming_events WHERE fk_club_id={club_a} AND {in_o}"),
            sql(f"SELECT COUNT(*) FROM upcoming_events WHERE fk_club_id=0 AND fk_district_id={district} AND {in_o}"))


current_before = untouched()
dues_id = None
tokens = {}

try:
    # ── Switch ────────────────────────────────────────────────────────────────────────────────────────────────
    call("PUT", "/api/features/planning_mode", t_sa, {"enabled": False})
    r = call("GET", "/api/planning/me", t_sa)
    check("switch off: planning routes answer 404", r[0] == 404, r)
    r = call("POST", f"/api/tenants/{district}/trial", t_sa)
    check("switch off: the trial route answers 404", r[0] == 404, r)
    r = call("PUT", "/api/features/planning_mode", t_plain, {"enabled": True})
    check("a member cannot switch features", r[0] == 403, r)
    r = call("PUT", "/api/features/planning_mode", t_sa, {"enabled": True})
    check("SuperAdmin switches planning mode on", r[0] in (200, 204), r)

    # ── An AG appointed for next year gets no club access before that year starts ─────────────────────────────
    sql(f"INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, created_by) VALUES ({district}, {plain}, {club_a}, {nxt}, 0)")
    r = call("PUT", f"/api/clubs/{club_a}/projects/{current}/999999", t_plain, {})
    check("a next-year AG cannot write the club yet", r[0] == 403, r)
    sql(f"UPDATE district_ag SET fk_year_id={current} WHERE fk_member_id={plain} AND fk_club_id={club_a} AND fk_year_id={nxt}")
    r = call("PUT", f"/api/clubs/{club_a}/projects/{current}/999999", t_plain, {})
    check("a current-year AG still writes the club", r[0] != 403, r)
    sql(f"DELETE FROM district_ag WHERE fk_member_id={plain} AND fk_club_id={club_a} AND created_by=0 AND fk_year_id={current}")

    # ── Start (SuperAdmin) ────────────────────────────────────────────────────────────────────────────────────
    r = call("POST", f"/api/planning/districts/{district}/start", t_sa, {"dgeMemberId": dge})
    check("planning needs a subscription first (404)", r[0] == 404, r)
    sub = {"editionCode": "district", "memberBand": "1-1500", "termStart": None, "termEnd": None, "state": "live",
           "region": None, "setupFeeWaived": False, "platformFeePct": None, "platformFeeFixed": None, "feeWaiverUntil": None}
    sql(f"UPDATE club_master SET ClubType='Rotaract Club' WHERE pk_club_id={club_b}")  # restored in finally
    r = call("PUT", f"/api/tenants/{district}", t_sa, sub)
    check("SuperAdmin saves the district subscription", r[0] == 200, r)
    editions = dict(tuple(x.split("\t")) for x in sql(
        f"SELECT fk_club_id, edition_code FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id>0").splitlines())
    check("the subscription provisions club_basic for every club and rotaract for a Rotaract club",
          len(editions) == one(f"SELECT COUNT(*) FROM club_master WHERE fk_district_id={district} AND isdeleted=0")
          and editions.get(str(club_a)) == "club_basic" and editions.get(str(club_b)) == "rotaract", editions)
    # Wave 1 planning (state set in Settings > Tenants, no planning year yet) keeps its route-year rule
    call("PUT", f"/api/tenants/{district}", t_sa, {**sub, "state": "planning"})
    r = call("PUT", f"/api/clubs/{club_a}/projects/{current}/999999", t_sa, {})
    check("Wave 1 planning still refuses a current-year route write (409)", r[0] == 409, r)
    r = call("PUT", f"/api/clubs/{club_a}/projects/{nxt}/999999", t_sa, {})
    check("Wave 1 planning still allows a next-year route write", r[0] != 409, r)
    call("PUT", f"/api/tenants/{district}", t_sa, sub)
    # an elect secretary RI already holds (next-year officer synced from RI)
    sql(f"INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, fk_designation_id, fk_year_id, SyncSource, created_by) "
        f"VALUES ({club_a}, {ri_se}, {des['Club Secretary']}, {nxt}, 'Auto', 0)")
    r = call("POST", f"/api/planning/districts/{district}/start", t_dge, {"dgeMemberId": dge})
    check("only a SuperAdmin starts planning", r[0] == 403, r)
    r = call("POST", f"/api/planning/districts/{district}/start", t_sa, {"dgeMemberId": dge})
    check("SuperAdmin starts planning with the DGE", r[0] == 200 and r[1].get("planningYearId") == nxt, r)
    check("the secretary-elect RI holds is provisioned", r[0] == 200 and r[1].get("electsFromRi") == 1, r)
    cut = (r[1].get("cutoverAt") or "")[:10] if r[0] == 200 else ""
    check("cut-over scheduled for 1 July in the brand zone",
          cut in (p_start, (date.fromisoformat(p_start) - timedelta(days=1)).isoformat()), (cut, p_start))
    check("the tenant is planning next year", sql(f"SELECT CONCAT(state,'/',planning_year_id) FROM tenant_subscriptions "
                                                  f"WHERE fk_district_id={district} AND fk_club_id=0") == f"planning/{nxt}")
    r = call("POST", f"/api/planning/districts/{district}/start", t_sa, {"dgeMemberId": dge})
    check("starting again while planning replaces the DGE", r[0] == 200 and one(
        f"SELECT COUNT(*) FROM planning_roles WHERE fk_district_id={district} AND role_code='DGE' AND live=1 AND status='active'") == 1, r)

    r = call("GET", "/api/planning/me", t_dge)
    check("the DGE sees an active DGE role", r[0] == 200 and any(x.get("role") == "DGE" and x.get("status") == "active" for x in r[1]), r)
    r = call("GET", f"/api/planning/state?clubId={club_a}", t_plain)
    check("the banner state: planning next year, current year read-only",
          r[0] == 200 and r[1].get("state") == "planning" and r[1].get("planningYearId") == nxt
          and r[1].get("readOnlyYearId") == current, r)
    r = call("GET", "/api/dashboard/resolve-landing", t_dge)
    check("an elect-only member lands on /planning", r[0] == 200 and r[1].get("route") == "/planning", r)

    r = call("GET", f"/api/planning/districts/{district}", t_dge)
    check("the DGE opens the district's planning (can manage)", r[0] == 200 and r[1].get("canManage") is True, r)
    ri_role = next((c.get("se") for c in r[1].get("clubs", []) if c.get("clubId") == club_a), None) if r[0] == 200 else None
    r = call("GET", f"/api/planning/districts/{district}", t_plain)
    check("a plain member cannot open it", r[0] == 403, r)

    # ── Invitations (DGE) ─────────────────────────────────────────────────────────────────────────────────────
    r = call("POST", f"/api/planning/districts/{district}/invites", t_plain, {"clubId": club_a, "role": "PE", "memberId": pe})
    check("a member cannot invite", r[0] == 403, r)
    r = call("POST", f"/api/planning/districts/{district}/invites", t_dge, {"clubId": club_a, "role": "SE", "memberId": se})
    check("an active (RI) secretary-elect blocks a second one (409)", r[0] == 409, r)
    r = call("DELETE", f"/api/planning/districts/{district}/roles/{(ri_role or {}).get('roleId', 0)}", t_dge)
    check("the DGE revokes the RI secretary-elect", r[0] == 200, r)
    r = call("POST", f"/api/planning/districts/{district}/invites", t_dge, {"clubId": club_a, "role": "XX", "memberId": pe})
    check("an unknown role is refused (400)", r[0] == 400, r)
    r = call("POST", f"/api/planning/districts/{district}/invites", t_dge, {"clubId": club_b, "role": "PE", "memberId": pe})
    check("an invitee must be a member of that club (400)", r[0] == 400, r)
    for who, role in ((pe, "PE"), (se, "SE")):
        r = call("POST", f"/api/planning/districts/{district}/invites", t_dge, {"clubId": club_a, "role": role, "memberId": who})
        check(f"the DGE invites the {role} by email", r[0] == 200 and r[1].get("roleId"), r)
        email = sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={who}")
        body = sql(f"SELECT body_html FROM email_log WHERE pk_id>{before['email_log']} AND recipient_email='{email}' "
                   "AND subject LIKE '%Plan %' ORDER BY pk_id DESC LIMIT 1")
        m = re.search(r"/planning/accept/([A-Za-z0-9_-]{20,})", body)
        check(f"the {role} invitation email carries an accept link", m is not None, body[:200])
        tokens[role] = m.group(1) if m else ""
    r = call("POST", "/api/planning/invites/accept", None, {"token": "not-a-real-token"})
    check("a wrong token is refused (404)", r[0] == 404, r)
    r = call("POST", f"/api/planning/districts/{district}/cutover", t_pe)
    check("an invited (not accepted) PE cannot run the cut-over", r[0] == 403, r)
    r = call("POST", f"/api/clubs/{club_a}/board-of-directors", t_pe,
             {"memberId": pe, "designationId": int(des["Club President"]), "yearId": nxt})
    check("an invited PE has no rights before accepting", r[0] == 403, r)
    for role in ("PE", "SE"):
        r = call("POST", "/api/planning/invites/accept", None, {"token": tokens[role]})
        check(f"the {role} accepts from the link", r[0] == 200 and r[1].get("status") == "active", r)
    r = call("POST", "/api/planning/invites/accept", None, {"token": tokens["PE"]})
    check("an accept link works once", r[0] == 404, r)

    # ── The team (DGE appoints) ───────────────────────────────────────────────────────────────────────────────
    r = call("POST", f"/api/planning/districts/{district}/appointments", t_pe, {"role": "DS", "memberId": ds})
    check("a PE cannot appoint the district team", r[0] == 403, r)
    r = call("POST", f"/api/planning/districts/{district}/appointments", t_dge, {"role": "DGE", "memberId": ds})
    check("only DS or DT can be appointed (400)", r[0] == 400, r)
    r = call("POST", f"/api/planning/districts/{district}/appointments", t_dge, {"role": "DS", "memberId": ds})
    check("the DGE appoints next year's district secretary", r[0] == 200, r)

    # ── Next year's officers, committees and calendar ─────────────────────────────────────────────────────────
    bod = f"/api/clubs/{club_a}/board-of-directors"
    r = call("POST", bod, t_pe, {"memberId": pe, "designationId": int(des["Club President"]), "yearId": nxt})
    check("the PE adds next year's president (officers)", r[0] == 200, r)
    officer_id = r[1].get("id") if r[0] == 200 else 0
    r = call("POST", bod, t_pe, {"memberId": pe, "designationId": int(des["Club Treasurer"]), "yearId": current})
    check("the PE cannot touch the current year", r[0] == 403, r)
    r = call("POST", f"/api/clubs/{club_b}/board-of-directors", t_pe,
             {"memberId": pe, "designationId": int(des["Club Treasurer"]), "yearId": nxt})
    check("the PE cannot touch another club's next year", r[0] == 403, r)
    r = call("PUT", f"{bod}/{foreign_officer}", t_pe, {"memberId": pe, "designationId": int(des["Club Treasurer"]), "yearId": nxt})
    check("the PE cannot reach another club's officer through their club", r[0] == 403, r)
    if t_admin:
        r = call("PUT", f"{bod}/{foreign_officer}", t_admin, {"memberId": pe, "designationId": int(des["Club Treasurer"]), "yearId": nxt})
        check("a club admin cannot edit another club's officer by id (404)", r[0] == 404, r)
        r = call("POST", bod, t_admin, {"memberId": plain, "designationId": int(des["Club Treasurer"]), "yearId": current})
        check("planning: the incumbent club admin cannot write the current year (409)", r[0] == 409, r)
    r = call("POST", bod, t_sa, {"memberId": plain, "designationId": int(des["Club Treasurer"]), "yearId": current})
    check("planning: nor can a SuperAdmin (409)", r[0] == 409, r)
    r = call("POST", bod, t_se, {"memberId": plain, "designationId": int(des["Club Treasurer"]), "yearId": nxt})
    check("the SE adds next year's treasurer (officers)", r[0] == 200, r)
    r = call("PUT", f"{bod}/{officer_id}", t_se, {"memberId": pe, "designationId": int(des["Club President"]), "yearId": nxt})
    check("the SE edits a next-year officer", r[0] == 200, r)
    r = call("PUT", f"{bod}/{officer_id}", t_se, {"memberId": pe, "designationId": int(des["Club President"]), "yearId": current})
    check("an officer cannot be moved into the current year", r[0] == 403, r)

    ev = f"/api/clubs/{club_a}/upcoming-events"
    event = {"title": "e2e next-year assembly", "eventDate": f"{p_day}T18:00:00", "publishDate": f"{p_day}T09:00:00",
             "expiryDate": f"{p_day}T23:00:00", "eventVenue": "Club hall", "isSendEmail": False}
    r = call("POST", ev, t_pe, event)
    check("the PE adds a next-year club event (calendar)", r[0] == 200, r)
    club_event = r[1].get("id") if r[0] == 200 else 0
    r = call("POST", ev, t_pe, {**event, "eventDate": f"{o_day}T18:00:00"})
    check("the PE cannot add a current-year club event", r[0] == 403, r)
    r = call("PUT", f"{ev}/{club_event}", t_se, {**event, "title": "e2e next-year assembly (moved)"})
    check("the SE edits the next-year club event", r[0] == 200, r)

    grp = f"/api/districts/{district}/committee/groups"
    r = call("POST", grp, t_dge, {"yearId": nxt, "groupName": "e2e Membership committee"})
    check("the DGE adds a next-year committee", r[0] == 200, r)
    group_id = r[1].get("id") if r[0] == 200 else 0
    r = call("POST", grp, t_dge, {"yearId": current, "groupName": "e2e current committee"})
    check("the DGE cannot add a current-year committee", r[0] == 403, r)
    r = call("POST", f"{grp}/{group_id}/members", t_dge,
             {"memberId": ds, "isMember": True, "name": "e2e chair", "districtDesignation": "Chair"})
    check("the DGE appoints the committee chair", r[0] == 200, r)
    r = call("POST", grp, t_pe, {"yearId": nxt, "groupName": "e2e by a PE"})
    check("a PE cannot write district committees", r[0] == 403, r)
    r = call("POST", bod, t_dge, {"memberId": dge, "designationId": int(des["Club Treasurer"]), "yearId": nxt})
    check("the DGE's district role does not reach a club's officers", r[0] == 403, r)
    r = call("POST", f"/api/districts/{district}/committee/members", t_ds,
             {"yearId": nxt, "memberId": ds, "isMember": True, "name": "e2e secretary", "districtDesignation": "District Secretary"})
    check("the district secretary-elect edits next year's district committee", r[0] == 200, r)

    dev = f"/api/districts/{district}/upcoming-events"
    for title in ("PETS e2e", "SETS e2e"):
        r = call("POST", dev, t_dge, {**event, "title": title})
        check(f"the DGE schedules {title.split()[0]} (district calendar)", r[0] == 200, r)
    district_event = r[1].get("id") if r[0] == 200 else 0
    r = call("POST", dev, t_dge, {**event, "title": "e2e current event", "eventDate": f"{o_day}T18:00:00"})
    check("the DGE cannot add a current-year district event", r[0] == 403, r)
    r = call("PUT", f"{dev}/{club_event}", t_dge, {**event, "title": "e2e club event through the district"})
    check("a district route cannot edit a club's event (record ownership)", r[0] == 403, r)
    r = call("PUT", f"{dev}/{district_event}", t_dge, {**event, "title": "SETS e2e (moved)"})
    check("the DGE edits a next-year district event", r[0] == 200, r)

    goal = "/api/district-admin-dashboard/membership-goal"
    r = call("POST", goal, t_dge, {"fkDistrictId": district, "fkYearId": nxt, "targetTotal": 40, "targetNewMembers": 8,
                                   "targetRetentionPercent": 90})
    check("the DGE sets next year's district goal", r[0] == 200, r)
    r = call("POST", goal, t_dge, {"fkDistrictId": district, "fkYearId": current, "targetTotal": 1, "targetNewMembers": 1,
                                   "targetRetentionPercent": 1})
    check("the DGE cannot set the current year's goal", r[0] == 403, r)

    # ── Dues collection off while planning ────────────────────────────────────────────────────────────────────
    sql(f"INSERT INTO membership_dues (fk_district_id, fk_club_id, RotaryYear) VALUES ({district}, {club_a}, '{current_label}')")
    dues_id = one(f"SELECT MAX(pk_membership_dues_id) FROM membership_dues WHERE fk_club_id={club_a}")
    r = call("POST", f"/api/public/membership-dues/{dues_id}/pay", None, {"fkMemberProfileId": pe, "feeType": 1})
    check("current-year dues cannot be collected while planning", r[0] == 400 and "collection is off" in msg(r), r)

    # ── Launchpad ─────────────────────────────────────────────────────────────────────────────────────────────
    r = call("GET", f"/api/planning/districts/{district}", t_dge)
    pad = {i.get("key"): i for i in r[1].get("launchpad", [])} if r[0] == 200 else {}
    check("launchpad: calendar published", pad.get("calendar", {}).get("done") is True, pad.get("calendar"))
    check("launchpad: PETS and SETS scheduled", pad.get("pets_sets", {}).get("done") is True, pad.get("pets_sets"))
    check("launchpad: goals set", pad.get("goals", {}).get("done") is True, pad.get("goals"))
    check("launchpad: team in progress (no treasurer, no AGs yet)", pad.get("team", {}).get("done") is False
          and "Secretary:" in pad.get("team", {}).get("detail", ""), pad.get("team"))
    check("launchpad: clubs invited counts club A", pad.get("clubs_invited", {}).get("detail", "").startswith("1 of "),
          pad.get("clubs_invited"))
    check("launchpad: RI authorisation is a stub", pad.get("clubs_ri", {}).get("stub") is True, pad.get("clubs_ri"))

    # ── Cut-over ──────────────────────────────────────────────────────────────────────────────────────────────
    for name, tok in (("PE", t_pe), ("SE", t_se), ("district secretary", t_ds), ("member", t_plain)) + (
            (("incumbent club admin", t_admin),) if t_admin else ()):
        r = call("POST", f"/api/planning/districts/{district}/cutover", tok)
        check(f"the {name} cannot run the cut-over", r[0] == 403, r)
    check("the current year is untouched by planning", untouched() == current_before, (untouched(), current_before))
    vendor_clubs = one(f"SELECT COUNT(*) FROM club_master WHERE fk_district_id={district} AND isdeleted=0 AND ROW_as_vendor_selected=1")
    r = call("POST", f"/api/planning/districts/{district}/cutover", t_dge)
    check("the DGE runs the cut-over", r[0] == 200 and r[1].get("state") == "live", r)
    check("four elect roles are activated", r[0] == 200 and r[1].get("rolesActivated") == 4, r)
    check("the tenant is live and the outgoing year archived",
          sql(f"SELECT CONCAT(state,'/',archived_year_id,'/',cutover_done_at IS NOT NULL) FROM tenant_subscriptions "
              f"WHERE fk_district_id={district} AND fk_club_id=0") == f"live/{current}/1")
    queued = sql(f"SELECT GROUP_CONCAT(ri_title ORDER BY ri_title) FROM ri_outbound_queue WHERE fk_district_id={district} "
                 f"AND kind='officer' AND fk_year_id={nxt}")
    check("next-year officers are in the outbound queue (RI titles)", queued == "President,Secretary,Treasurer", queued)
    check("primary vendor queued for every authorised club",
          one(f"SELECT COUNT(*) FROM ri_outbound_queue WHERE fk_district_id={district} AND kind='primary_vendor'") == vendor_clubs)
    check("one reconciliation queued",
          one(f"SELECT COUNT(*) FROM ri_outbound_queue WHERE fk_district_id={district} AND kind='reconciliation'") == 1)
    check("PE and SE are now club admins", one(f"SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM member_roles WHERE fk_role_id=2 "
                                               f"AND fk_club_id={club_a} AND IsActive=1 AND isdeleted=0 "
                                               f"AND fk_member_master_profile_id IN ({pe},{se})") == 2)
    check("DGE and district secretary are now district admins",
          one(f"SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM member_roles WHERE fk_role_id=2 AND fk_district_id={district} "
              f"AND IFNULL(fk_club_id,0)=0 AND IsActive=1 AND isdeleted=0 AND fk_member_master_profile_id IN ({dge},{ds})") == 2)
    r = call("POST", f"/api/planning/districts/{district}/cutover", t_sa)
    check("a second cut-over is refused (409)", r[0] == 409, r)
    r = call("POST", f"/api/planning/districts/{district}/start", t_sa, {"dgeMemberId": dge})
    check("the year just cut over cannot be planned again (409)", r[0] == 409, r)
    r = call("POST", bod, t_pe, {"memberId": plain, "designationId": int(des["Club Treasurer"]), "yearId": current})
    check("after cut-over the outgoing year is archived (409)", r[0] == 409 and "archived" in msg(r), r)
    r = call("PUT", f"{bod}/{officer_id}", t_pe, {"memberId": pe, "designationId": int(des["Club President"]), "yearId": nxt})
    check("the new president edits the new year as club admin", r[0] == 200, r)
    r = call("POST", f"/api/public/membership-dues/{dues_id}/pay", None, {"fkMemberProfileId": pe, "feeType": 1})
    check("dues collection is on again after cut-over", "collection is off" not in msg(r), r)
    r = call("GET", "/api/dashboard/resolve-landing", token(pe, "Admin"))
    check("the new president lands on the club dashboard", r[0] == 200 and r[1].get("route") == "/club-admin-dashboard", r)

    # ── 60-day trial ──────────────────────────────────────────────────────────────────────────────────────────
    officers_p = sql(f"SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id={club_a} AND fk_year_id={nxt} AND isdeleted=0")
    r = call("POST", f"/api/tenants/{district}/trial", t_dge)
    check("only a SuperAdmin starts a trial", r[0] == 403, r)
    r = call("POST", f"/api/tenants/{district}/trial", t_sa)
    check("SuperAdmin starts a 60-day trial", r[0] == 200 and (r[1].get("trialEnds") or "")[:10]
          == (date.today() + timedelta(days=60)).isoformat(), r)
    r = call("GET", f"/api/tenants/{district}", t_sa)
    check("the tenant shows the trial end", r[0] == 200 and (r[1].get("subscription") or {}).get("trialEnds"), r)
    r = call("POST", f"/api/tenants/{district}/convert-trial", t_sa)
    check("SuperAdmin converts the trial to paid", r[0] == 200 and r[1].get("trialEnds") is None, r)
    r = call("POST", f"/api/tenants/{district}/convert-trial", t_sa)
    check("converting twice is refused (409)", r[0] == 409, r)
    check("conversion keeps every record",
          sql(f"SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id={club_a} AND fk_year_id={nxt} AND isdeleted=0") == officers_p
          and sql(f"SELECT state FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0") == "live")

    n = one("SELECT COUNT(*) FROM audit_log WHERE entity_type='planning' AND created_date > NOW() - INTERVAL 30 MINUTE "
            f"AND entity_id={district}")
    check("planning actions are audited", (n or 0) >= 7, n)
finally:
    time.sleep(2)  # the officer hooks run in the background
    sql(f"UPDATE club_master SET ClubType={'NULL' if not club_b_type else repr(club_b_type)} WHERE pk_club_id={club_b}")
    call("PUT", "/api/features/planning_mode", t_sa, {"enabled": flag_before == "1"})
    if not flag_before:
        sql("DELETE FROM platform_features WHERE feature_key='planning_mode'")
    who = ",".join(map(str, people))
    sql(f"DELETE FROM district_ag WHERE fk_member_id={plain} AND fk_club_id={club_a} AND created_by=0")
    sql(f"DELETE FROM ri_outbound_queue WHERE fk_district_id={district} AND pk_outbound_id>{before['ri_outbound_queue']}")
    sql(f"DELETE FROM planning_roles WHERE fk_district_id={district}")
    sql(f"DELETE FROM member_roles WHERE pk_member_role_id>{before['member_roles']} AND fk_member_master_profile_id IN ({who})")
    sql(f"DELETE FROM board_of_directors WHERE pk_board_director_id>{before['board_of_directors']} AND fk_club_id IN ({club_a},{club_b})")
    sql(f"DELETE FROM upcoming_events WHERE pk_upcoming_event_id>{before['upcoming_events']} "
        f"AND (fk_club_id={club_a} OR (fk_club_id=0 AND fk_district_id={district}))")
    sql(f"DELETE FROM district_committee_group_member WHERE id>{before['district_committee_group_member']} AND fk_group_id IN "
        f"(SELECT id FROM district_committee_group WHERE fk_district_id={district})")
    sql(f"DELETE FROM district_committee_group WHERE id>{before['district_committee_group']} AND fk_district_id={district}")
    sql(f"DELETE FROM district_committee_member WHERE id>{before['district_committee_member']} AND fk_district_id={district}")
    sql(f"DELETE FROM sub_group_members WHERE pk_sub_group_member_id>{before['sub_group_members']} AND fk_sub_group_id IN "
        f"(SELECT pk_sub_group_id FROM sub_groups WHERE fk_club_id={club_a})")
    sql(f"DELETE FROM sub_groups WHERE pk_sub_group_id>{before['sub_groups']} AND fk_club_id={club_a}")
    sql(f"DELETE FROM district_membership_goal WHERE pk_id>{before['district_membership_goal']} AND fk_district_id={district}")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id>{before['membership_dues']} AND fk_club_id={club_a}")
    sql(f"DELETE FROM email_log WHERE pk_id>{before['email_log']} AND recipient_email IN "
        f"(SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id IN ({who}))")
    sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id={district}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
