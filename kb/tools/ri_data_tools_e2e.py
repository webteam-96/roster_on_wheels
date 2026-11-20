"""RI data tools (2026-11-20): officer compare and transfer-in wizard, api/clubs/{id}/ri-tools/*.

    python -I kb/tools/ri_data_tools_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Club admin
ROW_E2E_ADMIN_ID (default 1068, club 341) and ordinary member ROW_E2E_MEMBER_ID (default 999).
NEVER calls Rotary.org: the fake RI source is fixture rows written straight into the tables the server sync fills
(ri_club_officers, ri_club_officer_sync, rotary_org_club_members_cache). LOCAL copies only. Every fixture row, the
member it creates, the member it links and the club row it adds are removed at the end; audit_log rows stay
(append-only by design).
"""
import base64, hashlib, hmac, json, os, sys, time, urllib.error, urllib.request

import pymysql

API, PORT, DB = sys.argv[1].rstrip('/'), int(sys.argv[2]), sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
ADMIN = int(os.environ.get('ROW_E2E_ADMIN_ID', '1068'))
MEMBER = int(os.environ.get('ROW_E2E_MEMBER_ID', '999'))
FIX = 990_000_000  # fixture RI member ids start here; real RI ids are far below
db = pymysql.connect(host='127.0.0.1', port=PORT, user='root', db=DB, autocommit=True)
fails = 0


def sql(q, *a):
    with db.cursor() as c:
        c.execute(q, a)
        return c.fetchall()


def one(q, *a):
    r = sql(q, *a)
    return r[0][0] if r else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    headers = {"Content-Type": "application/json", **({"Authorization": f"Bearer {tok}"} if tok else {})}
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


club = one("SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id=%s AND fk_role_id=2 AND IsActive=1 "
           "AND isdeleted=0 AND fk_club_id>0 LIMIT 1", ADMIN)
ri_club = int(one("SELECT ClubRotaryId FROM club_master WHERE pk_club_id=%s", club))
other = one("SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND IsActive=1 AND pk_club_id<>%s AND fk_district_id<>"
            "(SELECT fk_district_id FROM club_master WHERE pk_club_id=%s) LIMIT 1", club, club)
year = sql("SELECT pk_year_id, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1")[0]
yid, ystart, yend = year

assert one("SELECT COUNT(*) FROM rotary_org_club_members_cache WHERE RotaryMemberId>=%s", FIX) == 0, "fixture rows left over"
sync_before = sql("SELECT synced_at, officer_count, status, message FROM ri_club_officer_sync WHERE fk_club_id=%s", club)
officers_before = one("SELECT COUNT(*) FROM ri_club_officers WHERE fk_club_id=%s", club)


def holder(title):
    r = sql("SELECT TRIM(m.RotaryId) FROM board_of_directors bd JOIN designation_master ds ON ds.pk_designation_id=bd.fk_designation_id "
            "JOIN member_master_profile m ON m.pk_member_master_profile_id=bd.fk_member_master_profile_id "
            "WHERE bd.fk_club_id=%s AND bd.fk_year_id=%s AND bd.isdeleted=0 AND ds.ri_title=%s AND IFNULL(m.RotaryId,'')<>'' LIMIT 1",
            club, yid, title)
    return int(r[0][0]) if r else None


pres, sec, mem = holder("President"), holder("Secretary"), holder("Membership Chair")
# A member of another club (never of this one) who holds an RI id: RI lists them here, so they transfer in.
mover = sql("SELECT m.pk_member_master_profile_id, TRIM(m.RotaryId) FROM member_master_profile m "
            "JOIN club_members cm ON cm.fk_member_master_profile_id=m.pk_member_master_profile_id AND cm.isdeleted=0 AND cm.fk_club_id<>%s "
            "WHERE m.isdeleted=0 AND TRIM(m.RotaryId) REGEXP '^[0-9]+$' AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE "
            "r.fk_member_master_profile_id=m.pk_member_master_profile_id AND r.fk_role_id<>1 AND r.isdeleted=0) AND NOT EXISTS (SELECT 1 FROM club_members x "
            "WHERE x.fk_member_master_profile_id=m.pk_member_master_profile_id AND x.fk_club_id=%s) LIMIT 1", club, club)[0]
