"""Public privacy: new members are hidden from the public directory, the anonymous calendar names nobody, and the
governor card's contacts follow the member's flags. Existing members' flags are left exactly as they were.

    python -I kb/tools/public_privacy_defaults_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET. Local copies only, never production. Needs a club with a website row. Adds a governor
row and a district website row (removed at the end) and test members (left soft-deleted, members cannot be hard-deleted).
"""
import base64, datetime, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
assert "production" not in DB, "local copies only"
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = secrets.token_hex(3)
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:220]}"), flush=True)
    fails += 0 if ok else 1


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:200]


def flags_fingerprint(where):
    return sql(f"""SET SESSION group_concat_max_len = 16777216; SELECT COUNT(*), SUM(ShowPhoneInMyClub), SUM(ShowPhoneInAllClubs), SUM(ShowEmailInMyClub), SUM(ShowEmailInAllClubs),
        MD5(GROUP_CONCAT(CONCAT_WS(':', pk_member_master_profile_id, ShowPhoneInMyClub, ShowPhoneInAllClubs, ShowEmailInMyClub, ShowEmailInAllClubs) ORDER BY pk_member_master_profile_id))
        FROM member_master_profile WHERE {where}""")


club, district = sql("""SELECT w.fk_club_id, c.fk_district_id FROM club_websites w JOIN club_master c ON c.pk_club_id = w.fk_club_id
    WHERE w.isdeleted=0 AND c.isdeleted=0 AND c.IsActive=1 LIMIT 1""").split()
year = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 AND isdeleted=0 LIMIT 1")
outsider_club = sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND pk_club_id <> {club} LIMIT 1")
last_existing = sql("SELECT MAX(pk_member_master_profile_id) FROM member_master_profile")
existing_where = f"pk_member_master_profile_id <= {last_existing}"
before = flags_fingerprint(existing_where)
admin = sql("""SELECT r.fk_member_master_profile_id FROM member_roles r JOIN roles ro ON ro.pk_role_id = r.fk_role_id
    WHERE ro.RoleName='SuperAdmin' AND r.IsActive=1 AND r.isdeleted=0 LIMIT 1""")
SA = token(admin, ["SuperAdmin"])


def seed_member(label, on_club, flags=(1, 1)):
    today = datetime.date.today()
    m = sql(f"""INSERT INTO member_master_profile (MemberName, EmailId, PrimaryMobileNumber, BirthDate, AnniversaryDate, ShowPhoneInAllClubs, ShowEmailInAllClubs)
        VALUES ('{label} {TAG}', '{label.lower()}.{TAG}@example.invalid', '9{secrets.randbelow(10**9):09d}', '{today.replace(year=1980)}', '{today.replace(year=2005)}', {flags[0]}, {flags[1]});
        SELECT LAST_INSERT_ID();""")
    sql(f"INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive, isdeleted) VALUES ({on_club},{m},1,0)")
    return m


