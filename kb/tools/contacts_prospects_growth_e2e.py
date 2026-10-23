"""Contacts, prospect pipeline, public join form, guest invites and growth (N3, feature contacts_growth, 2026-10-23).

    python -I kb/tools/contacts_prospects_growth_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Writes test rows (names
'E2E N3 ...', emails n3e2e...@example.org) to the given LOCAL database and removes them at the end; the converted
test member is soft-deleted (hard deletes are blocked by triggers) and re-activated by the next run.
The invite prompt "send now" step emails the test club's members: it only runs when ROW_E2E_EMAIL_SAFE=1 says the API
was started with Brevo__ApiUrl pointing at a dead local port, so nothing leaves the machine. The public forms allow 8
posts per 10 minutes per IP: wait 10 minutes or restart the API before running again.
"""
import base64, datetime, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
EMAIL_SAFE = os.environ.get('ROW_E2E_EMAIL_SAFE') == '1'
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
FEATURE = "contacts_growth"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


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


# ── Pick real ids: the smallest club with a club admin, a plain member, another club elsewhere, the SuperAdmin ──
club, district = [int(x) for x in sql(
    "SELECT c.pk_club_id, c.fk_district_id FROM club_master c WHERE c.IsActive=1 AND c.isdeleted=0 AND EXISTS "
    "(SELECT 1 FROM member_roles r WHERE r.fk_club_id=c.pk_club_id AND r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0) "
    "ORDER BY (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id=c.pk_club_id AND cm.IsActive=1 AND cm.isdeleted=0), "
    "c.pk_club_id LIMIT 1").split()]
admin = int(sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={club} AND fk_role_id=2 "
                "AND IsActive=1 AND isdeleted=0 LIMIT 1"))
plain = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND cm.IsActive=1 "
                "AND cm.isdeleted=0 AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM "
                "member_roles WHERE fk_role_id<>1 AND IsActive=1 AND isdeleted=0) ORDER BY 1 LIMIT 1"))
other, other_district = [int(x) for x in sql(
    f"SELECT pk_club_id, fk_district_id FROM club_master WHERE fk_district_id<>{district} AND IsActive=1 AND isdeleted=0 "
    "ORDER BY 1 LIMIT 1").split()]
outsider = sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.IsActive=1 AND cm.isdeleted=0 "
               f"AND cm.fk_club_id<>{club} AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id "
               f"FROM club_members WHERE fk_club_id={club}) LIMIT 1")
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
year = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 AND COALESCE(isdeleted,0)=0 ORDER BY StartDate DESC LIMIT 1"))
t_admin, t_plain, t_sa = token(admin, "Admin"), token(plain, "Member"), token(sa, "SuperAdmin")
print(f"club {club} (district {district}), admin {admin}, member {plain}, other club {other}, SuperAdmin {sa}")

was_on = sql(f"SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='{FEATURE}'") == "1"
old_target = sql(f"SELECT target_net_growth FROM club_growth_targets WHERE fk_club_id={club} AND fk_year_id={year}")
links_start = int(sql("SELECT COALESCE(MAX(pk_id), 0) FROM member_invite_links") or 0)
email_log_start = int(sql("SELECT COALESCE(MAX(pk_id), 0) FROM email_log") or 0)
C, D = f"/api/clubs/{club}", f"/api/districts/{district}"


