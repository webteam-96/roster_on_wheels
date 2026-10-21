"""String catalogue overrides (ROW Wave 1, task 6).

    python kb/tools/i18n_catalogue_e2e.py [api_base]
Dev database only: writes, reads and deletes one override for locale fr. Run scope_write_guard_e2e.py first once
(it gives samuel.tubman@monrovia.demo his club admin password).
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
fails = 0


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


# SuperAdmin login from the environment (never commit real credentials): ROW_E2E_SA_EMAIL, ROW_E2E_SA_PASSWORD.
sa = call("POST", "/api/auth/login", {"email": os.environ["ROW_E2E_SA_EMAIL"], "password": os.environ["ROW_E2E_SA_PASSWORD"]})[1].get("token", "")
admin = call("POST", "/api/auth/login", {"email": "samuel.tubman@monrovia.demo", "password": os.environ["ROW_E2E_ADMIN_PASSWORD"]})[1].get("token", "")
path = "/api/i18n/fr/privacy/export.button"

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

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
