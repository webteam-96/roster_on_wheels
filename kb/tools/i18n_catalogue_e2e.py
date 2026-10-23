"""String catalogue overrides (ROW Wave 1, task 6).

    python -I kb/tools/i18n_catalogue_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret); the SuperAdmin and a
club admin are picked by query. Local copies only, never production. Writes, reads and deletes one override for
locale fr.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def sign(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, body=None, token=None, headers=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {}),
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"[]"), dict(r.headers)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}"), dict(e.headers)
        except ValueError:
            return e.code, {}, dict(e.headers)


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


sa = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
admin = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=2 AND IsActive=1 AND isdeleted=0 "
                     "AND fk_club_id>0 ORDER BY 1 LIMIT 1")), "Admin")
path = "/api/i18n/fr/privacy/export.button"
ROW = "locale='fr' AND namespace='privacy' AND msg_key='export.button'"
had = sql(f"SELECT COUNT(*) FROM i18n_strings WHERE {ROW}") != "0"
if had:  # a real override for this key: kept aside and put back at the end
    sql(f"DROP TABLE IF EXISTS e2e_i18n_bak; CREATE TABLE e2e_i18n_bak AS SELECT * FROM i18n_strings WHERE {ROW}; DELETE FROM i18n_strings WHERE {ROW}")

try:
    s, b, _ = call("PUT", path, {"text": "Exporter mes données", "reviewed": False}, admin)
    check("a club admin cannot edit the catalogue", s == 403, (s, b))
    s, b, _ = call("PUT", path, {"text": "", "reviewed": False}, sa)
    check("an empty text is refused (a gap must fall back to English)", s == 400, (s, b))
    s, b, _ = call("PUT", "/api/i18n/fr/privacy/bad%20key!", {"text": "x"}, sa)
    check("a malformed key is refused", s == 400, (s, b))
    s, b, _ = call("PUT", path, {"text": "Exporter mes données", "reviewed": False}, sa)
    check("SuperAdmin saves an override", s == 200, (s, b))

    s, rows, h = call("GET", "/api/i18n/fr")
    row = next((r for r in rows if r.get("namespace") == "privacy" and r.get("key") == "export.button"), {}) if isinstance(rows, list) else {}
    check("anyone reads the locale's overrides", s == 200 and row.get("text") == "Exporter mes données" and row.get("reviewed") is False, (s, rows))
    etag = h.get("ETag") or h.get("Etag")
    check("the read carries an ETag and a revalidate header", bool(etag) and "no-cache" in (h.get("Cache-Control") or ""), h)
    s, _, _ = call("GET", "/api/i18n/fr", headers={"If-None-Match": etag or ""})
    check("an unchanged catalogue answers 304", s == 304, s)

    s, b, _ = call("PUT", path, {"text": "Exporter mes données", "reviewed": True}, sa)
    s, rows, h2 = call("GET", "/api/i18n/fr", headers={"If-None-Match": etag or ""})
    check("a change gives a new ETag", s == 200 and (h2.get("ETag") or h2.get("Etag")) != etag, (s, h2))
    s, b, _ = call("GET", "/api/i18n/not%20a%20locale")
    check("a malformed locale is refused", s == 400, (s, b))
finally:
    s, b, _ = call("DELETE", path, token=sa)
    check("SuperAdmin removes the override", s in (200, 204), (s, b))
    s, rows, _ = call("GET", "/api/i18n/fr")
    check("the removed override is gone", not any(r.get("key") == "export.button" for r in rows), rows)
    if had:
        sql("INSERT INTO i18n_strings SELECT * FROM e2e_i18n_bak; DROP TABLE e2e_i18n_bak")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
