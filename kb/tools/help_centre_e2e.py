"""Help centre (competitor gap 2026-11-19): public index, search, article with related articles, "was this helpful",
contextual lookup for admin pages, translation through translation memory, and Super Admin editing (draft / publish,
sanitizing, slug conflicts, validation, role gating).

    python -I kb/tools/help_centre_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Writes to the given
LOCAL database only and removes its rows at the end (one category, its articles, one translation_memory row, and the
feedback count it adds to a seeded article). audit_log rows stay: that table is append-only by design.
Never run it against production. Sends no email.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MARK = 'e2e-help'
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
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


SA = token(1, "SuperAdmin")
MEMBER = token(999, "Member")
cat_slug, art_slug = f"{MARK}-cat", f"{MARK}-article"
title = f"{MARK} How to test the help centre"
q = urllib.parse.quote

# Leftovers from an aborted run
sql(f"DELETE FROM help_articles WHERE slug LIKE '{MARK}%'; DELETE FROM help_categories WHERE slug LIKE '{MARK}%'")

try:
    # ── Public reads on the seeded content ────────────────────────────────────────────────────────────────────
    s, idx = call("GET", "/api/public/help")
    check("public index answers", s == 200, idx)
    check("15+ seeded articles published", s == 200 and len(idx["articles"]) >= 15, len(idx["articles"]) if s == 200 else idx)
    check("categories listed with counts", s == 200 and len(idx["categories"]) >= 5 and all(k["articles"] > 0 for k in idx["categories"]))

    s, res = call("GET", "/api/public/help?q=" + q("password"))
    check("search ranks a title hit first", s == 200 and res["articles"] and res["articles"][0]["slug"] == "reset-your-password",
          [a["slug"] for a in res["articles"]] if s == 200 else res)
    s, res = call("GET", "/api/public/help?q=" + q("100%_"))
    check("search treats wildcards literally", s == 200 and res["articles"] == [], res)
    s, res = call("GET", "/api/public/help?category=communication")
    check("category filter", s == 200 and res["articles"] and all(a["categorySlug"] == "communication" for a in res["articles"]), res)

    s, art = call("GET", "/api/public/help/articles/send-a-mass-email")
    check("article with body and related", s == 200 and "<ol>" in art["body"] and len(art["related"]) >= 1, art)
    check("related excludes itself", s == 200 and all(r["slug"] != "send-a-mass-email" for r in art["related"]))
    check("unknown article is 404", call("GET", "/api/public/help/articles/no-such-thing")[0] == 404)
    check("bad slug is 404", call("GET", "/api/public/help/articles/" + q("../etc"))[0] in (404, 400))

    s, ctx = call("GET", "/api/public/help/context?path=" + q("/club-admin-dashboard/communication/mass-email/compose"))
    check("context: longest prefix wins", s == 200 and ctx["article"] and ctx["article"]["slug"] == "send-a-mass-email", ctx)
    s, ctx = call("GET", "/api/public/help/context?path=" + q("/no/help/here"))
    check("context: none gives null", s == 200 and ctx["article"] is None, ctx)
    check("context: path required", call("GET", "/api/public/help/context")[0] == 400)

    before = int(sql("SELECT helpful_yes FROM help_articles WHERE slug='send-a-mass-email'"))
    s, _ = call("POST", "/api/public/help/articles/send-a-mass-email/feedback", body={"helpful": True})
    after = int(sql("SELECT helpful_yes FROM help_articles WHERE slug='send-a-mass-email'"))
    check("was this helpful: yes counted", s == 200 and after == before + 1, (s, before, after))
    sql(f"UPDATE help_articles SET helpful_yes = {before} WHERE slug='send-a-mass-email'")
    check("feedback on unknown article 404", call("POST", "/api/public/help/articles/nope/feedback", body={"helpful": False})[0] == 404)

    # ── Role gating ───────────────────────────────────────────────────────────────────────────────────────────
    check("admin list needs sign-in", call("GET", "/api/help/admin/articles")[0] == 401)
    check("member cannot list drafts", call("GET", "/api/help/admin/articles", MEMBER)[0] == 403)
    check("member cannot create", call("POST", "/api/help/admin/categories", MEMBER, {"name": "x", "sortOrder": 0})[0] == 403)

    # ── Super Admin editing ───────────────────────────────────────────────────────────────────────────────────
    s, c = call("POST", "/api/help/admin/categories", SA, {"name": f"{MARK} Category", "slug": cat_slug, "description": "Test", "sortOrder": 99})
    check("SA creates category", s == 200 and c["id"] > 0, c)
    cat_id = c["id"]
    check("duplicate category slug is 409",
          call("POST", "/api/help/admin/categories", SA, {"name": "Again", "slug": cat_slug, "sortOrder": 0})[0] == 409)

    draft = {"categoryId": cat_id, "title": title, "slug": art_slug, "summary": "Testing summary",
             "body": '<p onclick="steal()">Step one.<script>alert(1)</script></p><p><a href="javascript:alert(2)">bad link</a></p>',
             "keywords": "testing, e2e", "contextPath": "/club-admin-dashboard/e2e-help-page", "status": "draft", "sortOrder": 1}
    s, a = call("POST", "/api/help/admin/articles", SA, draft)
    check("SA creates draft", s == 200 and a["slug"] == art_slug, a)
    art_id = a["id"]
    body = sql(f"SELECT body FROM help_articles WHERE pk_article_id={art_id}")
    check("body sanitized on save", "script" not in body and "onclick" not in body and "javascript:" not in body, body)
    check("draft hidden from public", call("GET", f"/api/public/help/articles/{art_slug}")[0] == 404)
    s, res = call("GET", "/api/public/help?q=" + q(MARK))
    check("draft hidden from search", s == 200 and res["articles"] == [], res)
    s, ctx = call("GET", "/api/public/help/context?path=" + q("/club-admin-dashboard/e2e-help-page"))
    check("draft has no Help link", s == 200 and ctx["article"] is None, ctx)
    s, rows = call("GET", "/api/help/admin/articles?status=draft&q=" + q(MARK), SA)
    check("SA sees draft in admin list", s == 200 and any(r["id"] == art_id for r in rows), rows)

    check("duplicate article slug is 409", call("POST", "/api/help/admin/articles", SA, dict(draft, title="Other"))[0] == 409)
    check("bad status is 400", call("POST", "/api/help/admin/articles", SA, dict(draft, slug=f"{MARK}-x", status="live"))[0] == 400)
    check("bad context path is 400", call("POST", "/api/help/admin/articles", SA, dict(draft, slug=f"{MARK}-x", contextPath="no-slash"))[0] == 400)
    check("empty body is 400", call("POST", "/api/help/admin/articles", SA, dict(draft, slug=f"{MARK}-x", body="<p> </p>"))[0] == 400)
    check("unknown category is 400", call("POST", "/api/help/admin/articles", SA, dict(draft, slug=f"{MARK}-x", categoryId=0))[0] == 400)
    check("update of missing article is 404", call("PUT", "/api/help/admin/articles/0", SA, draft)[0] == 404)

    s, _ = call("PUT", f"/api/help/admin/articles/{art_id}", SA, dict(draft, status="published"))
    check("SA publishes", s == 200)
    check("published_at set", sql(f"SELECT published_at IS NOT NULL FROM help_articles WHERE pk_article_id={art_id}") == "1")
    s, pub = call("GET", f"/api/public/help/articles/{art_slug}")
    check("published article is public", s == 200 and pub["title"] == title and "script" not in pub["body"], pub)
    s, res = call("GET", "/api/public/help?q=" + q(MARK))
    check("published article found by search", s == 200 and [x["slug"] for x in res["articles"]] == [art_slug], res)
    s, ctx = call("GET", "/api/public/help/context?path=" + q("/club-admin-dashboard/e2e-help-page/sub"))
    check("Help link resolves for its admin page", s == 200 and ctx["article"] and ctx["article"]["slug"] == art_slug, ctx)

    # Translation: the API reads the shared translation memory (the provider is off locally, so seed one row).
    h = hashlib.sha256(title.encode()).hexdigest()
    fr = f"{MARK} Comment tester le centre d'aide"
    sql("INSERT INTO translation_memory (source_hash, target_lang, source_text, translated_text, provider, created_at, updated_at) "
        f"VALUES ('{h}', 'fr', '{title}', \"{fr}\", 'e2e', UTC_TIMESTAMP(), UTC_TIMESTAMP())")
    s, tr = call("GET", f"/api/public/help/articles/{art_slug}?lang=fr")
    check("article translated with ?lang=fr", s == 200 and tr["title"] == fr, tr)
    s, en = call("GET", f"/api/public/help/articles/{art_slug}?lang=xx")
    check("unsupported language falls back to English", s == 200 and en["title"] == title, en)

    check("category with articles cannot be deleted", call("DELETE", f"/api/help/admin/categories/{cat_id}", SA)[0] == 409)
    check("member cannot delete", call("DELETE", f"/api/help/admin/articles/{art_id}", MEMBER)[0] == 403)
    check("SA deletes article", call("DELETE", f"/api/help/admin/articles/{art_id}", SA)[0] == 200)
    check("deleted article gone", call("GET", f"/api/public/help/articles/{art_slug}")[0] == 404)
    check("SA deletes empty category", call("DELETE", f"/api/help/admin/categories/{cat_id}", SA)[0] == 200)
finally:
    sql(f"DELETE FROM help_articles WHERE slug LIKE '{MARK}%'; DELETE FROM help_categories WHERE slug LIKE '{MARK}%'; "
        "DELETE FROM translation_memory WHERE provider = 'e2e' AND source_text LIKE 'e2e-help%'")
    left = sql(f"SELECT (SELECT COUNT(*) FROM help_articles WHERE slug LIKE '{MARK}%') + (SELECT COUNT(*) FROM help_categories WHERE slug LIKE '{MARK}%')")
    check("test rows removed", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