seeded, gov_row, site_row = [], None, None
try:
    # Decision 2: a new member, through the real add route.
    email = f"new.{TAG}@example.invalid"
    mobile = f"8{secrets.randbelow(10**9):09d}"
    code, created = call("POST", "/api/members", SA, {"memberName": f"New Member {TAG}", "emailId": email, "primaryMobileNumber": mobile})
    check("the add-member route works", code in (200, 201), (code, created))
    new_id = sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId='{email}'")
    seeded.append(new_id)
    flags = sql(f"SELECT ShowPhoneInMyClub, ShowPhoneInAllClubs, ShowEmailInMyClub, ShowEmailInAllClubs FROM member_master_profile WHERE pk_member_master_profile_id={new_id}").split()
    check("a new member: hidden outside the club, still shown inside it", flags == ['1', '0', '1', '0'], flags)
    sql(f"INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive, isdeleted) VALUES ({club},{new_id},1,0)")
    code, rows = call("GET", f"/api/public/club/{club}/directory")
    row = next((r for r in rows if str(r["memberId"]) == new_id), None)
    check("the new member is on the public directory by name", row is not None, code)
    check("their email and mobile are not", row and row["email"] is None and row["mobile"] is None, row)
    text = json.dumps(rows)
    check("the addresses appear nowhere in the answer", email not in text and mobile not in text)

    old = seed_member("Older", club)
    seeded.append(old)
    code, rows = call("GET", f"/api/public/club/{club}/directory")
    row = next((r for r in rows if str(r["memberId"]) == old), None)
    check("a member whose flags are on still shows contacts", row and row["email"] and row["mobile"], row)

    # Decision 3
    outsider = seed_member("Outsider", outsider_club)
    seeded.append(outsider)
    today = datetime.date.today()
    path = f"/api/public/club/{club}/calendar?date={today}"
    code, body = call("GET", path)
    check("anonymous calendar answers", code == 200, code)
    check("anonymous calendar names nobody", body["birthdays"] == [] and body["anniversaries"] == [], body)
    check("anonymous calendar keeps its other fields", "events" in body and "date" in body, list(body))
    check("a forged token counts as anonymous", call("GET", path, token(old, ["Member"])[:-4] + "AAAA")[1]["birthdays"] == [])
    _, body = call("GET", path, token(outsider, ["Member"]))
    check("a signed-in member of another club sees no names", body["birthdays"] == [] and body["anniversaries"] == [], body)
    _, body = call("GET", path, token(old, ["Member"]))
    check("a signed-in member of this club keeps the names",
          any(str(r["memberId"]) == old for r in body["birthdays"]) and any(str(r["memberId"]) == old for r in body["anniversaries"]), body)
    _, body = call("GET", path, SA)
    check("SuperAdmin keeps the names", any(str(r["memberId"]) == old for r in body["birthdays"]), body)

    # Decision 4
    gov = seed_member("Governor", club)
    seeded.append(gov)
    gov_email, gov_mobile = sql(f"SELECT EmailId, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id={gov}").split()
    existing_gov = sql(f"SELECT pk_id FROM district_governors WHERE fk_district_id={district} AND fk_year_id={year} AND isdeleted=0 LIMIT 1")
    assert not existing_gov, "this test needs a district with no governor this year"
    gov_row = sql(f"INSERT INTO district_governors (fk_district_id, fk_year_id, fk_member_id, member_name, isdeleted) VALUES ({district},{year},{gov},'',0); SELECT LAST_INSERT_ID();")
    if not sql(f"SELECT 1 FROM district_websites WHERE fk_district_id={district} AND isdeleted=0 LIMIT 1"):
        site_row = sql(f"INSERT INTO district_websites (fk_district_id, Subdomain, isdeleted) VALUES ({district},'e2e{TAG}',0); SELECT LAST_INSERT_ID();")
    card = lambda: call("GET", f"/api/public/club/{club}/district-governor")[1]
    dig = lambda: call("GET", f"/api/public/district/{district}/dignitaries")[1]["governor"]
    c, d = card(), dig()
    check("governor, flags on: card shows name, email, mobile", c["memberName"] and c["email"] == gov_email and c["mobileNumber"] == gov_mobile, c)
    check("governor, flags on: dignitaries shows name and email", d["name"] and d["email"] == gov_email, d)
    sql(f"UPDATE member_master_profile SET ShowPhoneInAllClubs=0, ShowEmailInAllClubs=0 WHERE pk_member_master_profile_id={gov}")
    c, d = card(), dig()
    check("governor, flags off: card keeps the name only", c["memberName"] and c["email"] is None and c["mobileNumber"] is None, c)
    check("governor, flags off: dignitaries keeps the name only", d["name"] and d["email"] is None, d)
    sql(f"UPDATE member_master_profile SET ShowPhoneInAllClubs=0, ShowEmailInAllClubs=1 WHERE pk_member_master_profile_id={gov}")
    c = card()
    check("governor: each flag works alone", c["email"] == gov_email and c["mobileNumber"] is None, c)
    sql(f"UPDATE district_governors SET fk_member_id=NULL, member_name='Guest Governor', email='guest.{TAG}@example.invalid', mobile_number='7000000000' WHERE pk_id={gov_row}")
    c = card()
    check("a governor who is not a member keeps the contacts entered for the card", c["email"] == f"guest.{TAG}@example.invalid" and c["mobileNumber"] == "7000000000", c)

    after = flags_fingerprint(existing_where)
    print(f"existing members (count, sums of the 4 flags, checksum) before: {before}")
    print(f"existing members (count, sums of the 4 flags, checksum) after:  {after}")
    check("no existing member's flags changed", before == after)
finally:
    if gov_row:
        sql(f"DELETE FROM district_governors WHERE pk_id={gov_row}")
    if site_row:
        sql(f"DELETE FROM district_websites WHERE pk_id={site_row}")
    for m in seeded:
        sql(f"UPDATE club_members SET isdeleted=1, IsActive=0 WHERE fk_member_master_profile_id={m}")
        sql(f"UPDATE member_master_profile SET isdeleted=1 WHERE pk_member_master_profile_id={m}")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
