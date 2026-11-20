"""One-click GDPR erase by a club admin, with preview and typed confirmation, plus "download my data".

    python -I kb/tools/gdpr_erase_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only.
The API's web root defaults to row/api/wwwroot next to this script (ROW_E2E_WWWROOT overrides it).
Club admin: a throwaway member given only a Club Admin role on club 341 (Colombo West). Ordinary member: 999. The script erases ONLY a throwaway member it creates
itself (a former member of club 341); a second throwaway member stays active and must not be erasable by the club
admin, and a third gets a temporary District Admin role (all-clubs access) whose erasure must wait for approval.
What stays afterwards: audit_log rows (append-only by design) and the throwaway profiles and memberships,
soft-deleted (triggers refuse hard deletes); the temporary role is deleted. Their privacy requests, change-log rows, attendance and files are removed.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
WWWROOT = os.environ.get('ROW_E2E_WWWROOT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'row', 'api', 'wwwroot')
CLUB, MEMBER = 341, 999
TAG = "E2E Gdpr " + secrets.token_hex(3)
fails = 0


def sql(q, ok=True):
    r = subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q], capture_output=True, text=True)
    if not ok:
        return r.returncode, (r.stdout + r.stderr).strip()
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, raw=False):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {tok}"} if tok else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data or b"{}"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


member = token(MEMBER, "Member")
gone = active = att = da = da_role = ca = ca_role = None
photo_rel = f"Documents/directory/e2e-gdpr-{secrets.token_hex(4)}.jpg"
photo = os.path.join(WWWROOT, *photo_rel.split('/'))
export_guid = None
try:
    # A throwaway Club Admin of club 341 with no other role: 1068 can pick up extra roles in the shared copy
    # (another run once gave it a District Admin row), which would change which erase path applies.
    ca = int(sql(f"INSERT INTO member_master_profile (MemberName) VALUES ('{TAG} ClubAdmin'); SELECT LAST_INSERT_ID();"))
    ca_role = int(sql(f"""INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id)
                          VALUES ({ca}, 2, {CLUB}); SELECT LAST_INSERT_ID();"""))
    admin = token(ca, "Admin")
    os.makedirs(os.path.dirname(photo), exist_ok=True)
    with open(photo, "wb") as f:
        f.write(b"e2e")
    gone = int(sql(f"""INSERT INTO member_master_profile (MemberName, EmailId, PrimaryMobileNumber, ProfilePhotoPath)
                       VALUES ('{TAG} Left', 'e2e.gdpr.{secrets.token_hex(3)}@example.invalid', '+940000{secrets.randbelow(9999):04d}', '/{photo_rel}');
                       SELECT LAST_INSERT_ID();"""))
    active = int(sql(f"""INSERT INTO member_master_profile (MemberName, EmailId) VALUES ('{TAG} Active', 'e2e.gdpr.a.{secrets.token_hex(3)}@example.invalid');
                         SELECT LAST_INSERT_ID();"""))
    # as ClubService.RemoveMemberAsync leaves a removed member: membership soft-deleted, termination stamped
    sql(f"""INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive, TerminationDate, isdeleted)
            VALUES ({CLUB}, {gone}, 1, CURDATE() - INTERVAL 1 MONTH, 1), ({CLUB}, {active}, 1, NULL, 0)""")
    sql(f"INSERT INTO member_family_details (fk_member_master_profile_id, Name, PhoneNumber) VALUES ({gone}, '{TAG} Spouse', '+94000001111')")
    att = int(sql(f"""INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, EventDateTime, created_by, created_date)
                      VALUES ({CLUB}, 0, '{TAG} meeting', NOW() - INTERVAL 2 MONTH, 0, NOW()); SELECT LAST_INSERT_ID();"""))
    sql(f"INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id) VALUES ({att}, {gone})")
    check("setup: the profile trigger logged the test member's values", sql(f"SELECT COUNT(*) FROM member_change_log WHERE fk_member_master_profile_id={gone}") != "0")

    # Former-members list
    s, b = call("GET", f"/api/privacy/clubs/{CLUB}/former-members?q={urllib.parse.quote(TAG)}", admin)
    ids = [r.get("memberId") for r in b] if isinstance(b, list) else []
    check("club admin sees the former member", s == 200 and gone in ids, (s, b))
    check("an active member is not listed as former", active not in ids, ids)
    other = int(sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted = 0 AND pk_club_id <> {CLUB} AND fk_district_id <> (SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}) LIMIT 1"))
    s, _ = call("GET", f"/api/privacy/clubs/{other}/former-members", admin)
    check("club admin cannot list another club's former members", s == 403, s)
    s, _ = call("GET", f"/api/privacy/clubs/{CLUB}/former-members", member)
    check("an ordinary member cannot list former members", s == 403, s)

    # Preview
    s, _ = call("GET", f"/api/privacy/members/{gone}/erase-preview", member)
    check("an ordinary member cannot preview an erasure", s == 403, s)
    s, _ = call("GET", f"/api/privacy/members/{active}/erase-preview", admin)
    check("club admin cannot erase a member who is still active", s == 403, s)
    s, p = call("GET", f"/api/privacy/members/{gone}/erase-preview", admin)
    changes = {(c["table"], c["action"]): c["rows"] for c in p.get("changes", [])} if s == 200 else {}
    check("preview answers for the former member", s == 200, (s, p))
    check("preview asks for the member's name as confirmation", p.get("confirmText") == f"{TAG} Left", p.get("confirmText"))
    check("preview: club admin erasure runs at once (no approval step)", p.get("needsApproval") is False, p)
    check("preview lists the profile as anonymised", changes.get(("member_master_profile", "anonymise")) == 1, changes)
    check("preview lists attendance as kept", changes.get(("club_attendance_members", "keep")) == 1, changes)
    check("preview counts the photo to delete", p.get("files", 0) >= 1, p.get("files"))
    check("preview wrote nothing", TAG in sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={gone}"))

    # A District Admin, even with all-clubs access, only requests: a second admin must approve.
    da = int(sql(f"INSERT INTO member_master_profile (MemberName) VALUES ('{TAG} DA'); SELECT LAST_INSERT_ID();"))
    da_role = int(sql(f"""INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, AllClubsAccess)
                          SELECT {da}, 2, fk_district_id, 1 FROM club_master WHERE pk_club_id={CLUB}; SELECT LAST_INSERT_ID();"""))
    s, p = call("GET", f"/api/privacy/members/{gone}/erase-preview", token(da, "Admin"))
    check("preview tells a District Admin the erasure needs approval", s == 200 and p.get("needsApproval") is True, (s, p))
    s, b = call("POST", f"/api/privacy/members/{gone}/erase", token(da, "Admin"), {"reason": "e2e: DA request", "confirm": f"{TAG} Left"})
    check("a District Admin (all-clubs access) erasure waits for approval", s == 200 and b.get("status") == "awaiting_approval", (s, b))
    check("the pending request changed nothing", TAG in sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={gone}"))
    if b.get("id"):
        sql(f"DELETE FROM privacy_requests WHERE pk_request_id={int(b['id'])}")

    # Owner decision 2026-11-20: a club admin who also holds ANY District Admin role (here another district) needs approval.
    ca_da_role = int(sql(f"""INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id)
                             SELECT {ca}, 2, pk_district_id FROM district_master WHERE isdeleted = 0
                               AND pk_district_id <> (SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}) LIMIT 1;
                             SELECT LAST_INSERT_ID();"""))
    try:
        s, p = call("GET", f"/api/privacy/members/{gone}/erase-preview", admin)
        check("preview: club admin who is also a District Admin needs approval", s == 200 and p.get("needsApproval") is True, (s, p))
        s, b = call("POST", f"/api/privacy/members/{gone}/erase", admin, {"reason": "e2e: combined roles", "confirm": f"{TAG} Left"})
        check("club admin + District Admin erasure waits for approval", s == 200 and b.get("status") == "awaiting_approval", (s, b))
        check("that pending request changed nothing", TAG in sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={gone}"))
        if b.get("id"):
            sql(f"DELETE FROM privacy_requests WHERE pk_request_id={int(b['id'])}")
    finally:
        sql(f"DELETE FROM member_roles WHERE pk_member_role_id={ca_da_role}")

    # Erase (the club admin now holds only the Club Admin role)
    s, b = call("POST", f"/api/privacy/members/{gone}/erase", admin, {"reason": "e2e: former member asked", "confirm": "wrong name"})
    check("a wrong typed confirmation is refused", s == 400, (s, b))
    check("the refused erasure changed nothing", TAG in sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={gone}"))
    s, b = call("POST", f"/api/privacy/members/{active}/erase", admin, {"reason": "e2e", "confirm": f"{TAG} Active"})
    check("club admin erase of an active member is refused", s == 403, (s, b))
    s, b = call("POST", f"/api/privacy/members/{gone}/erase", admin, {"reason": "e2e: former member asked", "confirm": f"  {TAG.lower()}   left "})
    check("club admin erases the former member in one step", s == 200 and b.get("status") == "completed", (s, b))

    row = sql(f"SELECT CONCAT_WS('|', MemberName, IFNULL(EmailId,'-'), IFNULL(PrimaryMobileNumber,'-'), IFNULL(ProfilePhotoPath,'-'), isdeleted) FROM member_master_profile WHERE pk_member_master_profile_id={gone}")
    check("profile name, email, mobile and photo path are replaced", row == "Erased member|-|-|-|1", row)
    fam = sql(f"SELECT CONCAT_WS('|', Name, IFNULL(PhoneNumber,'-')) FROM member_family_details WHERE fk_member_master_profile_id={gone}")
    check("family rows are anonymised", fam == "Erased member|-", fam)
    check("change log holds no copy of the old values", sql(f"SELECT COUNT(*) FROM member_change_log WHERE fk_member_master_profile_id={gone}") == "0")
    check("the uploaded photo file is deleted", not os.path.exists(photo), photo)
    check("attendance is kept for the club's counts", sql(f"SELECT COUNT(*) FROM club_attendance_members WHERE fk_attendance_id={att} AND fk_member_id={gone}") == "1")
    audit = sql(f"SELECT CONCAT_WS('|', fk_member_master_profile_id, IFNULL(member_name,'-'), IFNULL(details,'')) FROM audit_log WHERE action='PRIVACY_ERASE' AND entity_id={gone} ORDER BY pk_audit_id DESC LIMIT 1")
    check("an audit row records who erased", audit.startswith(f"{ca}|-|"), audit)
    check("the audit row holds no personal data", TAG.lower() not in audit.lower() and "example.invalid" not in audit, audit)
    rid = sql(f"SELECT pk_audit_id FROM audit_log WHERE action='PRIVACY_ERASE' AND entity_id={gone} ORDER BY pk_audit_id DESC LIMIT 1")
    code, out = sql(f"UPDATE audit_log SET action='TAMPER' WHERE pk_audit_id={rid}", ok=False)
    check("the audit row cannot be changed", code != 0 and "append-only" in out, out)

    s, b = call("POST", f"/api/privacy/members/{gone}/erase", admin, {"reason": "again", "confirm": "Erased member"})
    check("erasing twice is refused", s in (400, 403), (s, b))
    s, b = call("GET", f"/api/privacy/clubs/{CLUB}/former-members?q={urllib.parse.quote(TAG)}", admin)
    check("the erased member leaves the former-members list", s == 200 and gone not in [r.get("memberId") for r in b], b)

    # Download my data (the app's "My data" screen calls this for the signed-in member)
    you = token(active, "Member")
    s, _ = call("POST", f"/api/privacy/members/{gone}/export", you)
    check("a member cannot export someone else's data", s == 403, s)
    s, b = call("POST", f"/api/privacy/members/{active}/export", you)
    check("a member exports their own data", s == 200 and b.get("status") == "completed" and b.get("downloadUrl"), (s, b))
    if b.get("downloadUrl"):
        export_guid = b["downloadUrl"].split("/exports/")[1].split("?")[0]
        path = "/api/privacy/exports/" + b["downloadUrl"].split("/exports/")[1]
        s, data = call("GET", path, raw=True)
        check("the signed link downloads a ZIP", s == 200 and isinstance(data, bytes) and data[:2] == b"PK", s)
        s, _ = call("GET", path.replace("sig=", "sig=0"), raw=True)
        check("a tampered link is refused", s == 404, s)
finally:
    for role in (da_role, ca_role):
        if role:
            sql(f"DELETE FROM member_roles WHERE pk_member_role_id={role}")
    ids = ",".join(str(i) for i in (gone, active, da, ca) if i)
    if ids:
        if att:
            sql(f"DELETE FROM club_attendance_members WHERE fk_attendance_id={att}")
            sql(f"DELETE FROM club_attendance WHERE pk_attendance_id={att}", ok=False)
            sql(f"DELETE FROM club_attendance WHERE EventName='{TAG} meeting'", ok=False)
        sql(f"DELETE FROM privacy_requests WHERE fk_member_id IN ({ids})")
        sql(f"UPDATE member_family_details SET isdeleted = 1 WHERE fk_member_master_profile_id IN ({ids})")
        sql(f"UPDATE club_members SET isdeleted = 1 WHERE fk_member_master_profile_id IN ({ids})")
        sql(f"UPDATE member_master_profile SET isdeleted = 1 WHERE pk_member_master_profile_id IN ({ids})")
        sql(f"DELETE FROM member_change_log WHERE fk_member_master_profile_id IN ({ids})")
    if os.path.exists(photo):
        os.remove(photo)
    if export_guid:
        for root in (os.path.join(WWWROOT, '..', 'App_Data', 'privacy-exports'),):
            f = os.path.join(root, export_guid + ".zip")
            if os.path.exists(f):
                os.remove(f)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
