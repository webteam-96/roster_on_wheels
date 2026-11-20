"""Account security (gap agent 2026-11-19): TOTP multi-factor sign-in (enrol with QR, recovery codes, replay and
attempt limits, club policy, SuperAdmin rule) and email magic-link sign-in (web link, app code), web and app.

    python -I kb/tools/account_security_e2e.py <api_base> <mysql_port> <database>

Environment:
  ROW_E2E_JWT_SECRET        the API's JwtSettings__Secret
  ROW_E2E_FAKE_BREVO_PORT   port of the fake Brevo server this script starts (default 5191)
  ROW_E2E_SA_MFA_REQUIRED   the API's AccountSecurity__RequireMfaForSuperAdmins (default false, the owner's choice)

Start the API with Brevo__ApiUrl=http://127.0.0.1:<brevo port>/v3/smtp/email and Brevo__ApiKey=<anything>, and
ROW_E2E_EMAIL_SAFE=1. Nothing leaves the machine: the sign-in emails go to the fake Brevo server here, which is how the
script reads the link and code. Members: club admin 1068 (club 341) and ordinary member 999. Member 1068's password
hash is swapped for a random one for the run and restored at the end; every row the run adds is removed.
The per-IP sign-in rate limit is respected by sending each step from its own X-Forwarded-For address (loopback is a
trusted proxy), and one check confirms the limit itself.
"""
import base64, hashlib, hmac, json, os, re, secrets, struct, subprocess, sys, threading, time
import urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bcrypt

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
BREVO_PORT = int(os.environ.get('ROW_E2E_FAKE_BREVO_PORT', '5191'))
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
ADMIN, MEMBER, CLUB = 1068, 999, 341
fails = 0
mails = []


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def jwt(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    s = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{s}.{b64(hmac.new(SECRET.encode(), s.encode(), hashlib.sha256).digest())}"


_ip = [0]


def new_ip():
    _ip[0] += 1
    return f"10.250.{_ip[0] // 250}.{_ip[0] % 250 + 1}"


def call(method, path, body=None, tok=None, ip=None):
    h = {"Content-Type": "application/json", "X-Forwarded-For": ip or new_ip()}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def totp(secret_b32, step):
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)


def step_now():
    return int(time.time()) // 30


class FakeBrevo(BaseHTTPRequestHandler):
    def do_POST(self):
        mails.append(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}"))
        out = json.dumps({"messageId": f"<e2e-{secrets.token_hex(4)}@local>"}).encode()
        self.send_response(201); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out)))
        self.end_headers(); self.wfile.write(out)

    def log_message(self, *a):
        pass


def mails_to(addr):
    return [m for m in mails if any(t.get("email", "").lower() == addr.lower() for t in m.get("to", []))]


