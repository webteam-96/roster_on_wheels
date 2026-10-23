"""Read review A-L (2026-10-24): GET routes in controllers A* to L* that name a club, district, member, campaign or
payment link outside /api/clubs/{id} and /api/districts/{id} now check the caller's scope, and the cross-club member
profile routes keep what the member chose to hide. Notes: docs/superpowers/plans/2026-10-24-read-review-a-l.md.

    python -I kb/tools/read_review_a_l_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Local copies only, never
production. It adds test rows (two dues campaigns and a payment, two payment links and a payment, an event, a project,
role rows), flips one member's privacy flags, and deletes or restores all of it at the end.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
DENIED, OK = (403, 404), (200, 204)
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def row(q):
    out = sql(q)
    if not out:
        sys.exit(f"FAIL no test data for: {' '.join(q.split())[:160]}")
    return [int(x) if x.lstrip('-').isdigit() else x for x in out.split('\n')[0].split('\t')]


def insert(q):
    return int(sql(q + "; SELECT LAST_INSERT_ID()"))


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def get(path, tok):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def expect(name, path, tok, codes):
    # status only on failure: response bodies carry members' names and contacts
    code, body = get(path, tok)
    check(name, code in codes, f"HTTP {code}")
    return body


def pair(route, cross_path, cross_tok, legit_path, legit_tok):
    """One fixed route: the cross-scope call is refused, the legitimate one answers."""
    expect(f"{route}: cross-scope refused", cross_path, cross_tok, DENIED)
    return expect(f"{route}: legitimate call answers", legit_path, legit_tok, OK)


# ── Test people and places, picked from the data ───────────────────────────────────────────────
PLAIN = """NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = {m} AND r.fk_role_id <> 1
                          AND r.IsActive = 1 AND r.isdeleted = 0)
           AND NOT EXISTS (SELECT 1 FROM district_ag ag WHERE ag.fk_member_id = {m} AND ag.is_active = 1 AND ag.isdeleted = 0)"""
LIVE = """c.isdeleted = 0 AND c.IsActive = 1 AND COALESCE(c.ClubType, '') <> 'Rotaract Club'
          AND EXISTS (SELECT 1 FROM district_master d JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                      WHERE d.pk_district_id = c.fk_district_id AND d.IsActive = 1 AND d.isdeleted = 0
                        AND z.IsActive = 1 AND z.isdeleted = 0)"""
ONLY_DISTRICT = """NOT EXISTS (SELECT 1 FROM club_members x JOIN club_master xc ON xc.pk_club_id = x.fk_club_id
                               WHERE x.fk_member_master_profile_id = {m} AND x.IsActive = 1 AND x.isdeleted = 0
                                 AND xc.fk_district_id <> {d})"""

year_id, year_label = row("SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")
sa = row("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1")[0]

# Club A: has a club admin who is its member, and a President this year (the dues officer).
club_a, dist_a, officer = row(f"""
    SELECT c.pk_club_id, c.fk_district_id, b.fk_member_master_profile_id FROM club_master c
    JOIN board_of_directors b ON b.fk_club_id = c.pk_club_id AND b.isdeleted = 0 AND b.fk_year_id = {year_id}
    JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id AND dm.designation_name = 'Club President'
    WHERE {LIVE} AND EXISTS (SELECT 1 FROM member_roles r JOIN club_members cm ON cm.fk_member_master_profile_id = r.fk_member_master_profile_id
                AND cm.fk_club_id = r.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                WHERE r.fk_club_id = c.pk_club_id AND r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0)
    ORDER BY c.pk_club_id LIMIT 1""")
admin_a = row(f"""SELECT r.fk_member_master_profile_id FROM member_roles r JOIN club_members cm
    ON cm.fk_member_master_profile_id = r.fk_member_master_profile_id AND cm.fk_club_id = r.fk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
    WHERE r.fk_club_id = {club_a} AND r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0 ORDER BY 1 LIMIT 1""")[0]
plain_a = row(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {club_a} AND cm.IsActive = 1
    AND cm.isdeleted = 0 AND {PLAIN.format(m='cm.fk_member_master_profile_id')}
    AND {ONLY_DISTRICT.format(m='cm.fk_member_master_profile_id', d=dist_a)} ORDER BY 1 LIMIT 1""")[0]
