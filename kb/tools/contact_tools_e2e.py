"""Contacts export, duplicate merge and Friends of the club (gap agent, 2026-11-19).

    python -I kb/tools/contact_tools_e2e.py <api_base> <mysql_port> <database>

Environment: ROW_E2E_ADMIN_ID (a club Admin, default 1068), ROW_E2E_MEMBER_ID (an ordinary member of the same club,
default 999), and ROW_E2E_PASSWORD (both accounts' password in the local copy) or ROW_E2E_JWT_SECRET (the API's
JwtSettings__Secret; tokens are then signed here). Local copies only, never production.
Nothing is emailed: the friends list is only counted as Mass Email recipients. Everything created is removed at the
end; audit_log rows stay (append-only by design).
"""
import base64, hashlib, hmac, io, json, os, secrets, subprocess, sys, time, urllib.error, urllib.request, zipfile

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
ADMIN = int(os.environ.get('ROW_E2E_ADMIN_ID', '1068'))
MEMBER = int(os.environ.get('ROW_E2E_MEMBER_ID', '999'))
PASSWORD = os.environ.get('ROW_E2E_PASSWORD')
JWT_SECRET = os.environ.get('ROW_E2E_JWT_SECRET', '')
if not PASSWORD and not JWT_SECRET:
    sys.exit("Set ROW_E2E_PASSWORD, or ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret).")
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = "e2e" + secrets.token_hex(3)
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()


def jcall(method, path, body=None, token=None):
    s, _, b = call(method, path, body, token)
    try:
        return s, json.loads(b) if b else None
    except ValueError:
        return s, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def email(member_id):
    return sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={member_id}")


club = int(sql(f"SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={ADMIN} AND fk_role_id=2 "
               "AND IsActive=1 AND isdeleted=0 AND fk_club_id>0 LIMIT 1"))
other = int(sql(f"SELECT pk_club_id FROM club_master WHERE IsActive=1 AND isdeleted=0 AND pk_club_id<>{club} AND pk_club_id NOT IN "
                f"(SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={ADMIN} AND IsActive=1 AND isdeleted=0 "
                f"AND fk_club_id IS NOT NULL) AND fk_district_id NOT IN (SELECT fk_district_id FROM member_roles WHERE "
                f"fk_member_master_profile_id={ADMIN} AND fk_role_id=2 AND IFNULL(fk_club_id,0)=0 AND IsActive=1 AND isdeleted=0 "
                f"AND fk_district_id IS NOT NULL) LIMIT 1"))
base = f"/api/clubs/{club}/contacts"
friends_group_before = sql(f"SELECT pk_contact_group_id FROM contact_groups WHERE fk_club_id={club} AND fk_district_id=0 AND system_key='friends'")
created, group_ids, speaker_id = [], [], None