def wait_mail(addr, n, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        got = mails_to(addr)
        if len(got) >= n:
            return got[n - 1]
        time.sleep(0.2)
    return None


def cleanup_rows():
    ids = f"{ADMIN},{MEMBER}"
    sql(f"DELETE FROM member_mfa_recovery_codes WHERE fk_member_id IN ({ids}); DELETE FROM member_mfa WHERE fk_member_id IN ({ids});"
        f"DELETE FROM auth_login_challenges WHERE fk_member_id IN ({ids}); DELETE FROM auth_magic_links WHERE fk_member_id IN ({ids});")


server = ThreadingHTTPServer(("127.0.0.1", BREVO_PORT), FakeBrevo)
threading.Thread(target=server.serve_forever, daemon=True).start()

cred = sql(f"SELECT pk_member_credential_id, PasswordHash, COALESCE(IsTemporaryPassword,'NULL'), COALESCE(FailedLoginAttempts,'NULL'),"
           f" COALESCE(LockoutEndTime,'NULL'), COALESCE(LastLoginDate,'NULL') FROM member_credentials"
           f" WHERE fk_member_master_profile_id={ADMIN} AND IsActive=1 AND isdeleted=0").split("\t")
policy_before = sql(f"SELECT require_mfa FROM club_security_policy WHERE fk_club_id={CLUB}")
audit_max = sql("SELECT COALESCE(MAX(pk_log_id),0) FROM login_audit_logs")
email_log_max = sql("SELECT COALESCE(MAX(pk_id),0) FROM email_log") if sql("SHOW COLUMNS FROM email_log LIKE 'pk_id'") else None
admin_email = sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={ADMIN}")
member_email = sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={MEMBER}")
password = "E2e!" + secrets.token_urlsafe(12) + "a1"


def q(v):
    return "NULL" if v == "NULL" else "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"


try:
    cleanup_rows()
    sql(f"DELETE FROM club_security_policy WHERE fk_club_id={CLUB}")
    sql(f"UPDATE member_credentials SET PasswordHash='{bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()}',"
        f" IsTemporaryPassword=0, FailedLoginAttempts=0, LockoutEndTime=NULL WHERE pk_member_credential_id={cred[0]}")
    admin_tok = jwt(ADMIN, "Admin")

    def web_login():
        return call("POST", "/api/auth/login", {"email": admin_email, "password": password})

    # 1. no MFA yet: the password login is unchanged
    s, r = web_login()
    check("password login without MFA still issues the JWT", s == 200 and r.get("token") and not r.get("mfaRequired"), (s, r))

    # 2. club policy access
    s, _ = call("GET", f"/api/account-security/club-policy/{CLUB}", tok=jwt(MEMBER, "Member"))
    check("ordinary member cannot read the club policy", s in (401, 403), s)
    s, _ = call("PUT", f"/api/account-security/club-policy/{CLUB}", {"requireMfa": True}, tok=jwt(MEMBER, "Member"))
    check("ordinary member cannot change the club policy", s in (401, 403), s)
    other = sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND pk_club_id<>{CLUB} AND pk_club_id NOT IN"
                f" (SELECT COALESCE(fk_club_id,0) FROM member_roles WHERE fk_member_master_profile_id={ADMIN}) LIMIT 1")
    s, _ = call("GET", f"/api/account-security/club-policy/{other}", tok=admin_tok)
    check("club admin cannot read another club's policy (no IDOR)", s in (401, 403), s)
    s, r = call("GET", f"/api/account-security/club-policy/{CLUB}", tok=admin_tok)
    check("club admin reads own club policy", s == 200 and r["requireMfa"] is False and r["activeMembers"] > 0, (s, r))

    # 3. enrol
    s, st = call("GET", "/api/account-security/mfa", tok=admin_tok)
    check("status: off and not required", s == 200 and not st["enabled"] and not st["required"], (s, st))
    s, setup = call("POST", "/api/account-security/mfa/enrol", tok=admin_tok)
    secret = setup.get("secret", "") if s == 200 else ""
    check("enrol returns secret, otpauth URI and QR svg", s == 200 and len(secret) >= 32 and setup["otpAuthUri"].startswith("otpauth://totp/")
          and "<svg" in setup["qrSvg"], (s, setup and list(setup)))
    stored = sql(f"SELECT COALESCE(pending_secret_protected,'') FROM member_mfa WHERE fk_member_id={ADMIN}")
    check("pending secret is stored encrypted", stored and secret not in stored, "plain secret in db")
    s, _ = call("POST", "/api/account-security/mfa/confirm", {"code": "000000" if totp(secret, step_now()) != "000000" else "111111"}, tok=admin_tok)
    check("confirm with a wrong code is refused", s == 400, s)
    st0 = step_now()
    s, r = call("POST", "/api/account-security/mfa/confirm", {"code": totp(secret, st0)}, tok=admin_tok)
    codes = r.get("recoveryCodes", []) if s == 200 else []
    check("confirm enables MFA and returns 10 recovery codes", s == 200 and len(codes) == 10, (s, r))
    hashes = sql(f"SELECT GROUP_CONCAT(code_hash) FROM member_mfa_recovery_codes WHERE fk_member_id={ADMIN}")
    check("recovery codes stored only as hashes", all(c not in hashes and c.replace('-', '') not in hashes for c in codes) and hashes.count(",") == 9, hashes[:20])

    # 4. login now needs the second factor
    s, r = web_login()
    ch = r.get("mfaToken") if s == 200 else None
    check("password login with MFA on returns a challenge, no JWT", s == 200 and r.get("mfaRequired") and ch and not r.get("token") and not r.get("mfaSetupRequired"), (s, r))
    s, _ = call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": totp(secret, st0)})
    check("replayed TOTP code is refused", s == 401, s)
    s, _ = call("POST", "/api/auth/mfa/verify", {"mfaToken": "not-a-token", "code": totp(secret, st0 + 1)})
    check("unknown challenge is refused", s == 401, s)
    s, r = call("POST", "/api/mobile/auth/mfa/verify", {"mfaToken": ch, "code": totp(secret, st0 + 1)})
    check("web challenge cannot be used on the app endpoint", s == 401, s)
    s, r = call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": totp(secret, st0 + 1)})
    web_tok = r.get("token") if s == 200 else None
    check("right code issues the normal web session", s == 200 and web_tok and r.get("memberId") == ADMIN and r.get("roles"), (s, r))
    s, r = call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": totp(secret, st0 + 1)})
    check("challenge is single use", s == 401, s)
    s, st = call("GET", "/api/account-security/mfa", tok=web_tok)
    check("issued JWT works; status shows MFA on with 10 codes", s == 200 and st["enabled"] and st["recoveryCodesLeft"] == 10, (s, st))

    # 5. recovery code
    s, r = web_login(); ch = r.get("mfaToken")
    s, r = call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": codes[0].upper()})
    check("recovery code signs in (case-insensitive)", s == 200 and r.get("token"), (s, r))
    s, r = web_login(); ch = r.get("mfaToken")
    s, _ = call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": codes[0]})
    check("used recovery code is refused", s == 401, s)

    # 6. attempt cap on a challenge (one wrong try already above)
    for _ in range(4):
        call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": "999999"})
    s, _ = call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": codes[1]})
    check("challenge dies after 5 wrong tries, even for a right code", s == 401, s)

    # 7. disable needs a code; then login is back to one step
    s, _ = call("POST", "/api/account-security/mfa/disable", {"code": "abcde-fghij"}, tok=admin_tok)
    check("disable with a wrong code is refused", s == 400, s)
    s, _ = call("POST", "/api/account-security/mfa/disable", {"code": codes[1]}, tok=admin_tok)
    check("disable with a recovery code works", s == 200, s)
    check("disable removes secret and codes", sql(f"SELECT CONCAT(enabled, COALESCE(secret_protected,'-')) FROM member_mfa WHERE fk_member_id={ADMIN}") == "0-"
          and sql(f"SELECT COUNT(*) FROM member_mfa_recovery_codes WHERE fk_member_id={ADMIN}") == "0")

    # 8. club policy forces enrolment at sign-in
    s, r = call("PUT", f"/api/account-security/club-policy/{CLUB}", {"requireMfa": True}, tok=admin_tok)
    check("club admin turns the club policy on", s == 200 and r["requireMfa"] is True, (s, r))
    s, r = web_login(); ch = r.get("mfaToken")
    check("policy: login asks to set up MFA", s == 200 and r.get("mfaRequired") and r.get("mfaSetupRequired") and not r.get("token"), (s, r))
    s, setup = call("POST", "/api/auth/mfa/setup", {"mfaToken": ch})
    secret2 = setup.get("secret", "") if s == 200 else ""
    check("login-time setup returns QR and secret", s == 200 and "<svg" in setup.get("qrSvg", "") and secret2, (s, setup and list(setup)))
    s, r = call("POST", "/api/auth/mfa/verify", {"mfaToken": ch, "code": totp(secret2, step_now())})
    codes2 = (r or {}).get("recoveryCodes") or []
    check("setup verify enables MFA, returns session and recovery codes", s == 200 and r.get("token") and len(codes2) == 10, (s, r))
    s, st = call("GET", "/api/account-security/mfa", tok=admin_tok)
    check("status shows required", s == 200 and st["required"] and st["enabled"], (s, st))
    s, _ = call("POST", "/api/account-security/mfa/disable", {"code": codes2[0]}, tok=admin_tok)
    check("required MFA cannot be turned off", s == 400, s)
    s, r = call("POST", "/api/account-security/mfa/recovery-codes", {"code": codes2[0]}, tok=admin_tok)
    codes3 = (r or {}).get("recoveryCodes") or []
    check("recovery codes regenerate (old set replaced)", s == 200 and len(codes3) == 10 and not set(codes3) & set(codes2), (s, r))
    s, r = call("PUT", f"/api/account-security/club-policy/{CLUB}", {"requireMfa": False}, tok=admin_tok)
    check("club policy turned back off; enrolment count reported", s == 200 and r["requireMfa"] is False and r["membersWithMfa"] >= 1, (s, r))
    s, _ = call("POST", "/api/account-security/mfa/disable", {"code": codes3[0]}, tok=admin_tok)
    check("after policy off the member may turn MFA off", s == 200, s)

    # 9. SuperAdmin rule follows AccountSecurity:RequireMfaForSuperAdmins (default off: optional for SuperAdmins).
    # The SuperAdmin picked is not in a club with a require_mfa policy, so only the setting decides.
    sa = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id"
             " WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 AND mr.fk_member_master_profile_id NOT IN"
             " (SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN club_security_policy p"
             "  ON p.fk_club_id = cm.fk_club_id AND p.require_mfa = 1) LIMIT 1")
    if sa:
        want = os.environ.get('ROW_E2E_SA_MFA_REQUIRED', 'false').lower() == 'true'
        s, st = call("GET", "/api/account-security/mfa", tok=jwt(sa, "SuperAdmin"))
        check(f"SuperAdmin: MFA {'required' if want else 'optional'} per setting", s == 200 and st["required"] is want, (s, st))
        s, setup = call("POST", "/api/account-security/mfa/enrol", tok=jwt(sa, "SuperAdmin"))
        check("SuperAdmin may still turn MFA on", s == 200 and setup.get("secret"), (s, setup))
        sql(f"DELETE FROM member_mfa WHERE fk_member_id={sa}")  # pending secret only; nothing was enabled

    # 10. web magic link
    s, r = call("POST", "/api/auth/magic-link", {"email": admin_email})
    mail = wait_mail(admin_email, 1)
    m = re.search(r"login\?magic=([A-Za-z0-9_\-%]+)", (mail or {}).get("htmlContent", ""))
    check("magic link: generic reply and an email with the link", s == 200 and "sign-in link" in r["message"] and m, (s, r, bool(mail)))
    link_tok = urllib.request.unquote(m.group(1)) if m else ""
    check("magic link token stored only as a hash", sql(f"SELECT COUNT(*) FROM auth_magic_links WHERE token_hash='{link_tok}'") == "0"
          and sql(f"SELECT COUNT(*) FROM auth_magic_links WHERE token_hash=SHA2('{link_tok}',256)") == "1")
    s, r = call("POST", "/api/auth/magic-link/consume", {"token": link_tok})
    check("magic link signs in (web session)", s == 200 and r.get("token") and r.get("memberId") == ADMIN, (s, r))
    s, _ = call("POST", "/api/auth/magic-link/consume", {"token": link_tok})
    check("magic link is single use", s == 401, s)
    s, _ = call("POST", "/api/auth/magic-link/consume", {"token": secrets.token_urlsafe(32)})
    check("unknown magic link refused", s == 401, s)
    sql(f"UPDATE auth_magic_links SET created_at = created_at - INTERVAL 1 HOUR WHERE fk_member_id={ADMIN}")  # free the per-member window
    call("POST", "/api/auth/magic-link", {"email": admin_email})
    mail = wait_mail(admin_email, 2)
    old = re.search(r"magic=([A-Za-z0-9_\-%]+)", (mail or {}).get("htmlContent", ""))
    old_tok = urllib.request.unquote(old.group(1)) if old else ""
    sql(f"UPDATE auth_magic_links SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE token_hash=SHA2('{old_tok}',256)")
    s, _ = call("POST", "/api/auth/magic-link/consume", {"token": old_tok})
    check("expired magic link refused", s == 401, s)
    n = len(mails_to(admin_email))
    for _ in range(3):
        call("POST", "/api/auth/magic-link", {"email": admin_email})
    time.sleep(1.5)
    check("per-member cap: at most 3 links per 15 minutes", len(mails_to(admin_email)) - n == 2, len(mails_to(admin_email)) - n)
    s, r = call("POST", "/api/auth/magic-link", {"email": f"nobody-{secrets.token_hex(4)}@example.invalid"})
    check("unknown email gets the same reply", s == 200 and "sign-in link" in r["message"], (s, r))
    s, _ = call("POST", "/api/auth/magic-link", {"email": member_email})
    time.sleep(1.5)
    check("web link is not sent to a member without web access", s == 200 and not mails_to(member_email), len(mails_to(member_email)))
    ip = new_ip()
    codes_seen = [call("POST", "/api/auth/magic-link", {"email": "x@example.invalid"}, ip=ip)[0] for _ in range(11)]
    check("per-IP rate limit answers 429 after 10 requests", codes_seen[-1] == 429 and codes_seen[0] == 200, codes_seen)

    # 11. app: sign-in code, then MFA on the app
    sql(f"UPDATE auth_magic_links SET created_at = created_at - INTERVAL 1 HOUR WHERE fk_member_id={MEMBER}")
    s, r = call("POST", "/api/mobile/auth/magic-link", {"email": member_email})
    mail = wait_mail(member_email, 1)
    mc = re.search(r">([a-z2-7]{5}-[a-z2-7]{5})<", (mail or {}).get("htmlContent", ""))
    check("app: email with a sign-in code", s == 200 and mc, (s, bool(mail)))
    code = mc.group(1) if mc else ""
    s, _ = call("POST", "/api/mobile/auth/magic-link/consume", {"email": member_email, "code": "aaaaa-aaaaa"})
    check("app: wrong code refused", s == 401, s)
    s, r = call("POST", "/api/mobile/auth/magic-link/consume", {"email": member_email, "code": code.upper()})
    m_tok = r.get("token") if s == 200 else None
    check("app: code signs in (mobile session)", s == 200 and m_tok and r.get("memberId") == MEMBER, (s, r))
    s, _ = call("POST", "/api/mobile/auth/magic-link/consume", {"email": member_email, "code": code})
    check("app: code is single use", s == 401, s)
    s, setup = call("POST", "/api/account-security/mfa/enrol", tok=m_tok)
    sec3 = setup.get("secret", "") if s == 200 else ""
    s, r = call("POST", "/api/account-security/mfa/confirm", {"code": totp(sec3, step_now())}, tok=m_tok)
    check("app: member turns MFA on from the app session", s == 200 and len(r.get("recoveryCodes", [])) == 10, (s, r))
    mcodes = r.get("recoveryCodes", []) if s == 200 else []
    call("POST", "/api/mobile/auth/magic-link", {"email": member_email})
    mail = wait_mail(member_email, 2)
    mc = re.search(r">([a-z2-7]{5}-[a-z2-7]{5})<", (mail or {}).get("htmlContent", ""))
    s, r = call("POST", "/api/mobile/auth/magic-link/consume", {"email": member_email, "code": mc.group(1) if mc else ""})
    ch = r.get("mfaToken") if s == 200 else None
    check("app: sign-in code with MFA on returns a challenge, no JWT", s == 200 and r.get("mfaRequired") and ch and not r.get("token"), (s, r))
    s, r = call("POST", "/api/mobile/auth/mfa/verify", {"mfaToken": ch, "code": mcodes[0] if mcodes else ""})
    check("app: recovery code completes sign-in (mobile session)", s == 200 and r.get("token") and r.get("memberId") == MEMBER, (s, r))
