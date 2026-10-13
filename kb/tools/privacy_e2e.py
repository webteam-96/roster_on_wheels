"""End-to-end check of the ROW privacy API (master plan WS7) against a running API and its test database.

Needs: test users (password RowTest@2026) admin@row.test (SuperAdmin), da1@row.test and da2@row.test
(District Admins of the test member's district), pat@row.test (the member), and the API started with
Brand__Legal__PolicyVersion=2026-11. Members sign in through the app (one-time code), so the member's
token is passed in. Run: python -I privacy_e2e.py <api base> <mysql cmd JSON list> <member token>
"""
import io
import json
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

BASE, MYSQL, MEMBER_TOKEN = sys.argv[1].rstrip("/"), json.loads(sys.argv[2]), sys.argv[3]
failures = []


def call(method, path, token=None, body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data or b"null"))
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data or b"null")
        except ValueError:
            return e.code, data.decode(errors="replace")


def sql(q):
    out = subprocess.run(MYSQL + ["-N", "-e", q], capture_output=True, text=True)
    return out.stdout.strip()


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def login(email):
    s, d = call("POST", "/api/auth/login", body={"email": email, "password": "RowTest@2026"})
    assert s == 200, (email, s, d)
    return d["token"]


admin, da1, da2 = (login(e) for e in ["admin@row.test", "da1@row.test", "da2@row.test"])
pat = MEMBER_TOKEN
member = int(sql("SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId='pat@row.test'"))
district = int(sql(f"SELECT c.fk_district_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id WHERE cm.fk_member_master_profile_id={member} LIMIT 1"))

# Consent (WS7-05)
s, d = call("GET", "/api/privacy/consent", pat)
check("consent required before acceptance", s == 200 and d["required"] is True and d["policyVersion"] == "2026-11", d)
s, d = call("POST", "/api/privacy/consent", pat, {"policyVersion": "1999-01", "language": "en"})
check("wrong policy version refused", s == 400, d)
s, _ = call("POST", "/api/privacy/consent", pat, {"policyVersion": "2026-11", "language": "fr"})
s2, d = call("GET", "/api/privacy/consent", pat)
check("consent recorded", s == 200 and d["required"] is False and d["acceptedVersion"] == "2026-11", d)

# Language (WS2-03)
s, _ = call("PUT", "/api/members/me/language", pat, {"language": "pt-BR"})
check("language stored", s == 200 and sql(f"SELECT PrimaryLanguage FROM member_master_profile WHERE pk_member_master_profile_id={member}") == "pt-BR")
s, _ = call("PUT", "/api/members/me/language", pat, {"language": "x; DROP"})
check("bad language refused", s == 400)

# Export (WS7-02)
s, d = call("POST", f"/api/privacy/members/{member}/export", pat)
check("member exports own data", s == 200 and d["status"] == "completed" and d["downloadUrl"], d)
s, z = call("GET", d["downloadUrl"].replace(BASE, ""), raw=True)
names = zipfile.ZipFile(io.BytesIO(z)).namelist() if s == 200 else []
check("export ZIP downloads with the signed link", s == 200 and "member_master_profile.json" in names and "README.txt" in names, names)
check("export holds family and email log", "member_family_details.json" in names and "email_log.by-email.json" in names, names)
check("export leaves out password hashes", "member_credentials.json" not in names, names)
s, _ = call("GET", d["downloadUrl"].replace(BASE, "").replace("sig=", "sig=0"), raw=True)
check("tampered link refused", s == 404)
s, _ = call("POST", f"/api/privacy/members/{member}/export", da2)
check("district admin may export", s == 200)

# Listing and permissions
s, d = call("GET", f"/api/privacy/requests?districtId={district}", da1)
check("district admin lists requests", s == 200 and len(d) >= 2, d)
s, _ = call("GET", f"/api/privacy/requests?districtId={district}", pat)
check("plain member cannot list requests", s == 403)

# Erasure (WS7-03): DA requests, the same DA cannot approve, a second DA approves
s, d = call("POST", f"/api/privacy/members/{member}/erase", pat, {"reason": "test"})
check("member cannot erase", s == 403)
s, d = call("POST", f"/api/privacy/members/{member}/erase", da1, {"reason": "Member asked to be forgotten"})
check("DA erasure waits for approval", s == 200 and d["status"] == "awaiting_approval", d)
rid = d["id"]
s, _ = call("POST", f"/api/privacy/requests/{rid}/approve", da1)
check("requesting DA cannot approve own erasure", s == 403)
s, d = call("POST", f"/api/privacy/requests/{rid}/approve", da2)
check("second DA approves, erasure completes", s == 200 and d["status"] == "completed", d)

row = sql(f"SELECT MemberName, IFNULL(EmailId,'-'), IFNULL(PrimaryMobileNumber,'-'), IFNULL(RotaryId,'-'), IFNULL(BloodGroup,'-'), isdeleted FROM member_master_profile WHERE pk_member_master_profile_id={member}")
check("profile anonymised", row.split("\t") == ["Erased member", "-", "-", "-", "-", "1"], row)
check("credentials deleted", sql(f"SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id={member}") == "0")
check("family blanked and soft-deleted", sql(f"SELECT COUNT(*) FROM member_family_details WHERE fk_member_master_profile_id={member} AND (isdeleted = 0 OR EmailId IS NOT NULL OR Name <> 'Erased member')") == "0")
check("email log scrubbed", sql("SELECT COUNT(*) FROM email_log WHERE recipient_email='pat@row.test' OR body_html LIKE '%Pat%'") == "0")
check("tombstone written", sql("SELECT COUNT(*) FROM member_erasure_tombstone") == "1")
check("no former email anywhere in the registry's main tables",
      sql("SELECT (SELECT COUNT(*) FROM member_master_profile WHERE EmailId='pat@row.test') + (SELECT COUNT(*) FROM email_log WHERE recipient_email='pat@row.test') + (SELECT COUNT(*) FROM member_family_details WHERE EmailId='sam@row.test')") == "0")

# Registry audit (WS7-01)
s, d = call("GET", "/api/privacy/registry/unlisted", admin)
check("registry audit answers for SuperAdmin", s == 200 and isinstance(d, list), d)
print(f"unlisted tables with personal-looking columns: {len(d) if isinstance(d, list) else '?'}")
if isinstance(d, list):
    for t in d:
        print(f"   {t['table']}: {', '.join(t['columns'])}")
s, _ = call("GET", "/api/privacy/registry/unlisted", da1)
check("registry audit refused for non-SuperAdmin", s == 403)

print(f"\n{len(failures)} failure(s)" + (": " + "; ".join(failures) if failures else ""))
sys.exit(1 if failures else 0)
