"""Mass email ownership (S2, ROW security fix 2026-10-24): campaign ids belong to the club or district in the URL,
recipient ids must be that club's or district's, only managers read campaigns, a district edit keeps its recipients,
and a district send spends only its own district wallet.

    python -I kb/tools/mass_email_scope_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Start the API with
Brevo__ApiUrl and SmtpSettings pointing at a closed local port: one test sends a district campaign, and its recipient
addresses are rewritten to e2e-<id>@example.invalid before that, so nothing can reach a real person.
Everything created (campaigns, recipients, sub groups, one district Admin role row, credit wallets, usage history) is
removed at the end; audit_log rows stay (append-only by design). Local copies only, never production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = "e2e-mass-scope"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def ints(q):
    return [int(x) for x in sql(q).split()]


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None):
    """(status, parsed JSON)."""
    h = {"Authorization": f"Bearer {tok}"}
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
        return status, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:400]}"))


def mail(label, **recipients):
    return {"fromName": "e2e", "subject": f"{TAG} {label}", "emailBody": "<p>e2e</p>", "saveAsDraft": True, **recipients}


def create(path, tok, label, **recipients):
    status, body = call("POST", path, tok, mail(label, **recipients))
    if status == 200:
        created.append(body["id"])
    return status, body


def count(path, tok, **params):
    return call("GET", f"{path}/recipient-count?{urllib.parse.urlencode(params)}", tok)


# ── Data: club A (with a club admin) in the smallest reachable district dA, club B in another district dB ──────────
REACH = ("JOIN district_master d ON d.pk_district_id = c.fk_district_id JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id "
         "WHERE c.IsActive = 1 AND c.isdeleted = 0 AND d.IsActive = 1 AND d.isdeleted = 0 AND z.IsActive = 1 AND z.isdeleted = 0")
WITH_EMAIL = ("JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id "
              "WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND IFNULL(m.EmailId, '') <> ''")
club, dA = ints(
    f"SELECT c.pk_club_id, c.fk_district_id FROM club_master c {REACH} "
    "AND c.pk_club_id IN (SELECT fk_club_id FROM member_roles WHERE fk_role_id = 2 AND IsActive = 1 AND isdeleted = 0) "
    "AND c.fk_district_id NOT IN (SELECT fk_district_id FROM club_credits WHERE fk_club_id = 0 AND isdeleted = 0) "
    "ORDER BY (SELECT COUNT(*) FROM club_members cm JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id "
    "WHERE c2.fk_district_id = c.fk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0), c.pk_club_id LIMIT 1")
admin = ints(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id = {club} AND fk_role_id = 2 "
             "AND IsActive = 1 AND isdeleted = 0 LIMIT 1")[0]
plain, dadmin = ints(
    f"SELECT cm.fk_member_master_profile_id FROM club_members cm {WITH_EMAIL} AND cm.fk_club_id = {club} "
    "AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles "
    "WHERE fk_role_id <> 1 AND IsActive = 1 AND isdeleted = 0) ORDER BY 1 LIMIT 2")
other, dB = ints(
    f"SELECT c.pk_club_id, c.fk_district_id FROM club_master c {REACH} AND c.fk_district_id <> {dA} "
    f"AND EXISTS (SELECT 1 FROM club_members cm {WITH_EMAIL} AND cm.fk_club_id = c.pk_club_id) ORDER BY 1 LIMIT 1")
foreigner = ints(
    f"SELECT cm.fk_member_master_profile_id FROM club_members cm {WITH_EMAIL} AND cm.fk_club_id = {other} "
    "AND cm.fk_member_master_profile_id NOT IN (SELECT cm2.fk_member_master_profile_id FROM club_members cm2 "
    f"JOIN club_master c2 ON c2.pk_club_id = cm2.fk_club_id WHERE c2.fk_district_id = {dA} AND cm2.IsActive = 1 AND cm2.isdeleted = 0) "
    "LIMIT 1")[0]
past_club, past_member = ints(  # a membership that has ended (no current row for the same club)
    "SELECT cm.fk_club_id, cm.fk_member_master_profile_id FROM club_members cm WHERE cm.isdeleted = 1 AND cm.fk_club_id > 0 "
    "AND NOT EXISTS (SELECT 1 FROM club_members x WHERE x.fk_club_id = cm.fk_club_id "
    "AND x.fk_member_master_profile_id = cm.fk_member_master_profile_id AND IFNULL(x.isdeleted, 0) = 0) ORDER BY 1, 2 LIMIT 1")
sa = ints("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1")[0]
year = ints("SELECT pk_year_id FROM rotary_year_master ORDER BY pk_year_id DESC LIMIT 1")[0]
print(f"club {club} (district {dA}), other club {other} (district {dB})")

created, groups, wallets = [], [], []
role = None
comm_was_on = sql("SELECT IFNULL(MAX(enabled), 0) FROM platform_features WHERE feature_key = 'communication'") == "1"


def subgroup(club_id, district_id, member):
    gid = int(sql("INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, Scope, created_date, isdeleted) "
                  f"VALUES ({club_id}, {district_id or 'NULL'}, {year}, '{TAG}', '{'district' if district_id else 'club'}', NOW(), 0); "
                  "SELECT LAST_INSERT_ID();"))
    sql(f"INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_date, isdeleted) VALUES ({gid}, {member}, NOW(), 0)")
    groups.append(gid)
    return gid


def wallet(district_id, credits):
    wid = int(sql("INSERT INTO club_credits (fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount, FromDate, ToDate, IsActive, isdeleted) "
                  f"VALUES ({district_id}, 0, 'Email', {credits}, 0, CURDATE() - INTERVAL 1 DAY, CURDATE() + INTERVAL 30 DAY, 1, 0); "
                  "SELECT LAST_INSERT_ID();"))
    wallets.append(wid)
    return wid


def used(wid):
    return int(sql(f"SELECT UsedCount FROM club_credits WHERE pk_credit_id = {wid}"))


try:
    if comm_was_on:  # credits are only checked with the communication module off (FeatureGate caches 30 s)
        sql("UPDATE platform_features SET enabled = 0 WHERE feature_key = 'communication'")
        time.sleep(31)
    role = int(sql("INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, fk_district_id, AllClubsAccess, "
                   f"IsActive, isdeleted, created_date) VALUES ({dadmin}, 2, 0, {dA}, 0, 1, 0, NOW()); SELECT LAST_INSERT_ID();"))
    t_plain, t_admin, t_dadmin, t_sa = token(plain, "Member"), token(admin, "Admin"), token(dadmin, "Admin"), token(sa, "SuperAdmin")
    sg_a, sg_b = subgroup(club, None, plain), subgroup(other, None, foreigner)
    sg_da, sg_db = subgroup(0, dA, plain), subgroup(0, dB, foreigner)
    C, CB, D, DB_ = f"/api/clubs/{club}/mass-emails", f"/api/clubs/{other}/mass-emails", f"/api/districts/{dA}/mass-emails", f"/api/districts/{dB}/mass-emails"

    # ── Valid creates (managers, own recipients) ──────────────────────────────────────────────────────────────────
    s, b = create(C, t_admin, "own member", recipientType=3, memberIds=[plain])
    check("club admin creates with own member id (200)", s == 200, (s, b))
    id_a = b.get("id")
    s, b = create(C, t_admin, "own subgroup", recipientType=2, subgroupIds=[sg_a])
    check("club admin creates with own sub group (200)", s == 200, (s, b))
    s, b = create(CB, t_sa, "other club", recipientType=3, memberIds=[foreigner])
    check("SuperAdmin creates in the other club (200)", s == 200, (s, b))
    id_b = b.get("id")
    s, b = create(D, t_dadmin, "district all", recipientType=1)
    check("district admin creates 'All members' (200)", s == 200, (s, b))
    idd_a = b.get("id")
    s, b = create(D, t_dadmin, "district subgroup", recipientType=3, subgroupIds=[sg_da])
    check("district admin creates with own district sub group (200)", s == 200, (s, b))
    s, b = create(D, t_dadmin, "district club", recipientType=2, clubIds=[club])
    check("district admin creates with own club (200)", s == 200, (s, b))
    s, b = create(DB_, t_sa, "other district", recipientType=2, clubIds=[other])
    check("SuperAdmin creates in the other district (200)", s == 200, (s, b))
    idd_b = b.get("id")

    # ── Cross-club / cross-district campaign ids answer 404 ───────────────────────────────────────────────────────
    for method, suffix, body in [("GET", "", None), ("PUT", "", mail("hijack", recipientType=3, memberIds=[plain])),
                                 ("DELETE", "", None), ("POST", "/send", None), ("GET", "/recipients", None)]:
        s, _ = call(method, f"{C}/{id_b}{suffix}", t_admin, body)
        check(f"club admin {method} {suffix or 'detail'} of another club's email -> 404", s == 404, s)
        s, _ = call(method, f"{D}/{idd_b}{suffix}", t_dadmin, body)
        check(f"district admin {method} {suffix or 'detail'} of another district's email -> 404", s == 404, s)
    s, _ = call("GET", f"{C}/{id_b}", t_sa)
    check("SuperAdmin reading a club email through the wrong club -> 404", s == 404, s)
    s, _ = call("GET", f"{C}/{idd_a}", t_sa)
    check("district email through a club route -> 404", s == 404, s)
    check("other club's email untouched", sql(f"SELECT CONCAT(isdeleted, Subject) FROM club_mass_emails WHERE pk_mass_email_id = {id_b}")
          == f"0{TAG} other club")

    # ── Recipient ids outside the club / district answer 400 and create nothing ───────────────────────────────────
    rows_before = sql(f"SELECT COUNT(*) FROM club_mass_emails WHERE Subject LIKE '{TAG} reject%'")
    for label, path, tok, rec in [
        ("club: other club's sub group", C, t_admin, dict(recipientType=2, subgroupIds=[sg_b])),
        ("club: a district sub group", C, t_admin, dict(recipientType=2, subgroupIds=[sg_da])),
        ("club: legacy fkSubgroupId of other club", C, t_admin, dict(recipientType=2, subgroupIds=[], fkSubgroupId=sg_b)),
        ("club: member of another club", C, t_admin, dict(recipientType=3, memberIds=[foreigner])),
        ("club: own and foreign member", C, t_admin, dict(recipientType=3, memberIds=[plain, foreigner])),
        ("club: another club as recipient", C, t_admin, dict(recipientType=2, clubIds=[other])),
        ("club: a member who has left it", f"/api/clubs/{past_club}/mass-emails", t_sa, dict(recipientType=3, memberIds=[past_member])),
        ("district: other district's sub group", D, t_dadmin, dict(recipientType=3, subgroupIds=[sg_db])),
        ("district: a club sub group", D, t_dadmin, dict(recipientType=3, subgroupIds=[sg_a])),
        ("district: club of another district", D, t_dadmin, dict(recipientType=2, clubIds=[other])),
        ("district: member of another district", D, t_dadmin, dict(recipientType=3, memberIds=[foreigner])),
    ]:
        s, b = create(path, tok, "reject " + label, **rec)
        check(f"create rejects {label} (400)", s == 400, (s, b))
    s, b = call("PUT", f"{C}/{id_a}", t_admin, mail("reject update", recipientType=3, memberIds=[foreigner]))
    check("update rejects member of another club (400)", s == 400, (s, b))
    check("rejected update leaves recipients as they were",
          sql(f"SELECT GROUP_CONCAT(fk_member_id) FROM club_mass_email_recipients WHERE fk_mass_email_id = {id_a} AND isdeleted = 0") == str(plain))
    s, b = call("PUT", f"{D}/{idd_a}", t_dadmin, mail("reject update", recipientType=2, clubIds=[other]))
    check("district update rejects club of another district (400)", s == 400, (s, b))
    check("rejected creates stored nothing", sql(f"SELECT COUNT(*) FROM club_mass_emails WHERE Subject LIKE '{TAG} reject%'") == rows_before)
    s, b = count(C, t_admin, recipientType=2, subgroupIds=sg_b)
    check("club count ignores another club's sub group", s == 200 and b.get("totalMembers") == 0, (s, b))
    s, b = count(C, t_admin, recipientType=2, subgroupIds=sg_a)
    check("club count sees its own sub group", s == 200 and b.get("totalMembers", 0) >= 1, (s, b))
    s, b = count(D, t_dadmin, recipientType=2, clubIds=other)
    check("district count ignores a club of another district", s == 200 and b.get("totalMembers") == 0, (s, b))
    s, b = count(D, t_dadmin, recipientType=3, subgroupIds=sg_da)
    check("district count sees its own sub group", s == 200 and b.get("totalMembers", 0) >= 1, (s, b))

    # ── Plain members get 403, managers 200 ───────────────────────────────────────────────────────────────────────
    for name, path in [("club list", C), ("club detail", f"{C}/{id_a}"), ("club recipients", f"{C}/{id_a}/recipients"),
                       ("district list", D), ("district detail", f"{D}/{idd_a}"), ("district recipients", f"{D}/{idd_a}/recipients")]:
        s, _ = call("GET", path, t_plain)
        check(f"member reads {name} -> 403", s == 403, s)
    s, _ = count(C, t_plain, recipientType=1)
    check("member club recipient count -> 403", s == 403, s)
    s, _ = count(D, t_plain, recipientType=1)
    check("member district recipient count -> 403", s == 403, s)
    s, b = call("GET", C, t_admin)
    ids = [i["id"] for i in b.get("items", [])]
    check("club admin lists own club (200, no foreign ids)", s == 200 and id_a in ids and id_b not in ids, (s, ids))
    s, b = call("GET", f"{C}/{id_a}", t_admin)
    check("club admin reads detail (200)", s == 200 and [r["memberId"] for r in b.get("recipients", [])] == [plain], (s, b))
    s, _ = call("GET", f"{C}/{id_a}/recipients", t_admin)
    check("club admin reads recipients (200)", s == 200, s)
    s, _ = call("GET", C, t_sa)
    check("SuperAdmin lists club (200)", s == 200, s)
    s, b = call("GET", D, t_dadmin)
    ids = [i["id"] for i in b.get("items", [])]
    check("district admin lists own district (200, no foreign ids)", s == 200 and idd_a in ids and idd_b not in ids, (s, ids))
    for name, path in [("detail", f"{D}/{idd_a}"), ("recipients", f"{D}/{idd_a}/recipients")]:
        s, _ = call("GET", path, t_dadmin)
        check(f"district admin reads {name} (200)", s == 200, s)
    s, _ = call("GET", D, t_sa)
    check("SuperAdmin lists district (200)", s == 200, s)
    s, _ = call("GET", D, t_admin)
    check("club admin is not a district manager -> 403", s == 403, s)

    # ── Editing a district 'All members' email keeps its recipients ───────────────────────────────────────────────
    total = int(sql(f"SELECT TotalRecipients FROM club_mass_emails WHERE pk_mass_email_id = {idd_a}"))
    s, b = call("PUT", f"{D}/{idd_a}", t_dadmin, mail("district all", recipientType=1))
    after = sql(f"SELECT TotalRecipients, (SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id = {idd_a} "
                f"AND isdeleted = 0) FROM club_mass_emails WHERE pk_mass_email_id = {idd_a}").split()
    check("district edit keeps its recipients", s == 200 and total > 0 and after == [str(total), str(total)], (s, total, after))

    # ── Communication module off: a district send spends its own district wallet only ─────────────────────────────
    other_wallet = wallet(dB, 100000)
    s, b = create(D, t_dadmin, "district credits", recipientType=2, clubIds=[club])
    idd_c = b.get("id")
    sql(f"UPDATE club_mass_email_recipients SET Email = CONCAT('e2e-', pk_id, '@example.invalid') WHERE fk_mass_email_id = {idd_c}")
    need = int(sql(f"SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id = {idd_c} AND isdeleted = 0"))
    s, b = call("POST", f"{D}/{idd_c}/send", t_dadmin)
    check("district without credits cannot send on another district's wallet (400)",
          s == 400 and "Insufficient" in b.get("message", "") and used(other_wallet) == 0, (s, b, used(other_wallet)))
    own_wallet = wallet(dA, need + 5)
    s, b = call("POST", f"{D}/{idd_c}/send", t_dadmin)
    check("district send spends its own wallet only",
          s == 200 and need > 0 and used(own_wallet) == need and used(other_wallet) == 0, (s, b, need, used(own_wallet), used(other_wallet)))
    check("usage history booked to the district", sql(
        "SELECT CONCAT(fk_club_id, '/', fk_district_id, '/', DeductedCount) FROM club_credit_usage_history "
        f"WHERE Source = 'MassEmail' AND SourceId = {idd_c}") == f"0/{dA}/{need}")
    for _ in range(120):  # the send runs in the background; let it finish before cleaning up
        if sql(f"SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = {idd_c}") in ("Sent", "Failed"):
            break
        time.sleep(0.5)
finally:
    ids = ",".join(str(i) for i in created) or "0"
    sql(f"DELETE FROM club_credit_usage_history WHERE Source = 'MassEmail' AND SourceId IN ({ids})")
    sql(f"DELETE FROM club_mass_email_recipients WHERE fk_mass_email_id IN ({ids})")
    sql(f"DELETE FROM club_mass_emails WHERE pk_mass_email_id IN ({ids})")
    if wallets:
        sql(f"DELETE FROM club_credits WHERE pk_credit_id IN ({','.join(map(str, wallets))})")
    if groups:
        g = ",".join(map(str, groups))
        sql(f"DELETE FROM sub_group_members WHERE fk_sub_group_id IN ({g})")
        sql(f"DELETE FROM sub_groups WHERE pk_sub_group_id IN ({g})")
    if role:
        sql(f"DELETE FROM member_roles WHERE pk_member_role_id = {role}")
    if comm_was_on:
        sql("UPDATE platform_features SET enabled = 1 WHERE feature_key = 'communication'")

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