def cleanup():
    steps = [
        "DELETE gm FROM contact_group_members gm JOIN contacts c ON c.pk_contact_id=gm.fk_contact_id "
        "WHERE c.name LIKE 'E2E N3%' OR c.email LIKE 'n3e2e%@example.org'",
        "DELETE FROM contacts WHERE name LIKE 'E2E N3%' OR email LIKE 'n3e2e%@example.org'",
        "DELETE gm FROM contact_group_members gm JOIN contact_groups g ON g.pk_contact_group_id=gm.fk_contact_group_id "
        "WHERE g.name LIKE 'E2E N3%'",
        "DELETE FROM contact_groups WHERE name LIKE 'E2E N3%'",
        "DELETE FROM potential_members WHERE name LIKE 'E2E N3%' OR email LIKE 'n3e2e%@example.org'",
        "DELETE r FROM club_mass_email_recipients r JOIN club_mass_emails m ON m.pk_mass_email_id=r.fk_mass_email_id "
        "WHERE m.Subject LIKE '%E2E N3%'",
        "DELETE FROM club_mass_emails WHERE Subject LIKE '%E2E N3%'",
        "DELETE FROM upcoming_events WHERE Title LIKE 'E2E N3%'",
        "DELETE l FROM invite_prompt_log l JOIN invite_prompts p ON p.pk_invite_prompt_id=l.fk_invite_prompt_id "
        "WHERE p.note LIKE 'E2E N3%'",
        "DELETE FROM invite_prompts WHERE note LIKE 'E2E N3%'",
        f"DELETE FROM email_log WHERE pk_id>{email_log_start} AND (recipient_email LIKE 'n3e2e%@example.org' "
        "OR subject LIKE 'Bring a guest to %')",
        # the converted test member: soft delete only (triggers block hard deletes); the next run re-activates it
        "UPDATE member_roles r JOIN member_master_profile m ON m.pk_member_master_profile_id=r.fk_member_master_profile_id "
        "SET r.isdeleted=1, r.IsActive=0 WHERE m.EmailId LIKE 'n3e2e%@example.org'",
        "UPDATE club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id "
        "SET cm.isdeleted=1, cm.IsActive=0 WHERE m.EmailId LIKE 'n3e2e%@example.org'",
        "UPDATE member_master_profile SET isdeleted=1 WHERE EmailId LIKE 'n3e2e%@example.org'",
    ]
    for q in steps:  # one failing step must not leave the others undone
        try:
            sql(q)
        except subprocess.CalledProcessError as e:
            print(f"WARN cleanup step failed: {q[:60]}... {e.stderr.strip()[:200]}")


def set_feature(on):
    return call("PUT", f"/api/features/{FEATURE}", t_sa, {"enabled": on})[0]