finally:
    cleanup_rows()
    sql(f"DELETE FROM club_security_policy WHERE fk_club_id={CLUB}")
    if policy_before != "":
        sql(f"INSERT INTO club_security_policy (fk_club_id, require_mfa, updated_at) VALUES ({CLUB}, {policy_before}, UTC_TIMESTAMP())")
    sql(f"UPDATE member_credentials SET PasswordHash={q(cred[1])}, IsTemporaryPassword={q(cred[2])}, FailedLoginAttempts={q(cred[3])},"
        f" LockoutEndTime={q(cred[4])}, LastLoginDate={q(cred[5])} WHERE pk_member_credential_id={cred[0]}")
    sql(f"DELETE FROM login_audit_logs WHERE pk_log_id > {audit_max} AND fk_member_id IN ({ADMIN},{MEMBER})")
    if email_log_max is not None:
        sql(f"DELETE FROM email_log WHERE pk_id > {email_log_max} AND subject = 'Your ROW sign-in link'")
    server.shutdown()
    left = sql(f"SELECT (SELECT COUNT(*) FROM member_mfa WHERE fk_member_id IN ({ADMIN},{MEMBER}))"
               f" + (SELECT COUNT(*) FROM auth_magic_links WHERE fk_member_id IN ({ADMIN},{MEMBER}))"
               f" + (SELECT COUNT(*) FROM auth_login_challenges WHERE fk_member_id IN ({ADMIN},{MEMBER}))")
    check("cleanup: no test rows left, password hash restored", left == "0" and
          sql(f"SELECT PasswordHash FROM member_credentials WHERE pk_member_credential_id={cred[0]}") == cred[1], left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
