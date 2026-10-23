"""Read access of GET routes outside /api/clubs/{id} and /api/districts/{id} (controllers M-Z, ROW security fix
2026-10-24, notes in docs/superpowers/plans/2026-10-24-read-review-m-z.md). For every fixed route a cross-scope call
answers 403/404 and a legitimate call answers 2xx.

    python -I kb/tools/read_review_m_z_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only,
never production. Adds a few test rows (two dues campaigns with a payment each, two past presidents, two district
dues campaigns, one temporary district-admin role, the 'ocv' and 'cmr_email_settings' switches) and removes them
again at the end.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = "e2e read review m-z"
SYNC_PROJECT = 987654321  # project id no year table holds; its sync-log rows are this test's
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def insert(q):
    return int(sql(q + "; SELECT LAST_INSERT_ID();").split()[-1])


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def get(path, tok):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def denied(name, path, tok):
    s = get(path, tok)
    check(name, s in (403, 404), s)


def allowed(name, path, tok):
    s = get(path, tok)
    check(name, 200 <= s < 300, s)


def pair(route, own, foreign, tok, who="caller"):
    """route: label; own/foreign: paths in and out of the caller's scope."""
    denied(f"{route}: {who} cannot read another scope", foreign, tok)
    allowed(f"{route}: {who} reads own scope", own, tok)


def one(q):
    v = sql(q)
    if not v:
        raise SystemExit(f"no test data for: {q}")
    return [int(x) for x in v.split()]


# ── People and places, picked from the data ─────────────────────────────────────────────────────────────────────
# club C with a club admin A (an active member of C, no SuperAdmin / district / AG role) and a current-year officer
club, district, admin = one(
    "SELECT r.fk_club_id, c.fk_district_id, r.fk_member_master_profile_id FROM member_roles r "
    "JOIN club_master c ON c.pk_club_id = r.fk_club_id AND IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1 "
    "JOIN club_members cm ON cm.fk_member_master_profile_id = r.fk_member_master_profile_id AND cm.fk_club_id = r.fk_club_id "
    "  AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0 "
    "WHERE r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0 "
    "  AND NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id = r.fk_member_master_profile_id "
    "    AND x.IsActive = 1 AND x.isdeleted = 0 AND (x.fk_role_id = 3 OR (x.fk_role_id = 2 AND IFNULL(x.fk_club_id, 0) = 0))) "
    "  AND NOT EXISTS (SELECT 1 FROM district_ag ag WHERE ag.fk_member_id = r.fk_member_master_profile_id AND ag.isdeleted = 0) "
    "  AND EXISTS (SELECT 1 FROM board_of_directors b JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id "
    "    JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1 WHERE b.fk_club_id = r.fk_club_id "
    "    AND COALESCE(b.isdeleted, 0) = 0 AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer')) "
    "ORDER BY 1, 3 LIMIT 1")
officer = one(
    f"SELECT b.fk_member_master_profile_id FROM board_of_directors b JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id "
    f"JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1 WHERE b.fk_club_id = {club} "
    f"AND COALESCE(b.isdeleted, 0) = 0 AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer') LIMIT 1")[0]
# a club O in another district with at least two plain members; T is one of them and in no club of C's district
other, other_district = one(
    f"SELECT c.pk_club_id, c.fk_district_id FROM club_master c WHERE c.fk_district_id <> {district} "
    "AND IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1 AND (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id "
    "AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0 AND NOT EXISTS (SELECT 1 FROM member_roles r "
    "WHERE r.fk_member_master_profile_id = cm.fk_member_master_profile_id AND r.fk_role_id <> 1 AND r.IsActive = 1)) >= 2 "
    "ORDER BY 1 LIMIT 1")
target = one(
    f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {other} AND cm.IsActive = 1 "
    f"AND IFNULL(cm.isdeleted, 0) = 0 AND NOT EXISTS (SELECT 1 FROM club_members x JOIN club_master xc ON xc.pk_club_id = x.fk_club_id "
    f"WHERE x.fk_member_master_profile_id = cm.fk_member_master_profile_id AND xc.fk_district_id = {district}) "
    "AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = cm.fk_member_master_profile_id "
    "AND r.fk_role_id <> 1 AND r.IsActive = 1) ORDER BY 1 LIMIT 1")[0]
