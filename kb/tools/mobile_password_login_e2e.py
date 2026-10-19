"""End-to-end check of the mobile email + password sign-in (ROW, 2026-10-19).

Runs against a local ROW API and its MySQL (row_local, demo seed loaded):
    python kb/tools/mobile_password_login_e2e.py [api_base] [mysql_port]
It sets a password for a demo member through forgot-password + reset, so run it only on a dev database.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PORT = sys.argv[2] if len(sys.argv) > 2 else "3317"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MEMBER = "grace.johnson@monrovia.demo"  # demo member, no admin role, no password at seed time
fails = 0


def sql(q):
    out = subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", "row_local", "-N", "-e", q],
                         capture_output=True, text=True, check=True).stdout
    return out.strip()


def post(path, body, ip=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except ValueError:
            return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


mid = sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId='{MEMBER}'")
sql(f"DELETE FROM member_credentials WHERE fk_member_master_profile_id={mid}")
sql(f"DELETE FROM password_reset_tokens WHERE fk_member_master_profile_id={mid}")

s, b = post("/api/mobile/auth/login", {"email": MEMBER, "password": "Whatever1!"})
check("member without a password is refused with the generic message", s == 401 and b.get("message") == "Invalid email or password.", (s, b))

s, b = post("/api/mobile/auth/login", {"email": "nobody@example.org", "password": "Whatever1!"})
check("unknown email gives the same reply", s == 401 and b.get("message") == "Invalid email or password.", (s, b))

s, b = post("/api/mobile/auth/forgot-password", {"email": MEMBER})
token = sql(f"SELECT Token FROM password_reset_tokens WHERE fk_member_master_profile_id={mid} ORDER BY 1 DESC LIMIT 1")
check("forgot-password works for a plain member (reset token issued)", s == 200 and token != "", (s, b, token))

s, b = post("/api/mobile/auth/forgot-password", {"email": "nobody@example.org"})
check("forgot-password does not reveal unknown emails", s == 200, (s, b))

s, b = post("/api/auth/reset-password", {"token": token, "newPassword": "RowDemo@2026", "confirmPassword": "RowDemo@2026"})
check("reset creates the member's first password", s == 200, (s, b))

s, b = post("/api/mobile/auth/login", {"email": MEMBER, "password": "RowDemo@2026", "imei": "e2e-device", "deviceName": "Android"})
check("member signs in with email + password", s == 200 and b.get("token") and b.get("accessibleClubs"), (s, b))

s, b = post("/api/mobile/auth/login", {"email": MEMBER, "password": "wrong"})
check("wrong password is refused", s == 401, (s, b))
attempts = sql(f"SELECT FailedLoginAttempts FROM member_credentials WHERE fk_member_master_profile_id={mid} AND IsActive=1")
check("wrong password counts toward lockout", attempts == "1", attempts)

codes = [post("/api/mobile/auth/login", {"email": "rate@example.org", "password": "x"})[0] for _ in range(12)]
check("rate limit answers 429 within a minute", 429 in codes, codes)

print(f"\n{fails} failed")
sys.exit(1 if fails else 0)