def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def mint(member_id, roles):
    """A token signed with the API's own JwtSettings__Secret (no password needed in the local copy)."""
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(JWT_SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


if PASSWORD:
    s, _, b = call("POST", "/api/auth/login", {"email": email(ADMIN), "password": PASSWORD})
    check("admin signs in", s == 200, s)
    admin = json.loads(b)["token"]
    s, _, b = call("POST", "/api/mobile/auth/login", {"email": email(MEMBER), "password": PASSWORD})
    check("member signs in (app)", s == 200, s)
    j = json.loads(b)
    member = j.get("token") or (j.get("data") or {}).get("token")
else:
    admin, member = mint(ADMIN, "Admin"), mint(MEMBER, "Member")

flag_was = sql("SELECT enabled FROM platform_features WHERE feature_key='contacts_growth'")
if flag_was != "1":
    # the shared copy may have the module switched off; on for this run, put back at the end
    sql("INSERT INTO platform_features (feature_key, enabled) VALUES ('contacts_growth', 1) ON DUPLICATE KEY UPDATE enabled=1")
    time.sleep(31)  # FeatureGate caches the switches for 30 seconds

try:
    members_count = lambda: sql(f"SELECT COUNT(*) FROM member_master_profile m JOIN member_roles r ON r.fk_member_master_profile_id="
                                f"m.pk_member_master_profile_id WHERE r.fk_club_id={club} AND r.IsActive=1 AND r.isdeleted=0 AND m.isdeleted=0")
    before = members_count()

    # ── Friends of the club ──
    s, r = jcall("POST", base, {"name": f"Friend {TAG}", "email": f"{TAG}.friend@example.invalid", "contactType": "friend"}, admin)
    check("admin adds a friend of the club", s == 200, (s, r))
    friend = r["id"]; created.append(friend)
    s, r = jcall("GET", f"{base}?type=friend&search={TAG}", token=admin)
    check("friend appears in the separate friends list", s == 200 and [c["id"] for c in r["items"]] == [friend], r)
    s, groups = jcall("GET", f"/api/clubs/{club}/contact-groups", token=admin)
    fg = next((g for g in groups or [] if g.get("systemKey") == "friends"), None)
    check("a Friends of the club list exists for emails and invites", fg is not None and fg["contactCount"] >= 1, groups)
    in_group = sql(f"SELECT COUNT(*) FROM contact_group_members WHERE fk_contact_group_id={fg['id']} AND fk_contact_id={friend}") if fg else "0"
    check("the friend is on that list", in_group == "1", in_group)
    s, r = jcall("GET", f"/api/clubs/{club}/mass-emails/recipient-count?recipientType=4&contactGroupIds={fg['id']}", token=admin)
    check("Mass Email counts the friends as recipients", s == 200 and r["membersWithEmail"] >= 1, (s, r))
    check("a friend never counts as a member", members_count() == before, (before, members_count()))
    check("no member record for the friend", sql(f"SELECT COUNT(*) FROM member_master_profile WHERE EmailId='{TAG}.friend@example.invalid'") == "0")
    s, r = jcall("PUT", f"{base}/{friend}", {"name": f"Friend {TAG}", "email": f"{TAG}.friend@example.invalid", "contactType": "guest"}, admin)
    check("friend turned into a guest", s == 200, (s, r))
    check("a guest leaves the friends list", sql(f"SELECT COUNT(*) FROM contact_group_members WHERE fk_contact_group_id={fg['id']} AND fk_contact_id={friend}") == "0")
    jcall("PUT", f"{base}/{friend}", {"name": f"Friend {TAG}", "email": f"{TAG}.friend@example.invalid", "contactType": "friend"}, admin)

    # ── Duplicates and merge ──
    s, r = jcall("POST", f"/api/clubs/{club}/contact-groups", {"name": f"Group {TAG}"}, admin)
    group_ids.append(r["id"])
    s, r = jcall("POST", base, {"name": f"Dup {TAG} Perera", "mobile": "+94 77 000 1234", "organisation": "Acme", "notes": "met at fair"}, admin)
    a = r["id"]; created.append(a)
    s, r = jcall("POST", base, {"name": f"dup {TAG}  perera", "mobile": "0770001234", "email": f"{TAG}.dup@example.invalid",
                                "contactType": "speaker", "groupIds": group_ids}, admin)
    b2 = r["id"]; created.append(b2)
    s, r = jcall("GET", f"{base}/duplicates", token=admin)
    grp = next((g for g in r or [] if a in [c["id"] for c in g["contacts"]]), None)
    check("duplicates found by phone and name", s == 200 and grp and b2 in [c["id"] for c in grp["contacts"]]
          and "Same phone" in grp["reasons"] and "Same name" in grp["reasons"], (s, grp))
    sql(f"INSERT INTO club_speakers (fk_club_id, meeting_date, name, fk_contact_id, created_by) VALUES ({club}, '2026-12-01', 'Speaker {TAG}', {b2}, {ADMIN})")
    speaker_id = sql(f"SELECT pk_speaker_id FROM club_speakers WHERE name='Speaker {TAG}'")

    s, _ = jcall("POST", f"{base}/merge", {"survivorId": a, "mergeIds": [b2]}, member)
    check("ordinary member cannot merge", s == 403, s)
    s, _ = jcall("GET", f"{base}/duplicates", token=member)
    check("ordinary member cannot see duplicates", s == 403, s)
    s, _ = jcall("GET", f"/api/clubs/{other}/contacts/duplicates", token=admin)
    check("admin of another club refused", s == 403, s)
    sql(f"INSERT INTO contacts (fk_club_id, name) VALUES ({other}, 'Foreign {TAG}')")
    foreign = int(sql(f"SELECT pk_contact_id FROM contacts WHERE name='Foreign {TAG}'"))
    created.append(foreign)
    s, _ = jcall("POST", f"{base}/merge", {"survivorId": a, "mergeIds": [foreign]}, admin)
    check("another club's contact cannot be merged in", s == 404 and sql(f"SELECT COUNT(*) FROM contacts WHERE pk_contact_id={foreign}") == "1", s)
    s, _ = jcall("POST", f"{base}/merge", {"survivorId": a, "mergeIds": [b2], "fieldSources": {"name": 999999999}}, admin)
    check("a value from outside the merge is refused", s == 400, s)

    s, r = jcall("POST", f"{base}/merge", {"survivorId": a, "mergeIds": [b2], "fieldSources": {"email": b2, "contactType": b2}}, admin)
    check("admin merges field by field", s == 200 and r["id"] == a and r["email"] == f"{TAG}.dup@example.invalid"
          and r["contactType"] == "speaker" and r["organisation"] == "Acme" and r["mobile"] == "+94 77 000 1234", (s, r))
    check("merged contact removed", sql(f"SELECT COUNT(*) FROM contacts WHERE pk_contact_id={b2}") == "0")
    check("group membership moved to the survivor", sql(f"SELECT COUNT(*) FROM contact_group_members WHERE fk_contact_id={a} AND fk_contact_group_id={group_ids[0]}") == "1")
    check("linked records moved to the survivor", sql(f"SELECT fk_contact_id FROM club_speakers WHERE pk_speaker_id={speaker_id}") == str(a))
    s, r = jcall("GET", f"{base}/{a}/merge-history", token=admin)
    check("merge history keeps the merged contact", s == 200 and len(r) == 1 and r[0]["mergedContactId"] == b2
          and r[0]["merged"]["name"] == f"dup {TAG}  perera", (s, r))

    # ── Export ──
    s, ctype, x = call("GET", f"{base}/export?format=xlsx&search={TAG}", token=admin)
    ok = s == 200 and "spreadsheetml" in ctype and x[:2] == b"PK"
    strings = zipfile.ZipFile(io.BytesIO(x)).read("xl/sharedStrings.xml").decode() if ok else ""
    check("admin downloads Excel with the contacts", ok and f"Friend {TAG}" in strings and "Friend of the club" in strings, (s, ctype))
    s, ctype, c = call("GET", f"{base}/export?format=csv&type=friend&search={TAG}", token=admin)
    text = c.decode("utf-8-sig") if s == 200 else ""
    lines = [l for l in text.split("\r\n") if l]
    check("admin downloads CSV filtered to friends", s == 200 and ctype.startswith("text/csv") and c[:3] == b"\xef\xbb\xbf"
          and lines[0].startswith("Name,Type,Email") and len(lines) == 2 and f"Friend {TAG}" in lines[1], (s, lines))
    s, _, _ = call("GET", f"{base}/export?format=pdf", token=admin)
    check("unknown format refused", s == 400, s)
    s, _, _ = call("GET", f"{base}/export?format=csv", token=member)
    check("ordinary member cannot export", s == 403, s)
    s, _, _ = call("GET", f"{base}/export?format=csv")
    check("anonymous cannot export", s == 401, s)
    check("export written to audit_log", sql(f"SELECT COUNT(*) FROM audit_log WHERE action='EXPORT' AND entity_type='club_contacts' "
                                             f"AND entity_id={club} AND fk_member_master_profile_id={ADMIN}") != "0")
finally:
    if flag_was == "0":
        sql("UPDATE platform_features SET enabled=0 WHERE feature_key='contacts_growth'")
    elif flag_was == "":
        sql("DELETE FROM platform_features WHERE feature_key='contacts_growth'")
    ids =",".join(str(i) for i in created) or "0"
    sql(f"DELETE FROM contact_merge_log WHERE fk_survivor_contact_id IN ({ids}); DELETE FROM contact_group_members WHERE fk_contact_id IN ({ids});"
        f"DELETE FROM contacts WHERE pk_contact_id IN ({ids});")
    if speaker_id:
        sql(f"DELETE FROM club_speakers WHERE pk_speaker_id={speaker_id}")
    for g in group_ids:
        sql(f"DELETE FROM contact_group_members WHERE fk_contact_group_id={g}; DELETE FROM contact_groups WHERE pk_contact_group_id={g}")
    if not friends_group_before:
        g = sql(f"SELECT pk_contact_group_id FROM contact_groups WHERE fk_club_id={club} AND fk_district_id=0 AND system_key='friends'")
        if g:
            sql(f"DELETE FROM contact_group_members WHERE fk_contact_group_id={g}; DELETE FROM contact_groups WHERE pk_contact_group_id={g}")
    left = sql(f"SELECT COUNT(*) FROM contacts WHERE name LIKE '%{TAG}%'")
    check("test rows cleaned up", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
