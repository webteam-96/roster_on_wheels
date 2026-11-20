"""WordPress connector (gap agent, 2026-11-20): website API keys (hashed, revocable, scoped, rate limited) and the
read-only connector endpoints the WordPress plugin (row/integrations/wordpress/row-connector) calls.

    python -I kb/tools/wordpress_connector_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Uses club admin 1068
(club 341), ordinary member 999 and the first SuperAdmin. Writes to the given LOCAL database only: key rows labelled
e2e-wp* and one club_documents row titled e2e-wp-doc, all removed at the end. Reads real member rows but never
changes them. Run it last in a batch: the final check spends this IP's connector rate-limit bucket for a minute.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, PLAIN = 341, 1068, 999
CONN = "/api/public/connector/v1"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(v) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, key=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    if key is not None:
        headers["X-ROW-Key"] = key
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        payload, status = e.read(), e.code
    try:
        return status, json.loads(payload) if payload else None
    except ValueError:
        return status, payload


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


district = one(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}")
other_club = one(f"SELECT pk_club_id FROM club_master WHERE pk_club_id<>{CLUB} AND isdeleted=0 AND IsActive=1 LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
t_admin, t_plain, t_sa = token(ADMIN, "Admin"), token(PLAIN, "Member"), token(sa, "SuperAdmin")
KEYS = f"/api/clubs/{CLUB}/website-api"
doc_id = None

try:
    # ── access to key management ──
    check("anonymous cannot list keys", call("GET", f"{KEYS}/keys")[0] == 401)
    r = call("GET", f"{KEYS}/keys", t_plain)
    check("ordinary member cannot list keys", r[0] == 403, r)
    r = call("GET", f"/api/clubs/{other_club}/website-api/keys", t_admin)
    check("club admin cannot list another club's keys (IDOR)", r[0] == 403, r)
    r = call("POST", f"{KEYS}/keys", t_admin, {"label": "  "})
    check("empty label rejected", r[0] == 400, r)
    r = call("POST", f"{KEYS}/keys", t_admin, {"label": "x" * 101})
    check("over-long label rejected", r[0] == 400, r)

    # ── create, hashed at rest ──
    r = call("POST", f"{KEYS}/keys", t_admin, {"label": "e2e-wp club"})
    check("club admin creates a key", r[0] == 200 and r[1]["key"].startswith("rowk_"), r)
    key = r[1]["key"]
    key_id = r[1]["item"]["id"]
    stored = sql(f"SELECT CONCAT(key_hash,'|',key_prefix) FROM website_api_keys WHERE pk_website_api_key_id={key_id}")
    check("only the SHA-256 hash and a short prefix are stored",
          stored == hashlib.sha256(key.encode()).hexdigest() + "|" + key[:12], stored)
    r = call("GET", f"{KEYS}/keys", t_admin)
    listed = json.dumps(r[1])
    check("key list shows the key without the secret", r[0] == 200 and key[:12] in listed and key not in listed, r)

    # ── connector reads ──
    check("connector without key -> 401", call("GET", f"{CONN}/events")[0] == 401)
    check("connector with unknown key -> 401", call("GET", f"{CONN}/events", key="rowk_" + "A" * 43)[0] == 401)
    check("connector with junk key -> 401", call("GET", f"{CONN}/events", key="' OR 1=1 --")[0] == 401)
    r = call("GET", f"{CONN}/site", key=key)
    check("key resolves to its club", r[0] == 200 and r[1] == {"scope": "club", "id": CLUB}, r)
    check("site ignores query params trying to widen scope",
          call("GET", f"{CONN}/site?clubId={other_club}", key=key)[1] == {"scope": "club", "id": CLUB})
    for kind in ("events", "officers", "news", "projects", "documents"):
        r = call("GET", f"{CONN}/{kind}?limit=5", key=key)
        check(f"{kind} returns a list", r[0] == 200 and isinstance(r[1], list), r)
        if kind in ("events", "news", "projects"):
            check(f"{kind} honours limit", len(r[1]) <= 5, len(r[1]))
    check("last_used_utc recorded", one(f"SELECT last_used_utc IS NOT NULL FROM website_api_keys WHERE pk_website_api_key_id={key_id}") == 1)

    # ── directory: never any email or phone ──
    r = call("GET", f"{CONN}/directory", key=key)
    check("club directory lists members", r[0] == 200 and r[1]["kind"] == "members" and len(r[1]["items"]) > 0, r)
    items = r[1]["items"]
    fields = sorted({k for it in items for k in it})
    check("directory carries only name, photo, classification", fields == ["classification", "name", "photoPath"], fields)
    contacts = set(sql(f"""SELECT x FROM (SELECT m.EmailId AS x FROM club_members cm JOIN member_master_profile m
        ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id WHERE cm.fk_club_id={CLUB} AND cm.isdeleted=0
        UNION SELECT m.PrimaryMobileNumber FROM club_members cm JOIN member_master_profile m
        ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id WHERE cm.fk_club_id={CLUB} AND cm.isdeleted=0) t
        WHERE x IS NOT NULL AND LENGTH(x) > 4""").splitlines())
    # every connector response this key can fetch: no member email or phone anywhere in it
    bodies = "".join(json.dumps(call("GET", f"{CONN}/{k}?limit=50", key=key)[1])
                     for k in ("directory", "officers", "events", "news", "projects", "documents"))
    leaked = [c for c in contacts if c in bodies]
    check("no member email or phone in any connector response", not leaked and "@" not in json.dumps(items),
          f"{len(leaked)} leaked")
    print(f"     ({len(items)} members listed, {len(contacts)} contact values checked)")

    # ── documents: public only when the admin says so ──
    sql(f"""INSERT INTO club_documents (fk_club_id, fk_district_id, Title, AccessType, FilePath, OriginalFileName,
        PublishDateTime, ExpiryDateTime, created_by, created_date, isdeleted)
        VALUES ({CLUB}, NULL, 'e2e-wp-doc', 'downloadable', 'e2e-wp.pdf', 'e2e-wp.pdf',
        UTC_TIMESTAMP() - INTERVAL 1 DAY, UTC_TIMESTAMP() + INTERVAL 30 DAY, {ADMIN}, NOW(), 0)""")
    doc_id = one("SELECT MAX(pk_document_id) FROM club_documents WHERE Title='e2e-wp-doc'")
    titles = lambda: [d["title"] for d in call("GET", f"{CONN}/documents", key=key)[1]]
    check("new document is not public by default", "e2e-wp-doc" not in titles())
    r = call("GET", f"{KEYS}/documents", t_admin)
    check("admin sees the document with its switch off",
          r[0] == 200 and any(d["id"] == doc_id and d["isPublicOnWebsite"] is False for d in r[1]), r)
    r = call("PUT", f"/api/clubs/{other_club}/website-api/documents/{doc_id}", t_admin, {"isPublic": True})
    check("admin cannot switch another club's scope (IDOR)", r[0] == 403, r)
    r = call("PUT", f"{KEYS}/documents/{doc_id}", t_plain, {"isPublic": True})
    check("ordinary member cannot switch a document", r[0] == 403, r)
    r = call("PUT", f"{KEYS}/documents/{doc_id}", t_admin, {"isPublic": True})
    check("admin marks the document public", r[0] == 200, r)
    check("public document now listed", "e2e-wp-doc" in titles())
    docs = call("GET", f"{CONN}/documents", key=key)[1]
    check("document link points at the club's folder",
          any(d["filePath"] == f"/Documents/documentsafe/Group{CLUB}/e2e-wp.pdf" for d in docs), docs)
    other_doc = one(f"SELECT pk_document_id FROM club_documents WHERE fk_club_id<>{CLUB} AND isdeleted=0 LIMIT 1")
    if other_doc:
        r = call("PUT", f"{KEYS}/documents/{other_doc}", t_admin, {"isPublic": True})
        check("another club's document id under my scope -> 404", r[0] == 404, r)
    call("PUT", f"{KEYS}/documents/{doc_id}", t_admin, {"isPublic": False})
    check("switching off hides it again", "e2e-wp-doc" not in titles())

    # ── district key (SuperAdmin) ──
    r = call("POST", f"/api/districts/{district}/website-api/keys", t_sa, {"label": "e2e-wp district"})
    check("SuperAdmin creates a district key", r[0] == 200, r)
    dkey = r[1]["key"]
    check("district key resolves to its district",
          call("GET", f"{CONN}/site", key=dkey)[1] == {"scope": "district", "id": district})
    r = call("GET", f"{CONN}/directory", key=dkey)
    check("district directory lists clubs",
          r[0] == 200 and r[1]["kind"] == "clubs" and any(c["id"] == CLUB for c in r[1]["items"]), r)
    r = call("GET", f"{CONN}/officers", key=dkey)
    check("district officers returns a list", r[0] == 200 and isinstance(r[1], list), r)
    r = call("POST", f"/api/districts/{district}/website-api/keys", t_admin, {"label": "e2e-wp nope"})
    check("club admin cannot create a district key", r[0] == 403, r)

    # ── revoke ──
    r = call("DELETE", f"/api/clubs/{other_club}/website-api/keys/{key_id}", t_sa)
    check("revoking under the wrong scope -> 404", r[0] == 404, r)
    r = call("DELETE", f"{KEYS}/keys/{key_id}", t_admin)
    check("admin revokes the key", r[0] == 200, r)
    check("revoked key -> 401", call("GET", f"{CONN}/events", key=key)[0] == 401)
    check("revoking twice -> 404", call("DELETE", f"{KEYS}/keys/{key_id}", t_admin)[0] == 404)

    # ── rate limit (last: spends this IP's bucket) ──
    codes = [call("GET", f"{CONN}/site", key=dkey)[0] for _ in range(130)]
    check("connector is rate limited (429 after 120 a minute)", 429 in codes, codes[-5:])
finally:
    sql("DELETE FROM website_api_keys WHERE label LIKE 'e2e-wp%'")
    sql("DELETE FROM club_documents WHERE Title='e2e-wp-doc'")
    left = one("SELECT (SELECT COUNT(*) FROM website_api_keys WHERE label LIKE 'e2e-wp%')"
               " + (SELECT COUNT(*) FROM club_documents WHERE Title='e2e-wp-doc')")
    check("test rows removed", left == 0, left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