cleanup()
try:
    # ── Feature switch ─────────────────────────────────────────────────────────────────────────────
    set_feature(False)
    check("off: contacts API answers 404", call("GET", f"{C}/contacts", t_admin)[0] == 404)
    check("off: public join answers 404", call("GET", f"/api/public/join/club/{club}")[0] == 404)
    s = set_feature(True)
    check("SuperAdmin switches the feature on", s == 204, s)

    # ── Contacts and groups ───────────────────────────────────────────────────────────────────────
    s, b = call("POST", f"{C}/contacts", t_admin, {"name": "E2E N3 Guest A", "email": "N3E2E.a@example.org",
                                                     "mobile": "+1 555 0100", "contactType": "speaker", "organisation": "E2E Org"})
    check("club admin adds a contact", s == 200 and b.get("id"), (s, b))
    contact_a = b["id"] if s == 200 else 0
    s, b = call("POST", f"{C}/contacts", t_admin, {"name": "E2E N3 Dup", "email": "n3e2e.a@example.org"})
    check("same email again is refused (409)", s == 409, (s, b))
    check("invalid email is refused (400)", call("POST", f"{C}/contacts", t_admin, {"name": "E2E N3 X", "email": "not-an-email"})[0] == 400)
    check("unknown contact type is refused (400)", call("POST", f"{C}/contacts", t_admin, {"name": "E2E N3 X", "contactType": "boss"})[0] == 400)
    check("plain member cannot list contacts (403)", call("GET", f"{C}/contacts", t_plain)[0] == 403)
    check("plain member cannot add a contact (403)", call("POST", f"{C}/contacts", t_plain, {"name": "E2E N3 Y"})[0] == 403)
    check("club admin cannot list another club's contacts (403)", call("GET", f"/api/clubs/{other}/contacts", t_admin)[0] == 403)
    s, b = call("GET", f"{C}/contacts?search=E2E%20N3", t_sa)
    check("SuperAdmin lists the club's contacts, email stored lower case",
          s == 200 and any(i["id"] == contact_a and i["email"] == "n3e2e.a@example.org" for i in b["items"]), (s, b))
    s, _ = call("PUT", f"/api/clubs/{other}/contacts/{contact_a}", t_sa, {"name": "E2E N3 Moved"})
    check("a contact cannot be edited through another club's URL (404)", s == 404, s)

    s, b = call("POST", f"{C}/contact-groups", t_admin, {"name": "E2E N3 Gala"})
    check("club admin adds a contact group", s == 200, (s, b))
    group = b["id"] if s == 200 else 0
    check("same group name is refused (409)", call("POST", f"{C}/contact-groups", t_admin, {"name": "E2E N3 Gala"})[0] == 409)
    s, b = call("POST", f"/api/clubs/{other}/contact-groups", t_sa, {"name": "E2E N3 Foreign"})
    foreign_group = b["id"] if s == 200 else 0
    s, _ = call("PUT", f"{C}/contacts/{contact_a}", t_admin, {"name": "E2E N3 Guest A", "email": "n3e2e.a@example.org",
                                                             "mobile": "+1 555 0100", "contactType": "speaker", "groupIds": [group]})
    check("contact put in the group", s == 200, s)
    s, _ = call("PUT", f"{C}/contacts/{contact_a}", t_admin, {"name": "E2E N3 Guest A", "groupIds": [foreign_group]})
    check("another club's group is refused (400)", s == 400, s)
    s, b = call("GET", f"{C}/contacts?groupId={group}", t_admin)
    check("group filter returns the contact", s == 200 and [i["id"] for i in b["items"]] == [contact_a], (s, b))
    s, b = call("GET", f"{D}/contacts", t_admin)
    check("club admin cannot read district contacts (403)", s == 403, s)
    s, b = call("POST", f"{D}/contacts", t_sa, {"name": "E2E N3 District Partner", "email": "n3e2e.d@example.org", "contactType": "partner"})
    check("district contact added", s == 200, (s, b))
    s, b = call("GET", f"{D}/contacts", t_sa)
    check("district list holds only district contacts",
          s == 200 and [i["name"] for i in b["items"] if i["name"].startswith("E2E N3")] == ["E2E N3 District Partner"], (s, b))

    # ── CSV import: duplicates by email first, then name + phone; inside the file and against existing ──
    rows = [{"name": "E2E N3 Import One", "email": "n3e2e.i1@example.org"},
            {"name": "E2E N3 Guest A renamed", "email": "N3E2E.A@example.org", "notes": "from the sheet"},
            {"name": "E2E N3 No Email", "mobile": "555-0199"},
            {"name": "e2e n3 no email", "mobile": "(555) 0199"},
            {"name": ""},
            {"name": "E2E N3 Import One Again", "email": "n3e2e.I1@example.org"}]
    s, b = call("POST", f"{C}/contacts/import/preview", t_admin, {"rows": rows})
    statuses = [r["status"] for r in b] if s == 200 else []
    check("preview classifies new / duplicate / invalid",
          statuses == ["new", "duplicate", "new", "duplicate", "invalid", "duplicate"], (s, b))
    check("preview links the existing contact", s == 200 and b[1].get("matchId") == contact_a, b)
    s, b = call("POST", f"{C}/contacts/import", t_admin, {"rows": rows, "groupId": group, "updateExisting": True})
    check("import counts", s == 200 and b == {"created": 2, "updated": 1, "skipped": 2, "invalid": 1}, (s, b))
    check("update filled the blank notes only",
          sql(f"SELECT CONCAT(name,'|',notes) FROM contacts WHERE pk_contact_id={contact_a}") == "E2E N3 Guest A|from the sheet")
    s, b = call("GET", f"{C}/contacts?groupId={group}", t_admin)
    check("imported and matched contacts are in the group", s == 200 and b["totalCount"] == 3, (s, b))
    s, b = call("POST", f"{C}/contacts/import/preview", t_admin, {"rows": rows[:1]})
    check("re-import finds the row by email", s == 200 and b[0]["status"] == "duplicate", (s, b))
    check("over 5000 rows is refused (400)", call("POST", f"{C}/contacts/import/preview", t_admin, {"rows": [{"name": "x"}] * 5001})[0] == 400)

    # ── Contact groups as mass email recipients (type 4) and as an event invite list ─────────────────
    s, b = call("GET", f"{C}/mass-emails/recipient-count?recipientType=4&contactGroupIds={group}", t_admin)
    check("recipient count for the group (3 contacts, 2 with email)", s == 200 and b == {"totalMembers": 3, "membersWithEmail": 2}, (s, b))
    s, b = call("GET", f"{C}/mass-emails/recipient-count?recipientType=4&contactGroupIds={foreign_group}", t_admin)
    check("another club's group counts nobody", s == 200 and b["totalMembers"] == 0, (s, b))
    s, b = call("POST", f"{C}/mass-emails", t_admin, {"recipientType": 4, "contactGroupIds": [group], "fromName": "E2E",
                                                       "subject": "E2E N3 hello", "emailBody": "<p>hi</p>", "saveAsDraft": True})
    mail = b["id"] if s == 200 else 0
    s, b = call("GET", f"{C}/mass-emails/{mail}", t_admin)
    check("draft to a contact group has the contacts as recipients",
          s == 200 and b["contactGroupIds"] == [group] and sorted(r["email"] for r in b["recipients"]) ==
          ["n3e2e.a@example.org", "n3e2e.i1@example.org"] and all(r["memberId"] == 0 for r in b["recipients"]), (s, b))
    check("recipient rows carry the contact id",
          sql(f"SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id={mail} AND fk_contact_id IS NOT NULL AND isdeleted=0") == "2")

    ev = sql(f"INSERT INTO upcoming_events (fk_club_id, Title, Description, EventDate, PublishDate, ExpiryDate, EventVenue, "
             f"RegistrationLink, Status) VALUES ({club}, 'E2E N3 Gala Night', 'Dinner <b>and</b> talk', NOW() + INTERVAL 7 DAY, NOW(), "
             f"NOW() + INTERVAL 8 DAY, 'Town Hall', 'https://example.org/register', 'Published'); SELECT LAST_INSERT_ID();")
    s, b = call("POST", f"{C}/contacts/invite-event", t_admin, {"eventId": int(ev), "contactGroupIds": [group]})
    check("event invite creates a mass email draft", s == 200 and b.get("massEmailId"), (s, b))
    if s == 200:
        row = sql(f"SELECT CONCAT(RecipientType,'|',Status,'|',TotalRecipients,'|',Subject) FROM club_mass_emails "
                  f"WHERE pk_mass_email_id={b['massEmailId']}")
        check("draft: contact groups, 2 recipients, event subject", row == "4|Draft|2|Invitation: E2E N3 Gala Night", row)
        body = sql(f"SELECT EmailBody FROM club_mass_emails WHERE pk_mass_email_id={b['massEmailId']}")
        check("event text is HTML-encoded in the body", "&lt;b&gt;" in body and "<b>and" not in body, body[:200])
    s, _ = call("POST", f"/api/clubs/{other}/contacts/invite-event", t_sa, {"eventId": int(ev), "contactGroupIds": [foreign_group]})
    check("another club's event is not found (404)", s == 404, s)

    # ── Prospects: stage, owner, notes, club-scoped ids, conversion ─────────────────────────────────
    s, b = call("POST", f"{C}/potential-members", t_admin, {"name": "E2E N3 Prospect", "email": "n3e2e.p1@example.org",
                                                            "mobileNumber": "+15550142", "stage": "contacted",
                                                            "ownerMemberId": plain, "notes": "Met at the fair"})
    check("prospect added with stage, owner and notes", s == 200, (s, b))
    prospect = b["id"] if s == 200 else 0
    check("unknown stage is refused (400)",
          call("POST", f"{C}/potential-members", t_admin, {"name": "E2E N3 Bad", "stage": "maybe"})[0] == 400)
    if outsider:
        check("owner from another club is refused (400)",
              call("POST", f"{C}/potential-members", t_admin, {"name": "E2E N3 Bad", "ownerMemberId": int(outsider)})[0] == 400)
    s, b = call("GET", f"{C}/potential-members?stage=contacted&search=E2E%20N3", t_admin)
    check("stage filter lists the prospect with its owner's name",
          s == 200 and any(i["id"] == prospect and i["ownerMemberId"] == plain and i["ownerName"] for i in b["items"]), (s, b))
    check("prospect is not readable through another club's URL (404)",
          call("GET", f"/api/clubs/{other}/potential-members/{prospect}", t_sa)[0] == 404)
    check("prospect is not editable through another club's URL (404)",
          call("PUT", f"/api/clubs/{other}/potential-members/{prospect}", t_sa, {"name": "E2E N3 Hijack"})[0] == 404)
    s, _ = call("PUT", f"{C}/potential-members/{prospect}", t_admin, {"name": "E2E N3 Prospect", "email": "n3e2e.p1@example.org",
                                                                      "mobileNumber": "+15550142", "stage": "proposed"})
    check("stage update keeps owner and notes when they are not sent",
          s == 200 and sql(f"SELECT CONCAT(stage,'|',fk_owner_member_id,'|',notes) FROM potential_members WHERE pk_potential_member_id={prospect}")
          == f"proposed|{plain}|Met at the fair", s)
    check("plain member cannot convert (403)", call("POST", f"{C}/potential-members/{prospect}/convert", t_plain)[0] == 403)
    s, b = call("POST", f"{C}/potential-members/{prospect}/convert", t_admin)
    check("one-click conversion creates the member", s == 200 and b.get("memberId"), (s, b))
    new_member = b.get("memberId") if s == 200 else 0
    if new_member:
        check("new member is an active member of the club", sql(
            f"SELECT COUNT(*) FROM club_members WHERE fk_club_id={club} AND fk_member_master_profile_id={new_member} "
            "AND IsActive=1 AND isdeleted=0 AND JoinedDate=CURDATE()") == "1")
        check("prospect marked inducted with the member id", sql(
            f"SELECT CONCAT(stage,'|',fk_converted_member_id) FROM potential_members WHERE pk_potential_member_id={prospect}")
            == f"inducted|{new_member}")
        check("conversion is audited", sql(
            f"SELECT COUNT(*) FROM audit_log WHERE entity_type='member' AND entity_id={new_member} AND action='CREATE'") != "0")
    check("converting twice is refused (409)", call("POST", f"{C}/potential-members/{prospect}/convert", t_admin)[0] == 409)
    s, b = call("POST", f"{C}/potential-members", t_admin, {"name": "E2E N3 Twin", "email": "n3e2e.p1@example.org"})
    twin = b["id"] if s == 200 else 0
    s, b = call("POST", f"{C}/potential-members/{twin}/convert", t_admin)
    check("member add duplicate check runs on conversion (409, email exists)", s == 409 and "email" in str(b).lower(), (s, b))
    check("failed conversion leaves the prospect open", sql(
        f"SELECT COUNT(*) FROM potential_members WHERE pk_potential_member_id={twin} AND fk_converted_member_id IS NULL") == "1")

    # ── Growth target and progress ─────────────────────────────────────────────────────────────────
    check("plain member cannot set the target (403)",
          call("PUT", f"{C}/growth/target", t_plain, {"yearId": year, "target": 5})[0] == 403)
    check("target out of range is refused (400)", call("PUT", f"{C}/growth/target", t_admin, {"yearId": year, "target": -1})[0] == 400)
    s, _ = call("PUT", f"{C}/growth/target", t_admin, {"yearId": year, "target": 5})
    check("club admin sets the growth target", s == 200, s)
    joined = int(sql(f"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm JOIN rotary_year_master y "
                     f"ON y.pk_year_id={year} WHERE cm.fk_club_id={club} AND cm.IsHonoraryMember=0 AND cm.JoinedDate BETWEEN y.StartDate AND y.EndDate"))
    left = int(sql(f"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm JOIN rotary_year_master y "
                   f"ON y.pk_year_id={year} WHERE cm.fk_club_id={club} AND cm.IsHonoraryMember=0 AND cm.TerminationDate BETWEEN y.StartDate AND y.EndDate"))
    s, g = call("GET", f"{C}/growth", t_plain)
    stage = {x["stage"]: x["count"] for x in g["prospectsByStage"]} if s == 200 else {}
    check("member reads club growth: target, joins, terminations, net",
          s == 200 and g["target"] == 5 and g["joined"] == joined and g["terminated"] == left
          and g["netGrowth"] == joined - left and joined >= 1, (s, g, joined, left))
    check("prospects by stage include the inducted one", stage.get("inducted", 0) >= 1 and len(stage) == 7, stage)
    s, dg = call("GET", f"{D}/growth", t_sa)
    mine = next((c for c in dg["clubs"] if c["clubId"] == club), None) if s == 200 else None
    check("district rollup carries the club's target and joins",
          mine is not None and mine["target"] == 5 and mine["joined"] == joined and dg["targetTotal"] >= 5, (s, mine))
    check("club admin cannot set another club's target (403)",
          call("PUT", f"/api/clubs/{other}/growth/target", t_admin, {"yearId": year, "target": 3})[0] == 403)

    # ── Public join form (club and district websites) ──────────────────────────────────────────────
    s, b = call("GET", f"/api/public/join/club/{club}")
    check("public join form reads the club name", s == 200 and b.get("clubName"), (s, b))
    s, b = call("GET", f"/api/public/join/district/{district}")
    check("district join form lists the district's clubs", s == 200 and any(c["id"] == club for c in b["clubs"]), (s, b))
    form = {"clubId": club, "name": "E2E N3 Web Visitor", "email": "n3e2e.web@example.org", "phone": "+1 555 0177",
            "message": "I would like to join", "consent": True, "elapsedMs": 6000}
    s, b = call("POST", "/api/public/join", None, form)
    if s == 429:
        print("FAIL public form rate limit is still active from an earlier run: restart the API or wait 10 minutes")
        fails += 1
    check("join form accepted", s == 200, (s, b))
    check("join form created an inquiry prospect with consent date", sql(
        "SELECT CONCAT(stage,'|',source,'|',consent_date IS NOT NULL) FROM potential_members "
        f"WHERE email='n3e2e.web@example.org' AND fk_club_id={club}") == "inquiry|website|1")
    call("POST", "/api/public/join", None, form)
    check("sending the form twice keeps one prospect",
          sql(f"SELECT COUNT(*) FROM potential_members WHERE email='n3e2e.web@example.org' AND fk_club_id={club}") == "1")
    s, _ = call("POST", "/api/public/join", None, {**form, "email": "n3e2e.bot@example.org", "website": "http://spam.example"})
    check("honeypot: answered 200, nothing stored",
          s == 200 and sql("SELECT COUNT(*) FROM potential_members WHERE email='n3e2e.bot@example.org'") == "0", s)
    check("consent is required (400)", call("POST", "/api/public/join", None, {**form, "consent": False})[0] == 400)
    check("district form refuses a club outside the district (400)",
          call("POST", "/api/public/join", None, {**form, "clubId": other, "districtId": district})[0] == 400)

    # ── Personal invite link and the guest's RSVP ──────────────────────────────────────────────────
    s, b = call("GET", f"{C}/invite-link", t_plain)
    tok = b["url"].rsplit("/invite/", 1)[-1] if s == 200 else ""
    check("member gets a personal invite link", s == 200 and len(tok) == 32, (s, b))
    s, b2 = call("GET", f"{C}/invite-link", t_plain)
    check("the link stays the same", s == 200 and b2["url"] == b["url"], (b, b2))
    if sql(f"SELECT COUNT(*) FROM club_members WHERE fk_club_id={club} AND fk_member_master_profile_id={sa} AND IsActive=1 AND isdeleted=0") == "0":
        check("a non-member has no invite link (403)", call("GET", f"{C}/invite-link", t_sa)[0] == 403)
    s, b = call("GET", f"/api/public/invite/{tok}")
    check("RSVP page reads club and inviter", s == 200 and b.get("clubName") and b.get("inviterName"), (s, b))
    check("unknown token answers 404", call("GET", "/api/public/invite/" + "0" * 32)[0] == 404)
    rsvp = {"name": "E2E N3 Guest Joiner", "email": "n3e2e.g1@example.org", "attending": True,
            "interestedInJoining": True, "consent": True, "elapsedMs": 4000}
    s, b = call("POST", f"/api/public/invite/{tok}/rsvp", None, rsvp)
    check("RSVP with interest creates a prospect", s == 200 and b.get("kind") == "prospect", (s, b))
    check("the prospect is 'invited', from the invite, owned and referred by the member", sql(
        "SELECT CONCAT(stage,'|',source,'|',fk_member_master_profile_id_as_referrer,'|',fk_owner_member_id) FROM potential_members "
        f"WHERE email='n3e2e.g1@example.org' AND fk_club_id={club}") == f"invited|invite|{plain}|{plain}")
    s, b = call("POST", f"/api/public/invite/{tok}/rsvp", None, {**rsvp, "name": "E2E N3 Guest Only",
                                                                  "email": "n3e2e.g2@example.org", "interestedInJoining": False})
    check("RSVP without interest creates a guest contact", s == 200 and b.get("kind") == "contact" and sql(
        f"SELECT CONCAT(contact_type,'|',source) FROM contacts WHERE email='n3e2e.g2@example.org' AND fk_club_id={club}") == "guest|invite", (s, b))
    statuses = [call("POST", "/api/public/join", None, form)[0] for _ in range(3)]
    check("public forms are rate limited per IP (429)", 429 in statuses, statuses)

    # ── Invite prompts: schedule, cancel, send now, in-app feed ────────────────────────────────────
    meeting = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
    check("a past meeting is refused (400)", call("POST", f"{C}/invite-prompts", t_admin,
          {"meetingDate": (datetime.date.today() - datetime.timedelta(days=1)).isoformat(), "daysBefore": 1, "note": "E2E N3 old"})[0] == 400)
    check("plain member cannot schedule a prompt (403)",
          call("POST", f"{C}/invite-prompts", t_plain, {"meetingDate": meeting, "daysBefore": 1, "note": "E2E N3 x"})[0] == 403)
    s, b = call("POST", f"{C}/invite-prompts", t_admin, {"meetingDate": meeting, "daysBefore": 1, "note": "E2E N3 Guest night"})
    prompt = b["id"] if s == 200 else 0
    s, lst = call("GET", f"{C}/invite-prompts", t_admin)
    mine = next((p for p in lst if p["id"] == prompt), None) if s == 200 else None
    check("prompt scheduled for the day before the meeting", mine is not None and mine["status"] == "scheduled"
          and mine["sendOn"][:10] == (datetime.date.today() + datetime.timedelta(days=2)).isoformat(), mine)
    s, b = call("POST", f"{C}/invite-prompts", t_admin, {"meetingDate": meeting, "daysBefore": 2, "note": "E2E N3 to cancel"})
    spare = b["id"] if s == 200 else 0
    check("prompt cancelled", call("DELETE", f"{C}/invite-prompts/{spare}", t_admin)[0] == 200)
    check("cancelled prompt cannot be cancelled again (404)", call("DELETE", f"{C}/invite-prompts/{spare}", t_admin)[0] == 404)
    check("cancelled prompt cannot be sent (409)", call("POST", f"{C}/invite-prompts/{spare}/send", t_admin)[0] == 409)
    if EMAIL_SAFE:
        s, _ = call("POST", f"{C}/invite-prompts/{prompt}/send", t_admin)
        check("send now accepted", s == 200, s)
        for _ in range(60):
            if sql(f"SELECT status FROM invite_prompts WHERE pk_invite_prompt_id={prompt}") == "sent":
                break
            time.sleep(1)
        members = sql(f"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm JOIN member_master_profile m "
                      f"ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id WHERE cm.fk_club_id={club} "
                      "AND cm.IsActive=1 AND cm.isdeleted=0 AND m.isdeleted=0")
        row = sql(f"SELECT CONCAT(status,'|',sent_count) FROM invite_prompts WHERE pk_invite_prompt_id={prompt}")
        check("every active member was prompted once", row == f"sent|{members}" and sql(
            f"SELECT COUNT(*) FROM invite_prompt_log WHERE fk_invite_prompt_id={prompt}") == members, (row, members))
        check("prompt emails went through the email service (logged)", sql(
            f"SELECT COUNT(*) FROM email_log WHERE pk_id>{email_log_start} AND subject LIKE 'Bring a guest to %'") != "0")
        check("a sent prompt cannot be sent again (409)", call("POST", f"{C}/invite-prompts/{prompt}/send", t_admin)[0] == 409)
    else:
        print("SKIP send now (set ROW_E2E_EMAIL_SAFE=1 once the API runs with a dead Brevo__ApiUrl); feed tested with a log row")
        sql(f"INSERT INTO invite_prompt_log (fk_invite_prompt_id, fk_club_id, fk_member_id) VALUES ({prompt}, {club}, {plain})")
    s, b = call("GET", "/api/mobile/notifications?types=invite", t_plain)
    check("the member's in-app feed shows the invite prompt",
          s == 200 and any(i["type"] == "invite" and i["clubId"] == club for i in b["items"]), (s, b))

    set_feature(False)
    check("off again: the feed leaves invite items out",
          call("GET", "/api/mobile/notifications?types=invite", t_plain)[1]["totalCount"] == 0)
    check("off again: invite link answers 404", call("GET", f"{C}/invite-link", t_plain)[0] == 404)
    check("off again: conversion answers 404", call("POST", f"{C}/potential-members/{twin}/convert", t_admin)[0] == 404)
    s, b = call("GET", f"{C}/potential-members", t_admin)
    check("off again: the existing prospects list keeps working", s == 200, s)
finally:
    set_feature(was_on)
    cleanup()
    if old_target:
        sql(f"UPDATE club_growth_targets SET target_net_growth={old_target} WHERE fk_club_id={club} AND fk_year_id={year}")
    else:
        sql(f"DELETE FROM club_growth_targets WHERE fk_club_id={club} AND fk_year_id={year}")
    sql(f"DELETE FROM member_invite_links WHERE pk_id>{links_start} AND fk_club_id={club}")  # links made by this run

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
