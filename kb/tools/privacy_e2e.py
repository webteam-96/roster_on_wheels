"""End-to-end check of the ROW privacy API (master plan WS7): consent, language, export, erasure, registry audit.

    python -I kb/tools/privacy_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only,
never production. Real members are never erased: the run creates a throwaway member (fake name and email, an unused Rotary id)
in the first club, with a family row and an email log row, and two temporary District Admin roles on real members of
no other admin role for that club's district; the SuperAdmin is picked by query. Consent is checked against the
policy version the API runs with (Brand__Legal__PolicyVersion; with none set, acceptance must be refused).
Cleanup: the temporary roles, the throwaway member's privacy requests, consents, tombstone, test email log row,
change-log rows and export files go. What stays: the erased, soft-deleted throwaway member with his club and family
rows (hard deletes are refused by triggers) and the audit rows (append-only by design).
"""
import base64, hashlib, hmac, io, json, os, secrets, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, zipfile

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
EXPORTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'row', 'api', 'App_Data', 'privacy-exports')
failures = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def sign(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, token=None, body=None, raw=False):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data or b"null"))
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data or b"null")
        except ValueError:
            return e.code, data.decode(errors="replace")


def local(url):
    """The signed download link, made relative: the API may name another host (BackendUrl / brand origin)."""
    u = urllib.parse.urlsplit(url or "")
    return u.path + ("?" + u.query if u.query else "")


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        failures.append(name)


run = secrets.token_hex(4)
name, email, family_email = f"E2E Privacy {run}", f"e2e.privacy.{run}@example.invalid", f"e2e.family.{run}@example.invalid"
reason = f"e2e privacy {run}"
# numeric like a real Rotary id (two cache tables keep it as a number) and used nowhere, so the erasure touches no real row
while True:
    rotary_id = str(9 * 10**14 + secrets.randbelow(10**14))
    if sql(f"SELECT (SELECT COUNT(*) FROM member_master_profile WHERE RotaryId='{rotary_id}') + (SELECT COUNT(*) FROM rotary_org_club_members_cache "
           f"WHERE RotaryMemberId={rotary_id}) + (SELECT COUNT(*) FROM rotary_org_terminated_cache WHERE RotaryMemberId={rotary_id}) + "
           f"(SELECT COUNT(*) FROM sync_exception_log WHERE rotary_id='{rotary_id}')") == "0":
        break
club, district = [int(x) for x in sql("SELECT pk_club_id, fk_district_id FROM club_master WHERE isdeleted=0 AND fk_district_id>0 ORDER BY 1 LIMIT 1").split()]
sa_id = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
da_ids = [int(x) for x in sql("SELECT pk_member_master_profile_id FROM member_master_profile WHERE isdeleted=0 AND pk_member_master_profile_id NOT IN "
                              "(SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id IN (2,3) AND IsActive=1 AND isdeleted=0) "
                              "ORDER BY 1 LIMIT 2").split()]
role_ids = [sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, AssignedBy) VALUES ({d}, 2, {district}, {sa_id}); "
                "SELECT LAST_INSERT_ID()") for d in da_ids]