# a plain member P of C only (no role, no other club)
plain = one(
    f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {club} AND cm.IsActive = 1 "
    "AND IFNULL(cm.isdeleted, 0) = 0 AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = "
    "cm.fk_member_master_profile_id AND r.fk_role_id <> 1 AND r.IsActive = 1 AND r.isdeleted = 0) "
    "AND NOT EXISTS (SELECT 1 FROM district_ag ag WHERE ag.fk_member_id = cm.fk_member_master_profile_id AND ag.isdeleted = 0) "
    "AND (SELECT COUNT(*) FROM club_members x WHERE x.fk_member_master_profile_id = cm.fk_member_master_profile_id "
    "AND IFNULL(x.isdeleted, 0) = 0) = 1 ORDER BY 1 LIMIT 1")[0]
# a plain member of O who becomes, for this test only, district admin of C's district
outsider = one(
    f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {other} AND cm.IsActive = 1 "
    f"AND IFNULL(cm.isdeleted, 0) = 0 AND cm.fk_member_master_profile_id <> {target} AND NOT EXISTS (SELECT 1 FROM member_roles r "
    "WHERE r.fk_member_master_profile_id = cm.fk_member_master_profile_id AND r.fk_role_id <> 1 AND r.IsActive = 1 AND r.isdeleted = 0) "
    "AND NOT EXISTS (SELECT 1 FROM district_ag ag WHERE ag.fk_member_id = cm.fk_member_master_profile_id AND ag.isdeleted = 0) "
    "ORDER BY 1 LIMIT 1")[0]
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1")[0]
year = one("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1")[0]
past_year = one("SELECT pk_year_id FROM rotary_year_master WHERE EndDate < CURDATE() AND isdeleted = 0 ORDER BY EndDate DESC LIMIT 1")[0]

t_plain, t_admin, t_sa = token(plain, "Member"), token(admin, "Admin"), token(sa, "SuperAdmin")
t_da, t_officer = token(outsider, "Admin"), token(officer, "Member")