# Profile target: one club only, contacts and a birthday on file, email shown to other clubs.
target, club_t, dist_t, orig_personal, orig_phone_all = row(f"""
    SELECT m.pk_member_master_profile_id, cm.fk_club_id, c.fk_district_id, m.IsPersonalDetailsVisible + 0, m.ShowPhoneInAllClubs + 0
    FROM member_master_profile m JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
      AND cm.IsActive = 1 AND cm.isdeleted = 0
    JOIN club_master c ON c.pk_club_id = cm.fk_club_id
    WHERE m.isdeleted = 0 AND m.SecondaryMobileNumber <> '' AND m.EmailId <> '' AND m.BirthDate IS NOT NULL
      AND COALESCE(m.ShowEmailInAllClubs, 1) = 1 AND {PLAIN.format(m='m.pk_member_master_profile_id')}
      AND (SELECT COUNT(*) FROM club_members x WHERE x.fk_member_master_profile_id = m.pk_member_master_profile_id
           AND x.IsActive = 1 AND x.isdeleted = 0) = 1
    ORDER BY 1 LIMIT 1""")
# Club B: another district with its own admin, where none of the club A people are members.
club_b, dist_b = row(f"""SELECT c.pk_club_id, c.fk_district_id FROM club_master c WHERE {LIVE}
    AND c.fk_district_id NOT IN ({dist_a}, {dist_t})
    AND c.fk_district_id NOT IN (SELECT xc.fk_district_id FROM club_members x JOIN club_master xc ON xc.pk_club_id = x.fk_club_id
        WHERE x.fk_member_master_profile_id IN ({admin_a}, {officer}, {plain_a}) AND x.IsActive = 1 AND x.isdeleted = 0)
    AND EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_club_id = c.pk_club_id AND r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0)
    ORDER BY c.pk_club_id LIMIT 1""")