mover_id, mover_rid = mover[0], int(mover[1])
mover_roles = one("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id=%s AND fk_role_id=1", mover_id)
dup_email = one("SELECT EmailId FROM member_master_profile WHERE isdeleted=0 AND IFNULL(EmailId,'')<>'' "
                "AND pk_member_master_profile_id<>%s LIMIT 1", mover_id)
in_club_rid = int(one("SELECT TRIM(m.RotaryId) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id="
                      "cm.fk_member_master_profile_id WHERE cm.fk_club_id=%s AND cm.isdeleted=0 AND m.isdeleted=0 "
                      "AND TRIM(m.RotaryId) REGEXP '^[0-9]+$' LIMIT 1", club))
created_ids, linked_id = [], None
officer_rows = [
    (pres, "Club President"), (FIX + 1, "Club Secretary"), (mem, "Club Membership Chair"),
    (FIX + 2, "Club Executive Secretary/Director"), (FIX + 3, "Club President-Elect"),
]
try:
    a_tok, m_tok = token(ADMIN, "Admin"), token(MEMBER, "Member")

    # ── access ────────────────────────────────────────────────────────────────
    s, _ = call("GET", f"/api/clubs/{club}/ri-tools/officers")
    check("no token: 401", s == 401, s)
    s, _ = call("GET", f"/api/clubs/{club}/ri-tools/officers", m_tok)
    check("ordinary member: 403 on officers", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{club}/ri-tools/transfer-in", m_tok)
    check("ordinary member: 403 on transfer-in", s == 403, s)
    s, _ = call("POST", f"/api/clubs/{club}/ri-tools/transfer-in", m_tok, {"rotaryMemberId": 1, "mode": "create"})
    check("ordinary member: 403 on transfer-in write", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{other}/ri-tools/officers", a_tok)
    check("admin of another club: 403", s == 403, s)

    # ── officer compare before any RI data is stored ─────────────────────────
    if not sync_before and officers_before == 0:
        s, j = call("GET", f"/api/clubs/{club}/ri-tools/officers", a_tok)
        check("no RI sync stored: 200, six rows, all not_synced",
              s == 200 and len(j["rows"]) == 6 and all(r["status"] == "not_synced" for r in j["rows"]) and j["sync"]["status"] == "not_synced",
              (s, j))

    # ── fake RI source: officers ──────────────────────────────────────────────
    sql("DELETE FROM ri_club_officer_sync WHERE fk_club_id=%s", club)
    sql("INSERT INTO ri_club_officer_sync (fk_club_id, synced_at, officer_count, status, message) VALUES (%s, UTC_TIMESTAMP(), 5, 'ok', NULL)", club)
    for rid, role in officer_rows:
        if rid:
            sql("INSERT INTO ri_club_officers (fk_club_id, ri_member_id, officer_role, start_date, end_date, first_name, last_name) "
                "VALUES (%s, %s, %s, %s, %s, 'Fixture', %s)", club, rid, role, ystart, yend, f"Person{rid % 1000}")
    s, j = call("GET", f"/api/clubs/{club}/ri-tools/officers?yearId={yid}", a_tok)
    st = {r["title"]: r["status"] for r in (j or {}).get("rows", [])} if s == 200 else {}
    check("compare: 200 with the six RI titles in order", s == 200 and list(st) ==
          ["President", "Secretary", "Treasurer", "Membership Chair", "Foundation Chair", "Executive Secretary"], (s, j))
    if pres:
        check("compare: President matches RI", st.get("President") == "match", st)
    if sec:
        check("compare: Secretary differs from RI", st.get("Secretary") == "different", st)
    if mem:
        check("compare: Membership Chair matches RI", st.get("Membership Chair") == "match", st)
    check("compare: Executive Secretary only in RI", st.get("Executive Secretary") in ("missing_in_row", "different"), st)
    check("compare: President-Elect is not one of the six", all(h["rotaryId"] != str(FIX + 3) for r in j["rows"] for h in r["ri"]), j)
    check("compare: sync time returned as UTC", j["sync"]["status"] == "ok" and j["sync"]["syncedAtUtc"], j["sync"])
    s, j2 = call("GET", f"/api/clubs/{club}/ri-tools/officers?yearId=999999", a_tok)
    check("compare: unknown year falls back to the current year", s == 200 and j2["year"]["id"] == yid, (s, j2 and j2.get("year")))

    # ── fake RI source: members ───────────────────────────────────────────────
    # An unlinked club member (no RI id) whom RI lists under an email we give both.
    sql("INSERT INTO member_master_profile (MemberName, EmailId, IsPersonalDetailsVisible, created_date, isdeleted, ShowPhoneInAllClubs, ShowEmailInAllClubs) "
        "VALUES ('E2E Unlinked Person', 'e2e-ri-link@example.org', 1, NOW(), 0, 0, 0)")
    linked_id = one("SELECT LAST_INSERT_ID()")
    sql("INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_date, isdeleted) "
        "VALUES (%s, %s, UTC_DATE(), 1, NOW(), 0)", club, linked_id)
    cache = [
        (FIX + 11, "E2E Fixture Create", "e2e-ri-create@example.org", None),
        (FIX + 12, "E2E Some Other Name", "e2e-ri-link@example.org", None),
        (mover_rid, "E2E Mover", None, None),
        (FIX + 13, "E2E Duplicate Email", dup_email, None),
        (in_club_rid, "E2E Already Here", None, None),
        (FIX + 14, "E2E Terminated", None, "2026-01-01"),
    ]
    for rid, name, mail, term in cache:
        sql("INSERT INTO rotary_org_club_members_cache (fk_rotary_club_id, RotaryMemberId, LocalizedName, Email, MemberType, "
            "AdmissionDate, TerminationDate, LastFetchedUtc) VALUES (%s, %s, %s, %s, 'Active Member', '2026-08-01', %s, UTC_TIMESTAMP())",
            ri_club, rid, name, mail, term)

    s, j = call("GET", f"/api/clubs/{club}/ri-tools/transfer-in", a_tok)
    miss = {m["rotaryMemberId"]: m for m in (j or {}).get("missing", [])} if s == 200 else {}
    check("transfer-in: 200 and lists the RI-only people", s == 200 and {FIX + 11, FIX + 12, mover_rid, FIX + 13} <= set(miss), (s, list(miss)))
    check("transfer-in: a member already in the club is not listed", in_club_rid not in miss, list(miss))
    check("transfer-in: a terminated RI row is not listed", FIX + 14 not in miss, list(miss))
    check("transfer-in: same RI id elsewhere in ROW is offered", (miss.get(mover_rid) or {}).get("sameRiId", {}) and
          miss[mover_rid]["sameRiId"]["memberId"] == mover_id, miss.get(mover_rid))
    check("transfer-in: email match offers the unlinked club member",
          any(c["memberId"] == linked_id and c["reason"] == "email" for c in (miss.get(FIX + 12) or {}).get("matches", [])), miss.get(FIX + 12))
    check("transfer-in: fetch time returned", j.get("cacheFetchedUtc"), j)

    # ── validation ───────────────────────────────────────────────────────────
    url = f"/api/clubs/{club}/ri-tools/transfer-in"
    s, _ = call("POST", url, a_tok, {"rotaryMemberId": FIX + 11, "mode": "teleport"})
    check("bad mode: 400", s == 400, s)
    s, _ = call("POST", url, a_tok, {"rotaryMemberId": 0, "mode": "create"})
    check("missing RI id: 400", s == 400, s)
    s, _ = call("POST", url, a_tok, {"rotaryMemberId": FIX + 99, "mode": "create"})
    check("RI id not in the stored list: 404", s == 404, s)
    s, _ = call("POST", url, a_tok, {"rotaryMemberId": FIX + 14, "mode": "create"})
    check("terminated RI row cannot be brought in: 404", s == 404, s)
    s, _ = call("POST", url, a_tok, {"rotaryMemberId": FIX + 12, "mode": "link", "memberId": MEMBER})
    check("link to a member who already has an RI id: 400", s == 400, s)
    s, _ = call("POST", url, a_tok, {"rotaryMemberId": in_club_rid, "mode": "add"})
    check("someone already in the club: 409", s == 409, s)
    s, j = call("POST", url, a_tok, {"rotaryMemberId": FIX + 13, "mode": "create"})
    check("create with an email another member holds: 409 with the reason", s == 409 and "message" in (j or {}), (s, j))
    s, _ = call("POST", f"/api/clubs/{other}/ri-tools/transfer-in", a_tok, {"rotaryMemberId": FIX + 11, "mode": "create"})
    check("admin cannot transfer into another club: 403", s == 403, s)

    # ── the three ways in ────────────────────────────────────────────────────
    s, j = call("POST", url, a_tok, {"rotaryMemberId": FIX + 12, "mode": "link", "memberId": linked_id})
    check("link: 200 and the member gets the RI id", s == 200 and one("SELECT RotaryId FROM member_master_profile WHERE "
          "pk_member_master_profile_id=%s", linked_id) == str(FIX + 12), (s, j))
    s, j = call("POST", url, a_tok, {"rotaryMemberId": mover_rid, "mode": "add"})
    check("add: 200 and the member joins the club", s == 200 and one("SELECT COUNT(*) FROM club_members WHERE fk_club_id=%s AND "
          "fk_member_master_profile_id=%s AND isdeleted=0", club, mover_id) == 1, (s, j))
    s, j = call("POST", url, a_tok, {"rotaryMemberId": FIX + 11, "mode": "create"})
    new_id = (j or {}).get("memberId") if s == 200 else None
    if new_id:
        created_ids.append(new_id)
    check("create: 200, new member with the RI id in the club", s == 200 and new_id and one(
        "SELECT COUNT(*) FROM member_master_profile m JOIN club_members cm ON cm.fk_member_master_profile_id=m.pk_member_master_profile_id "
        "WHERE m.pk_member_master_profile_id=%s AND m.RotaryId=%s AND cm.fk_club_id=%s AND cm.isdeleted=0", new_id, str(FIX + 11), club) == 1, (s, j))
    s, _ = call("POST", url, a_tok, {"rotaryMemberId": FIX + 11, "mode": "create"})
    check("create twice: 409", s == 409, s)
    s, j = call("GET", f"/api/clubs/{club}/ri-tools/transfer-in", a_tok)
    left = {m["rotaryMemberId"] for m in j["missing"]}
    check("after the wizard only the duplicate-email row is left", FIX + 13 in left and not ({FIX + 11, FIX + 12, mover_rid} & left), left)
    check("each action is audited", one("SELECT COUNT(*) FROM audit_log WHERE action LIKE 'ri_transfer_in_%%' AND created_date > "
          "UTC_TIMESTAMP() - INTERVAL 1 DAY") >= 3)
finally:
    # Remove every fixture row and every change the wizard made.
    sql("DELETE FROM rotary_org_club_members_cache WHERE fk_rotary_club_id=%s AND (RotaryMemberId>=%s OR LocalizedName LIKE 'E2E %%')", ri_club, FIX)
    for rid, role in officer_rows:
        if rid:
            sql("DELETE FROM ri_club_officers WHERE fk_club_id=%s AND ri_member_id=%s AND officer_role=%s AND start_date=%s", club, rid, role, ystart)
    sql("DELETE FROM ri_club_officer_sync WHERE fk_club_id=%s", club)
    for r in sync_before:
        sql("INSERT INTO ri_club_officer_sync (fk_club_id, synced_at, officer_count, status, message) VALUES (%s,%s,%s,%s,%s)", club, *r)
    # club_members and member_master_profile refuse hard deletes (triggers): soft-delete and free the unique keys.
    sql("UPDATE club_members SET isdeleted=1, IsActive=0, deleted_date=NOW() WHERE fk_club_id=%s AND fk_member_master_profile_id=%s "
        "AND isdeleted=0", club, mover_id)
    if mover_roles == 0:
        sql("DELETE FROM member_roles WHERE fk_member_master_profile_id=%s AND fk_role_id=1", mover_id)
    created_ids += [i for (i,) in sql("SELECT pk_member_master_profile_id FROM member_master_profile WHERE RotaryId=%s OR EmailId IN "
                                      "('e2e-ri-create@example.org', 'e2e-ri-link@example.org')", str(FIX + 11))]
    for mid in set(created_ids + ([linked_id] if linked_id else [])):
        sql("DELETE FROM member_roles WHERE fk_member_master_profile_id=%s", mid)
        sql("UPDATE club_members SET isdeleted=1, IsActive=0, deleted_date=NOW() WHERE fk_member_master_profile_id=%s", mid)
        sql("UPDATE member_master_profile SET isdeleted=1, deleted_date=NOW(), RotaryId=NULL, EmailId=NULL, PrimaryMobileNumber=NULL, "
            "MemberName='E2E removed' WHERE pk_member_master_profile_id=%s", mid)
    left = one("SELECT COUNT(*) FROM member_master_profile WHERE RotaryId IN %s", [str(FIX + i) for i in range(1, 100)])
    check("cleanup: no fixture rows left", left == 0 and one("SELECT COUNT(*) FROM rotary_org_club_members_cache WHERE RotaryMemberId>=%s", FIX) == 0, left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