member = int(sql(f"INSERT INTO member_master_profile (MemberName, EmailId, RotaryId) VALUES ('{name}', '{email}', '{rotary_id}'); SELECT LAST_INSERT_ID()"))
log_ids = []
try:
    sql(f"INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive) VALUES ({club}, {member}, 1); "
        f"INSERT INTO member_family_details (fk_member_master_profile_id, Name, EmailId) VALUES ({member}, 'E2E Family {run}', '{family_email}')")
    log_ids.append(sql(f"INSERT INTO email_log (recipient_email, subject, body_html, status) VALUES ('{email}', 'e2e', '<p>Dear {name}</p>', 'Sent'); "
                       "SELECT LAST_INSERT_ID()"))
    admin, da1, da2, pat = sign(sa_id, "SuperAdmin"), sign(da_ids[0], "Admin"), sign(da_ids[1], "Admin"), sign(member, "Member")

    # Consent (WS7-05): against whatever policy version this API runs with
    s, d = call("GET", "/api/privacy/consent", pat)
    version = (d or {}).get("policyVersion") or ""
    if version:
        check("consent required before acceptance", s == 200 and d["required"] is True, d)
        s, d = call("POST", "/api/privacy/consent", pat, {"policyVersion": "1999-01", "language": "en"})
        check("wrong policy version refused", s == 400, d)
        s, _ = call("POST", "/api/privacy/consent", pat, {"policyVersion": version, "language": "fr"})
        s2, d = call("GET", "/api/privacy/consent", pat)
        check("consent recorded", s == 200 and d["required"] is False and d["acceptedVersion"] == version, d)
    else:
        check("no consent asked while no policy version is set", s == 200 and d["required"] is False, d)
        s, d = call("POST", "/api/privacy/consent", pat, {"policyVersion": "2026-11", "language": "en"})
        check("accepting is refused while no policy version is set", s == 400, d)

    # Language (WS2-03)
    s, _ = call("PUT", "/api/members/me/language", pat, {"language": "pt-BR"})
    check("language stored", s == 200 and sql(f"SELECT PrimaryLanguage FROM member_master_profile WHERE pk_member_master_profile_id={member}") == "pt-BR")
    s, _ = call("PUT", "/api/members/me/language", pat, {"language": "x; DROP"})
    check("bad language refused", s == 400)

    # Export (WS7-02)
    s, d = call("POST", f"/api/privacy/members/{member}/export", pat)
    check("member exports own data", s == 200 and d["status"] == "completed" and d["downloadUrl"], (s, (d or {}).get("status")))
    link = local(d.get("downloadUrl") if isinstance(d, dict) else "")
    s, z = call("GET", link, raw=True)
    names = zipfile.ZipFile(io.BytesIO(z)).namelist() if s == 200 else []
    check("export ZIP downloads with the signed link", s == 200 and "member_master_profile.json" in names and "README.txt" in names, names)
    check("export holds family and email log", "member_family_details.json" in names and "email_log.by-email.json" in names, names)
    check("export leaves out password hashes", "member_credentials.json" not in names, names)
    s, _ = call("GET", link.replace("sig=", "sig=0"), raw=True)
    check("tampered link refused", s == 404)
    s, _ = call("POST", f"/api/privacy/members/{member}/export", da2)
    check("district admin may export", s == 200)

    # Listing and permissions
    s, d = call("GET", f"/api/privacy/requests?districtId={district}", da1)
    mine = [r for r in d if r.get("memberId") == member] if isinstance(d, list) else []
    check("district admin lists requests", s == 200 and len(mine) >= 2, (s, len(mine)))
    s, _ = call("GET", f"/api/privacy/requests?districtId={district}", pat)
    check("plain member cannot list requests", s == 403)

    # Erasure (WS7-03): DA requests, the same DA cannot approve, a second DA approves
    s, d = call("POST", f"/api/privacy/members/{member}/erase", pat, {"reason": "test"})
    check("member cannot erase", s == 403)
    s, d = call("POST", f"/api/privacy/members/{member}/erase", da1, {"reason": reason})
    check("DA erasure waits for approval", s == 200 and d["status"] == "awaiting_approval", (s, (d or {}).get("status")))
    rid = d.get("id") if isinstance(d, dict) else None
    s, _ = call("POST", f"/api/privacy/requests/{rid}/approve", da1)
    check("requesting DA cannot approve own erasure", s == 403)
    s, d = call("POST", f"/api/privacy/requests/{rid}/approve", da2)
    check("second DA approves, erasure completes", s == 200 and d["status"] == "completed", (s, (d or {}).get("status")))

    row = sql(f"SELECT MemberName, IFNULL(EmailId,'-'), IFNULL(PrimaryMobileNumber,'-'), IFNULL(RotaryId,'-'), IFNULL(BloodGroup,'-'), isdeleted FROM member_master_profile WHERE pk_member_master_profile_id={member}")
    check("profile anonymised", row.split("\t") == ["Erased member", "-", "-", "-", "-", "1"], row)
    check("credentials deleted", sql(f"SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id={member}") == "0")
    check("family blanked and soft-deleted", sql(f"SELECT COUNT(*) FROM member_family_details WHERE fk_member_master_profile_id={member} AND (isdeleted = 0 OR EmailId IS NOT NULL OR Name <> 'Erased member')") == "0")
    check("email log scrubbed", sql(f"SELECT COUNT(*) FROM email_log WHERE recipient_email='{email}' OR body_html LIKE '%{name}%'") == "0")
    check("tombstone written", sql(f"SELECT COUNT(*) FROM member_erasure_tombstone WHERE reason='{reason}'") == "1")
    check("no former email anywhere in the registry's main tables",
          sql(f"SELECT (SELECT COUNT(*) FROM member_master_profile WHERE EmailId='{email}') + (SELECT COUNT(*) FROM email_log WHERE recipient_email='{email}') "
              f"+ (SELECT COUNT(*) FROM member_family_details WHERE EmailId='{family_email}')") == "0")

    # Registry audit (WS7-01)
    s, d = call("GET", "/api/privacy/registry/unlisted", admin)
    check("registry audit answers for SuperAdmin", s == 200 and isinstance(d, list), d)
    print(f"unlisted tables with personal-looking columns: {len(d) if isinstance(d, list) else '?'}")
    if isinstance(d, list):
        for t in d:
            print(f"   {t['table']}: {', '.join(t['columns'])}")
    s, _ = call("GET", "/api/privacy/registry/unlisted", da1)
    check("registry audit refused for non-SuperAdmin", s == 403)
finally:
    guids = sql(f"SELECT IFNULL(GROUP_CONCAT(export_guid), '') FROM privacy_requests WHERE fk_member_id={member} AND export_guid IS NOT NULL")
    for g in filter(None, guids.split(",")):
        path = os.path.join(EXPORTS, f"{g}.zip")
        if os.path.isfile(path):
            os.remove(path)
    sql(f"DELETE FROM member_roles WHERE pk_member_role_id IN ({','.join(role_ids)}); "
        f"DELETE FROM privacy_requests WHERE fk_member_id={member}; DELETE FROM member_consents WHERE fk_member_id={member}; "
        f"DELETE FROM member_erasure_tombstone WHERE reason='{reason}'; "
        + (f"DELETE FROM email_log WHERE pk_id IN ({','.join(log_ids)}); " if log_ids else "")
        # if a check stopped the run before the erasure, the throwaway member must not stay visible in the club
        + f"UPDATE club_members SET isdeleted=1 WHERE fk_member_master_profile_id={member}; "
        f"UPDATE member_family_details SET isdeleted=1 WHERE fk_member_master_profile_id={member}; "
        f"UPDATE member_master_profile SET isdeleted=1 WHERE pk_member_master_profile_id={member}; "
        f"DELETE FROM member_change_log WHERE fk_member_master_profile_id={member}")

print(f"\n{len(failures)} failure(s)" + (": " + "; ".join(failures) if failures else ""))
sys.exit(1 if failures else 0)