admin_b = row(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id = {club_b} AND fk_role_id = 2 AND IsActive = 1 AND isdeleted = 0 LIMIT 1")[0]
plain_b, da = [int(x) for x in sql(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {club_b}
    AND cm.IsActive = 1 AND cm.isdeleted = 0 AND {PLAIN.format(m='cm.fk_member_master_profile_id')}
    AND {ONLY_DISTRICT.format(m='cm.fk_member_master_profile_id', d=dist_b)} ORDER BY 1 LIMIT 2""").split()]
num_a = sql(f"SELECT DistrictNumber FROM district_master WHERE pk_district_id = {dist_a}")
num_b = sql(f"SELECT DistrictNumber FROM district_master WHERE pk_district_id = {dist_b}")
# A club with no numeric Rotary.org id, so the terminated-members call answers without calling Rotary.org.
no_rid = row("""SELECT pk_club_id FROM club_master WHERE isdeleted = 0 AND pk_club_id NOT IN ({0})
    AND (ClubRotaryId IS NULL OR ClubRotaryId NOT REGEXP '^[0-9]+$') ORDER BY 1 LIMIT 1""".format(f"{club_a},{club_b}"))[0]
projects = f"rotary_projects_{year_label.replace('-', '_')}"
module = row("SELECT pk_module_id FROM module_master WHERE ModuleKey = 'community_service' AND isdeleted = 0 LIMIT 1")[0]

t_sa, t_admin_a, t_admin_b = token(sa, "SuperAdmin"), token(admin_a, "Admin"), token(admin_b, "Admin")
t_plain_a, t_plain_b, t_da = token(plain_a, "Member"), token(plain_b, "Member"), token(da, "Admin")
t_officer, t_target = token(officer, "Member"), token(target, "Member")

roles, dues, links, events, projs = [], [], [], [], []
log_floor = int(sql("SELECT COALESCE(MAX(pk_change_id), 0) FROM member_change_log"))
try:
    # ── Test rows ──────────────────────────────────────────────────────────────────────────────
    roles.append(insert(f"""INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, AllClubsAccess,
        IsActive, isdeleted, AssignedDate) VALUES ({da}, 2, {dist_a}, 0, 1, 0, NOW())"""))
    for d in (dist_a, dist_b):
        dues.append(insert(f"""INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, IsActive, isdeleted, created_by, created_date)
            VALUES ({d}, '{year_label}', 'e2e read review', 1, 0, {sa}, NOW())"""))
    dues_a, dues_b = dues
    pay_a = insert(f"""INSERT INTO club_dues_payments (fk_club_dues_id, fk_club_id, Amount, IsPaid, IsOnline, OfflineStatus,
        OfflineTransactionType, isdeleted, created_date) VALUES ({dues_a}, {club_a}, 1, 0, 0, 'Pending', 'Cash', 0, NOW())""")
    for c, d, by in ((club_a, dist_a, admin_a), (club_b, dist_b, admin_b)):
        links.append(insert(f"""INSERT INTO event_payment_links (FormType, AmountType, RecipientType, IsForAllDistricts, fk_club_id,
            fk_district_master_id, Title, IsActive, isdeleted, created_by, created_date)
            VALUES (1, 1, 1, 0, {c}, {d}, 'e2e read review', 1, 0, {by}, NOW())"""))
    link_a, link_b = links
    member_pay_a = insert(f"""INSERT INTO event_payment_members (fk_payment_link_id, MemberName, Amount, IsPaid, IsOnline,
        isdeleted, created_date) VALUES ({link_a}, 'e2e read review', 1, 0, 0, 0, NOW())""")
    events.append(insert(f"""INSERT INTO upcoming_events (fk_club_id, Title, EventDate, PublishDate, ExpiryDate, Status, IsActive,
        isdeleted, created_by, created_date) VALUES ({club_t}, 'e2e read review', NOW() + INTERVAL 1 DAY, NOW(),
        NOW() + INTERVAL 2 DAY, 'Published', 1, 0, {target}, NOW())"""))
    projs.append(insert(f"""INSERT INTO `{projects}` (fk_club_id, fk_module_id, fk_year_id, title, is_active, isdeleted, created_by,
        created_date) VALUES ({club_t}, {module}, {year_id}, 'e2e read review', 1, 0, {target}, NOW())"""))

    # ── Admin, citation, analytics, award status, directory, DG search ─────────────────────────
    expect("members-with-roles: a club Admin is refused", "/api/admin/members-with-roles?pageSize=5", t_admin_a, DENIED)
    expect("members-with-roles: SuperAdmin answers", "/api/admin/members-with-roles?pageSize=5", t_sa, OK)
    pair("citation-matrix", f"/api/citation-matrix?districtId={dist_b}", t_plain_a,
         f"/api/citation-matrix?districtId={dist_a}", t_plain_a)
    pair("club-analytics club", f"/api/club-analytics/excel?clubId={club_b}", t_admin_a,
         f"/api/club-analytics/excel?clubId={club_a}", t_admin_a)
    pair("club-analytics district", f"/api/club-analytics/excel?districtId={dist_b}", t_admin_a,
         f"/api/club-analytics/excel?districtId={dist_a}", t_admin_a)
    pair("club-award-status", f"/api/club-award-status?clubId={club_b}", t_admin_a,
         f"/api/club-award-status?clubId={club_a}", t_admin_a)
    pair("club-myrotary", f"/api/club-myrotary?clubId={club_b}", t_admin_a,
         f"/api/club-myrotary?clubId={club_a}", t_admin_a)
    body = pair("district-directory", f"/api/district-directory/{num_b}?rotaryYear={year_label}", t_plain_a,
                f"/api/district-directory/{num_a}?rotaryYear={year_label}", t_plain_a)
    check("district-directory: no device token or IMEI", "LastDeviceToken" not in body and "LastImei" not in body)
    expect("district-governors/search-members: a club Admin is refused", "/api/district-governors/search-members?search=ra", t_admin_a, DENIED)
    expect("district-governors/search-members: SuperAdmin answers", "/api/district-governors/search-members?search=ra", t_sa, OK)

    # ── Rotary.org terminated members (club named in the query) ──────────────────────────────────
    expect("rotary-org-terminated-members: another club refused", f"/api/club-admin-dashboard/rotary-org-terminated-members?clubId={club_b}", t_admin_a, DENIED)
    roles.append(insert(f"""INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted, AssignedDate)
        VALUES ({admin_a}, 2, {no_rid}, 1, 0, NOW())"""))
    expect("rotary-org-terminated-members: the club's admin answers", f"/api/club-admin-dashboard/rotary-org-terminated-members?clubId={no_rid}", t_admin_a, OK)
    sql(f"DELETE FROM member_roles WHERE pk_member_role_id = {roles.pop()}")

    # ── District dues ──────────────────────────────────────────────────────────────────────────
    expect("club-dues list: a club Admin is refused", f"/api/club-dues?districtId={dist_b}", t_admin_a, DENIED)
    expect("club-dues list: SuperAdmin answers", f"/api/club-dues?districtId={dist_b}", t_sa, OK)
    expect("club-dues detail: a club Admin is refused", f"/api/club-dues/{dues_b}", t_admin_a, DENIED)
    expect("club-dues detail: SuperAdmin answers", f"/api/club-dues/{dues_b}", t_sa, OK)
    pair("club-dues clubs", f"/api/club-dues/{dues_b}/clubs", t_da, f"/api/club-dues/{dues_a}/clubs", t_da)
    expect("club-dues clubs: a club Admin is refused", f"/api/club-dues/{dues_a}/clubs", t_admin_a, DENIED)
    pair("club-dues club members", f"/api/club-dues/{dues_b}/clubs/{club_b}/members", t_da,
         f"/api/club-dues/{dues_a}/clubs/{club_a}/members", t_da)
    pair("club-dues offline-details", f"/api/club-dues/payments/{pay_a}/offline-details", t_admin_a,
         f"/api/club-dues/payments/{pay_a}/offline-details", t_da)
    pair("club-dues club vendors", f"/api/club-dues/{dues_a}/clubs/{club_a}/vendors", t_admin_a,
         f"/api/club-dues/{dues_a}/clubs/{club_a}/vendors", t_sa)
    pair("club-dues all-club-vendors", f"/api/club-dues/{dues_a}/all-club-vendors", t_admin_a,
         f"/api/club-dues/{dues_a}/all-club-vendors", t_sa)
    pair("club-dues offline-accounts", f"/api/club-dues/{dues_b}/clubs/{club_b}/offline-accounts", t_da,
         f"/api/club-dues/{dues_a}/clubs/{club_a}/offline-accounts", t_da)
    pair("club-dues export", f"/api/club-dues/{dues_a}/export", t_admin_a, f"/api/club-dues/{dues_a}/export", t_sa)
    pair("club-dues pay-link", f"/api/club-dues/{dues_a}/clubs/{club_a}/pay-link", t_admin_a,
         f"/api/club-dues/{dues_a}/clubs/{club_a}/pay-link", t_sa)
    pair("club-dues content", f"/api/club-dues/{dues_b}/content", t_da, f"/api/club-dues/{dues_a}/content", t_da)
    expect("club-dues content: a club Admin is refused", f"/api/club-dues/{dues_a}/content", t_admin_a, DENIED)
    pair("club-dues officer campaign", f"/api/club-dues/officer/{dues_b}?clubId={club_a}", t_officer,
         f"/api/club-dues/officer/{dues_a}?clubId={club_a}", t_officer)
    pair("club-dues officer pay-link", f"/api/club-dues/officer/{dues_b}/pay-link?clubId={club_a}", t_officer,
         f"/api/club-dues/officer/{dues_a}/pay-link?clubId={club_a}", t_officer)
    pair("club-dues officer offline-accounts", f"/api/club-dues/officer/{dues_b}/offline-accounts?clubId={club_a}", t_officer,
         f"/api/club-dues/officer/{dues_a}/offline-accounts?clubId={club_a}", t_officer)
    code, body = get(f"/api/club-dues/my-district?districtId={dist_b}", t_admin_a)
    check("club-dues my-district: another district's campaigns stay hidden", code in DENIED or f'"id":{dues_b},' not in body, f"HTTP {code}")
    body = expect("club-dues my-district: the district admin answers", f"/api/club-dues/my-district?districtId={dist_a}", t_da, OK)
    check("club-dues my-district: lists the district's campaign", f'"id":{dues_a},' in body, "test campaign missing")

    # ── Event payment links ────────────────────────────────────────────────────────────────────
    pair("event-payment-links list", f"/api/event-payment-links?clubId={club_b}", t_admin_a,
         f"/api/event-payment-links?clubId={club_a}", t_admin_a)
    pair("event-payment-links list (all)", "/api/event-payment-links", t_admin_a, "/api/event-payment-links", t_sa)
    for suffix in ("", "/registrations", "/vendor-splits", "/designations", "/members", "/members?isPaid=true",
                   "/settlement-report", "/members/export"):
        pair(f"event-payment-links/{{id}}{suffix}", f"/api/event-payment-links/{link_b}{suffix}", t_admin_a,
             f"/api/event-payment-links/{link_a}{suffix}", t_admin_a)
    pair("event-payment-links member-payment", f"/api/event-payment-links/member-payment/{member_pay_a}", t_admin_b,
         f"/api/event-payment-links/member-payment/{member_pay_a}", t_admin_a)
    expect("event-payment-links: a district admin reads the district's club link", f"/api/event-payment-links/{link_a}", t_da, OK)

    # ── Mobile member profiles keep what the member hid ────────────────────────────────────────
    def profile(path, tok):
        code, body = get(path, tok)
        return code, (json.loads(body).get("member") if code == 200 else {})

    for name, path in (("find-rotarian", f"/api/mobile/find-rotarian/{target}"),
                       ("club-finder member", f"/api/mobile/club-finder/members/{target}")):
        sql(f"UPDATE member_master_profile SET IsPersonalDetailsVisible = 0 WHERE pk_member_master_profile_id = {target}")
        code, m = profile(path, t_plain_b)
        hidden = [k for k in ("email", "primaryMobile", "secondaryMobile", "birthDate", "anniversaryDate") if m.get(k)]
        check(f"{name}: another club's member gets no contacts or dates when personal details are off", code == 200 and not hidden, f"{code} {hidden}")
        code, m = profile(path, t_target)
        check(f"{name}: the member still sees their own", code == 200 and m.get("email"), f"{code}")
        sql(f"""UPDATE member_master_profile SET IsPersonalDetailsVisible = 1, ShowPhoneInAllClubs = 0
                WHERE pk_member_master_profile_id = {target}""")
        code, m = profile(path, t_plain_b)
        check(f"{name}: a hidden phone hides the second mobile too", code == 200 and not m.get("primaryMobile")
              and not m.get("secondaryMobile") and m.get("email"), f"{code} {m.get('secondaryMobile') is not None}")
        sql(f"""UPDATE member_master_profile SET IsPersonalDetailsVisible = {orig_personal}, ShowPhoneInAllClubs = {orig_phone_all}
                WHERE pk_member_master_profile_id = {target}""")

    body = expect("club-finder event: answers", f"/api/mobile/club-finder/events/{events[0]}", t_plain_b, OK)
    check("club-finder event: no organiser email or mobile", "organizerEmail" not in body and "organizerMobile" not in body
          and "organizerName" in body, "organiser contact fields still sent")
    body = expect("club-finder project: answers", f"/api/mobile/club-finder/projects/{projs[0]}?yearId={year_id}", t_plain_b, OK)
    check("club-finder project: no creator email or mobile", "createdByEmail" not in body and "createdByMobile" not in body,
          "creator contact fields still sent")
finally:
    sql(f"""UPDATE member_master_profile SET IsPersonalDetailsVisible = {orig_personal}, ShowPhoneInAllClubs = {orig_phone_all}
            WHERE pk_member_master_profile_id = {target}""")
    sql(f"DELETE FROM member_change_log WHERE pk_change_id > {log_floor} AND fk_member_master_profile_id = {target}")
    if roles:
        sql(f"DELETE FROM member_roles WHERE pk_member_role_id IN ({','.join(map(str, roles))})")
    if dues:
        ids = ','.join(map(str, dues))
        for t in ("club_dues_club_vendors", "club_dues_members", "club_dues_clubs", "club_dues_payments",
                  "club_dues_settlements", "club_dues_vendors"):
            sql(f"DELETE FROM {t} WHERE fk_club_dues_id IN ({ids})")
        sql(f"DELETE FROM club_dues WHERE pk_club_dues_id IN ({ids})")
    if links:
        ids = ','.join(map(str, links))
        for t in ("event_payment_settlements", "event_payment_members", "event_payment_registrations",
                  "event_payment_vendor_splits", "event_payment_designations", "event_payment_otp"):
            sql(f"DELETE FROM {t} WHERE fk_payment_link_id IN ({ids})")
        sql(f"DELETE FROM event_payment_links WHERE pk_id IN ({ids})")
    if events:
        sql(f"DELETE FROM upcoming_events WHERE pk_upcoming_event_id IN ({','.join(map(str, events))})")
    if projs:
        sql(f"DELETE FROM `{projects}` WHERE pk_project_id IN ({','.join(map(str, projs))})")

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