made = {"dues": [], "pay": [], "pp": [], "cdues": [], "role": []}
flags = {k: sql(f"SELECT enabled FROM platform_features WHERE feature_key = '{k}'") for k in ("ocv", "cmr_email_settings")}
try:
    for k in flags:
        sql(f"INSERT INTO platform_features (feature_key, enabled) VALUES ('{k}', 1) ON DUPLICATE KEY UPDATE enabled = 1")
    flags_on_at = time.time()
    made["role"].append(insert(
        "INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, fk_club_id, IsActive, isdeleted, "
        f"AllClubsAccess, created_date) VALUES ({outsider}, 2, {district}, NULL, 1, 0, 0, NOW())"))
    for c, d in ((club, district), (other, other_district)):
        dues = insert("INSERT INTO membership_dues (fk_district_id, fk_club_id, RotaryYear, Purpose) "
                      f"VALUES ({d}, {c}, 'e2e', '{TAG}')")
        made["dues"].append(dues)
        made["pay"].append(insert("INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, "
                                  f"fk_member_profile_id, FeeType, Amount) VALUES ({dues}, 0, {target}, 1, 1)"))
        made["pp"].append(insert("INSERT INTO past_presidents (fk_club_id, fk_year_id, non_member_name) "
                                 f"VALUES ({c}, {past_year}, '{TAG}')"))
    for d in (district, other_district):
        made["cdues"].append(insert(f"INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose) VALUES ({d}, 'e2e', '{TAG}')"))
    (dues_c, dues_o), (pay_c, pay_o), (pp_c, pp_o), (cdues_c, cdues_o) = made["dues"], made["pay"], made["pp"], made["cdues"]

    # ── Members ─────────────────────────────────────────────────────────────────────────────────────────────
    denied("members/{id}: member cannot read a member of another club", f"/api/members/{target}", t_plain)
    denied("members/{id}: club admin cannot read a member of another club", f"/api/members/{target}", t_admin)
    allowed("members/{id}: member reads a member of the same club", f"/api/members/{admin}", t_plain)
    allowed("members/{id}: member reads self", f"/api/members/{plain}", t_plain)
    allowed("members/{id}: SuperAdmin reads anyone", f"/api/members/{target}", t_sa)
    denied("members/{id}/device-token: member cannot read another's token", f"/api/members/{admin}/device-token", t_plain)
    allowed("members/{id}/device-token: member reads own token", f"/api/members/{plain}/device-token", t_plain)
    allowed("members/{id}/device-token: SuperAdmin reads any token", f"/api/members/{target}/device-token", t_sa)

    # ── Membership dues, web and app ────────────────────────────────────────────────────────────────────────
    for base in ("/api/membership-dues", "/api/mobile/club-admin/membership-dues"):
        pair(f"{base}?clubId", f"{base}?clubId={club}", f"{base}?clubId={other}", t_admin, "club admin")
        denied(f"{base}: club admin cannot list every club", base, t_admin)
        allowed(f"{base}: SuperAdmin lists every club", base, t_sa)
        pair(f"{base}?districtId", f"{base}?districtId={district}", f"{base}?districtId={other_district}", t_da, "district admin")
        pair(f"{base}/{{id}}", f"{base}/{dues_c}", f"{base}/{dues_o}", t_admin, "club admin")
        pair(f"{base}/{{id}}", f"{base}/{dues_c}", f"{base}/{dues_o}", t_da, "district admin")
        pair(f"{base}/{{id}}/members", f"{base}/{dues_c}/members", f"{base}/{dues_o}/members", t_admin, "club admin")
        pair(f"{base}/payments/{{id}}/offline-details", f"{base}/payments/{pay_c}/offline-details",
             f"{base}/payments/{pay_o}/offline-details", t_admin, "club admin")
    base = "/api/membership-dues"
    pair(f"{base}/{{id}}/settlement-report", f"{base}/{dues_c}/settlement-report", f"{base}/{dues_o}/settlement-report", t_admin, "club admin")
    pair(f"{base}/{{id}}/export", f"{base}/{dues_c}/export", f"{base}/{dues_o}/export", t_admin, "club admin")
    base = "/api/mobile/club-admin/membership-dues/pending-offline-approvals"
    pair(base, f"{base}?clubId={club}", f"{base}?clubId={other}", t_admin, "club admin")

    # ── App: past presidents, club report ───────────────────────────────────────────────────────────────────
    base = "/api/mobile/club-admin/past-presidents"
    pair(f"{base}?clubId", f"{base}?clubId={club}", f"{base}?clubId={other}", t_admin, "club admin")
    pair(f"{base}/{{id}}", f"{base}/{pp_c}", f"{base}/{pp_o}", t_admin, "club admin")
    pair(f"{base}/search-members", f"{base}/search-members?clubId={club}", f"{base}/search-members?clubId={other}", t_admin, "club admin")
    base = "/api/mobile/club-admin/club-report"
    for sub in ("", "/avenue-of-service-raw-data", "/annual-club-service-raw-data", "/annual-report"):
        pair(base + sub, f"{base}{sub}?clubId={club}&yearId={year}", f"{base}{sub}?clubId={other}&yearId={year}", t_admin, "club admin")
    pair(f"{base}/available-years", f"{base}/available-years?clubId={club}", f"{base}/available-years?clubId={other}", t_admin, "club admin")

    # ── App: district report, awards, weblinks, club goals ──────────────────────────────────────────────────
    time.sleep(max(0, 31 - (time.time() - flags_on_at)))  # the API caches the module switches for 30 seconds
    base = "/api/mobile/district-admin/district-report"
    for sub in ("", "/ocv-gov", "/club-officers-ri", "/avenue-of-service-all-clubs", "/avenue-of-service-club-count"):
        pair(base + sub, f"{base}{sub}?districtId={district}&yearId={year}", f"{base}{sub}?districtId={other_district}&yearId={year}",
             t_admin, "club admin")
    pair(f"{base}/available-years", f"{base}/available-years?districtId={district}",
         f"{base}/available-years?districtId={other_district}", t_admin, "club admin")
    for sub, q in (("categories", ""), ("description", f"?yearId={year}"), ("auto-questions", ""),
                   ("manual-questions", ""), ("club-points", f"?yearId={year}")):
        pair(f"/api/mobile/districts/{{id}}/awards/{sub}", f"/api/mobile/districts/{district}/awards/{sub}{q}",
             f"/api/mobile/districts/{other_district}/awards/{sub}{q}", t_plain, "member")
    pair("/api/mobile/districts/{id}/weblinks", f"/api/mobile/districts/{district}/weblinks",
         f"/api/mobile/districts/{other_district}/weblinks", t_plain, "member")
    pair("/api/mobile/clubs/{id}/weblinks", f"/api/mobile/clubs/{club}/weblinks", f"/api/mobile/clubs/{other}/weblinks", t_plain, "member")
    for route in ("club-award-status", "club-myrotary"):
        pair(f"/api/mobile/{route}", f"/api/mobile/{route}?clubId={club}", f"/api/mobile/{route}?clubId={other}", t_admin, "club admin")
        allowed(f"/api/mobile/{route}: district admin reads a club of the district", f"/api/mobile/{route}?clubId={club}", t_da)
    base = "/api/mobile/districts/{}/cmr-email-settings?yearId=" + str(year)
    pair("/api/mobile/districts/{id}/cmr-email-settings", base.format(district), base.format(other_district), t_da, "district admin")
    denied("/api/mobile/districts/{id}/cmr-email-settings: club admin cannot read", base.format(district), t_admin)

    # ── Recipient counts, project sync token, district dues ─────────────────────────────────────────────────
    pair("/api/recipient-info/club/{id}", f"/api/recipient-info/club/{club}", f"/api/recipient-info/club/{other}", t_admin, "club admin")
    denied("/api/recipient-info/club/{id}: plain member cannot read", f"/api/recipient-info/club/{club}", t_plain)
    pair("/api/recipient-info/district/{id}", f"/api/recipient-info/district/{district}",
         f"/api/recipient-info/district/{other_district}", t_da, "district admin")
    denied("/api/recipient-info/district/{id}: club admin cannot read", f"/api/recipient-info/district/{district}", t_admin)
    pair("/api/rotary-org-sync/token", f"/api/rotary-org-sync/token?projectId={SYNC_PROJECT}&clubId={club}",
         f"/api/rotary-org-sync/token?projectId={SYNC_PROJECT}&clubId={other}", t_admin, "club admin")
    pair("/api/mobile/club-dues/{duesId}", f"/api/mobile/club-dues/{cdues_c}?clubId={club}",
         f"/api/mobile/club-dues/{cdues_o}?clubId={club}", t_officer, "club officer")
finally:
    ids = lambda k: ",".join(str(i) for i in made[k]) or "0"
    sql(f"DELETE FROM membership_dues_payments WHERE fk_membership_dues_id IN ({ids('dues')})")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id IN ({ids('dues')})")
    sql(f"DELETE FROM past_presidents WHERE pk_past_president_id IN ({ids('pp')})")
    for t in ("club_dues_club_vendors", "club_dues_vendors", "club_dues_members", "club_dues_payments",
              "club_dues_settlements", "club_dues_clubs"):
        sql(f"DELETE FROM {t} WHERE fk_club_dues_id IN ({ids('cdues')})")
    sql(f"DELETE FROM club_dues WHERE pk_club_dues_id IN ({ids('cdues')})")
    sql(f"DELETE FROM member_roles WHERE pk_member_role_id IN ({ids('role')})")
    sql(f"DELETE FROM rotary_org_project_sync_log WHERE fk_project_id = {SYNC_PROJECT}")
    for k, was in flags.items():
        sql(f"DELETE FROM platform_features WHERE feature_key = '{k}'" if was == "" else
            f"UPDATE platform_features SET enabled = {was} WHERE feature_key = '{k}'")

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
