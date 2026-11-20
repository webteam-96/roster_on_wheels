"""Website builder (gap agent, 2026-11-19): custom pages and home layout for club and district sites, draft/publish,
sections (rich text, picture, embed, data widgets, contact), media library, sanitising, access control.

    python -I kb/tools/website_builder_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Uses club 341 with its admin
1068 and ordinary member 999 (falls back to any club admin when those are missing). Writes test rows to the given LOCAL
database only (website_pages with slugs e2e-wb-*, the home layout when the club had none, media rows and files) and
removes them at the end. For the real member sign-in it sets a temporary password on one member's credential row in
the LOCAL copy and restores the original hash, counters and dates afterwards. Never run it against production.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
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


def call(method, path, tok=None, body=None, raw=None, ctype=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Authorization": f"Bearer {tok}"} if tok else {}
    if data is not None:
        headers["Content-Type"] = ctype or "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, rtype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, rtype = e.read(), e.code, e.headers.get("Content-Type", "")
    if "json" in rtype and payload:
        return status, json.loads(payload)
    return status, payload


def upload(path, tok, filename, content):
    b = "----e2e" + secrets.token_hex(8)
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f"\r\n--{b}--\r\n".encode()
    return call("POST", path, tok, raw=body, ctype=f"multipart/form-data; boundary={b}")


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


ADMIN = "r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0"
club = 341
admin = one(f"SELECT r.fk_member_master_profile_id FROM member_roles r WHERE {ADMIN} AND r.fk_club_id={club} "
            "AND r.fk_member_master_profile_id=1068 LIMIT 1") or one(
    f"SELECT r.fk_member_master_profile_id FROM member_roles r WHERE {ADMIN} AND r.fk_club_id={club} ORDER BY 1 LIMIT 1")
other_club = one(f"SELECT pk_club_id FROM club_master WHERE pk_club_id<>{club} AND IFNULL(isdeleted,0)=0 AND pk_club_id NOT IN "
                 f"(SELECT fk_club_id FROM member_roles WHERE fk_member_master_profile_id={admin} AND IsActive=1 AND isdeleted=0 "
                 "AND fk_club_id IS NOT NULL) ORDER BY 1 LIMIT 1")
district = one(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
assert None not in (admin, other_club, district, sa), "test data missing"
t_admin, t_plain, t_sa = token(admin, "Admin"), token(999, "Member"), token(sa, "SuperAdmin")
home_existed = one(f"SELECT COUNT(*) FROM website_pages WHERE owner_type='club' AND owner_id={club} AND slug='home'") > 0
print(f"club {club} (admin {admin}), other club {other_club}, district {district}")
base = f"/api/clubs/{club}/website-pages"
created_media = []

try:
    # ── Access control ────────────────────────────────────────────────────────────────────────────────────
    r = call("GET", base, t_admin)
    check("club admin lists pages", r[0] == 200 and isinstance(r[1], list), r)
    check("anonymous is refused", call("GET", base)[0] == 401)
    check("ordinary member is refused", call("GET", base, t_plain)[0] == 403)
    check("admin cannot read another club's pages (IDOR)", call("GET", f"/api/clubs/{other_club}/website-pages", t_admin)[0] == 403)
    check("club admin cannot use the district builder", call("GET", f"/api/districts/{district}/website-pages", t_admin)[0] == 403)
    check("tile seeded on Website Data", one("SELECT COUNT(*) FROM website_data_module_master WHERE module_key='pages' AND isdeleted=0") == 1)

    # ── Validation and sanitising ─────────────────────────────────────────────────────────────────────────
    r = call("POST", base, t_admin, {"slug": "Bad Slug", "title": "x", "sections": []})
    check("bad address refused", r[0] == 400, r)
    r = call("POST", base, t_admin, {"slug": "e2e-wb-a", "title": "x", "sections": [{"id": "e", "type": "embed", "url": "https://evil.example/x"}]})
    check("embed from unknown host refused", r[0] == 400, r)
    r = call("POST", base, t_admin, {"slug": "e2e-wb-a", "title": "x", "sections": [{"id": "i", "type": "image", "url": "javascript:alert(1)"}]})
    check("javascript picture URL refused", r[0] == 400, r)
    sections = [
        {"id": "t", "type": "richtext", "title": "About", "html": "<h2>History</h2><p onclick=\"x()\">Since 1950</p><script>alert(1)</script>"},
        {"id": "v", "type": "embed", "url": "https://youtu.be/dQw4w9WgXcQ"},
        {"id": "ev", "type": "events", "title": "Upcoming", "limit": 99},
        {"id": "c", "type": "contact", "title": "Write to us"},
    ]
    r = call("POST", base, t_admin, {"slug": "e2e-wb-a", "title": "E2E history", "sections": sections})
    check("page created", r[0] == 200 and r[1].get("id"), r)
    pid = r[1]["id"]
    r = call("GET", f"{base}/{pid}", t_admin)
    s = r[1]["sections"] if r[0] == 200 else []
    check("stored rich text is sanitised", len(s) == 4 and "<script" not in s[0]["html"] and "onclick" not in s[0]["html"] and "Since 1950" in s[0]["html"], s)
    check("embed normalised to the privacy player", s[1]["url"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", s)
    check("widget limit clamped", s[2]["limit"] == 24, s)
    check("new page is a draft", r[1]["isPublished"] is False, r)
    check("duplicate address refused", call("POST", base, t_admin, {"slug": "e2e-wb-a", "title": "y", "sections": []})[0] == 409)

    # ── Draft and publish ─────────────────────────────────────────────────────────────────────────────────
    pub = f"/api/public/website-pages/club/{club}/e2e-wb-a"
    check("draft is not public", call("GET", pub)[0] == 404)
    check("member cannot publish", call("POST", f"{base}/{pid}/publish", t_plain)[0] == 403)
    check("publish", call("POST", f"{base}/{pid}/publish", t_admin)[0] == 200)
    r = call("GET", pub)
    check("published page is public", r[0] == 200 and r[1]["title"] == "E2E history" and len(r[1]["sections"]) == 4, r)
    r = call("PUT", f"{base}/{pid}", t_admin, {"slug": "e2e-wb-a", "title": "E2E history v2", "sections": sections[:1]})
    check("draft saved", r[0] == 200, r)
    check("public still shows the published copy", call("GET", pub)[1].get("title") == "E2E history")
    lst = {p["id"]: p for p in call("GET", base, t_admin)[1]}
    check("list flags unpublished changes", lst[pid]["hasUnpublishedChanges"] is True, lst.get(pid))
    call("POST", f"{base}/{pid}/publish", t_admin)
    r = call("GET", pub)
    check("republish shows the new copy", r[1].get("title") == "E2E history v2" and len(r[1]["sections"]) == 1, r)
    # A stored row that bypassed the rules (old data, manual edit) is still cleaned on the way out.
    sql("UPDATE website_pages SET published_sections_json='[{\"id\":\"x\",\"type\":\"richtext\",\"html\":\"<img src=x onerror=alert(1)>ok\"},"
        "{\"id\":\"y\",\"type\":\"embed\",\"url\":\"https://evil.example/\"}]' "
        f"WHERE pk_website_page_id={pid}")
    r = call("GET", pub)
    check("public read re-cleans stored HTML and drops bad embeds", r[0] == 200 and len(r[1]["sections"]) == 1
          and "onerror" not in r[1]["sections"][0]["html"], r)
    check("unpublish", call("POST", f"{base}/{pid}/unpublish", t_admin)[0] == 200)
    check("unpublished page is gone from the site", call("GET", pub)[0] == 404)
    check("other club's page id is not reachable", call("GET", f"/api/clubs/{other_club}/website-pages/{pid}", t_sa)[0] == 404)

    # ── Home layout ───────────────────────────────────────────────────────────────────────────────────────
    if not home_existed:
        r = call("POST", base, t_admin, {"slug": "home", "title": "Home", "sections": [{"id": "n", "type": "news"}]})
        check("home layout created", r[0] == 200, r)
        hid = r[1]["id"]
        r = call("PUT", f"{base}/{hid}", t_admin, {"slug": "e2e-wb-home", "title": "Home", "sections": []})
        check("home layout keeps its address", r[0] == 400, r)
        call("POST", f"{base}/{hid}/publish", t_admin)
        r = call("GET", f"/api/public/website-pages/club/{club}/home")
        check("home layout is public once published", r[0] == 200 and r[1]["sections"][0]["type"] == "news", r)
    else:
        print("SKIP home layout checks: the club already has one")

    # ── Media library ─────────────────────────────────────────────────────────────────────────────────────
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")
    mbase = f"/api/clubs/{club}/website-media"
    r = upload(mbase, t_admin, "e2e-pixel.png", png)
    check("picture uploaded", r[0] == 200 and r[1]["url"].startswith(f"/uploads/website-pages/club-{club}/"), r)
    mid, murl = r[1]["id"], r[1]["url"]
    created_media.append(mid)
    check("uploaded picture is served", urllib.request.urlopen(API + murl, timeout=30).status == 200)
    check("svg refused", upload(mbase, t_admin, "x.svg", b"<svg onload=alert(1)>")[0] == 400)
    check("member cannot upload", upload(mbase, t_plain, "e2e.png", png)[0] == 403)
    check("media listed", any(m["id"] == mid for m in call("GET", mbase, t_admin)[1]))
    check("other club cannot delete it", call("DELETE", f"/api/clubs/{other_club}/website-media/{mid}", t_sa)[0] == 404)
    r = call("PUT", f"{base}/{pid}", t_admin, {"slug": "e2e-wb-a", "title": "E2E", "sections": [{"id": "p", "type": "image", "url": murl, "caption": "Pixel"}]})
    check("picture section from the library saves", r[0] == 200, r)
    check("media deleted", call("DELETE", f"{mbase}/{mid}", t_admin)[0] == 200)
    created_media.remove(mid)
    try:
        urllib.request.urlopen(API + murl, timeout=30)
        check("deleted file is gone", False, "still served")
    except urllib.error.HTTPError as e:
        check("deleted file is gone", e.code == 404, e.code)

    # ── Members-only pages and files ──────────────────────────────────────────────────────────────────────
    skey = hmac.new(SECRET.encode(), b"row-website-member-session-v1", hashlib.sha256).digest()

    def site_token(club_id, member_id, ttl=3600, key=skey):
        body = f"{club_id}.{member_id}.{int(time.time()) + ttl}"
        return body + "." + b64(hmac.new(key, ("site|" + body).encode(), hashlib.sha256).digest())

    def pub_get(path, tok=None):
        req = urllib.request.Request(API + path, headers={"X-Site-Session": tok} if tok else {})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    member = one(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND cm.IsActive=1 "
                 "AND cm.isdeleted=0 AND cm.fk_member_master_profile_id=999") or one(
        f"SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club} AND IsActive=1 AND isdeleted=0 ORDER BY 1 LIMIT 1")
    outsider = one(f"SELECT m.pk_member_master_profile_id FROM member_master_profile m WHERE m.isdeleted=0 AND NOT EXISTS "
                   f"(SELECT 1 FROM club_members x WHERE x.fk_member_master_profile_id=m.pk_member_master_profile_id AND x.fk_club_id={club}) "
                   "ORDER BY 1 LIMIT 1")
    good, other, stranger = site_token(club, member), site_token(other_club, member), site_token(club, outsider)
    bad_sig, expired = good[:-2] + ("AA" if not good.endswith("AA") else "BB"), site_token(club, member, ttl=-60)

    pdf = b"%PDF-1.4\n% e2e members-only minutes\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    b = "----e2e" + secrets.token_hex(8)
    raw = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="e2e-minutes.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode() \
        + pdf + f'\r\n--{b}\r\nContent-Disposition: form-data; name="membersOnly"\r\n\r\ntrue\r\n--{b}--\r\n'.encode()
    r = call("POST", mbase, t_admin, raw=raw, ctype=f"multipart/form-data; boundary={b}")
    check("members-only document uploaded", r[0] == 200 and r[1]["membersOnly"] is True and r[1]["url"] == f"media:{r[1]['id']}", r)
    fid = r[1]["id"]
    created_media.append(fid)
    stored = sql(f"SELECT url FROM website_media WHERE pk_website_media_id={fid}")
    check("members-only file stored outside the web root", stored.startswith("private/") and "/uploads/" not in stored, stored)
    check("no static URL reaches it", pub_get("/uploads/website-pages/" + stored[len("private/"):])[0] == 404)
    check("library lists it without its path", next(m for m in call("GET", mbase, t_admin)[1] if m["id"] == fid)["url"] == f"media:{fid}")
    r = call("GET", f"{mbase}/{fid}/link", t_admin)
    check("admin gets a signed link", r[0] == 200 and f"/api/public/website-files/{fid}?e=" in r[1]["url"], r)
    link = r[1]["url"]
    st, body, hdr = pub_get(link[link.index("/api/"):])
    check("signed link serves the file, not cached", st == 200 and body == pdf and "no-store" in (hdr.get("Cache-Control") or ""), (st, hdr.get("Cache-Control")))
    check("tampered link refused", pub_get(link[link.index("/api/"):].replace("&s=", "&s=x"))[0] == 404)
    check("expired link refused", pub_get(f"/api/public/website-files/{fid}?e=1&s=abc")[0] == 404)
    check("other club cannot get a link to it", call("GET", f"/api/clubs/{other_club}/website-media/{fid}/link", t_sa)[0] == 404)

    msecs = [{"id": "m", "type": "richtext", "html": "<p>Board minutes are below.</p>"},
             {"id": "f", "type": "file", "url": f"media:{fid}", "caption": "Minutes PDF"}]
    r = call("POST", base, t_admin, {"slug": "e2e-wb-members", "title": "E2E members", "sections": msecs, "membersOnly": True})
    check("members-only page created", r[0] == 200, r)
    mid_page = r[1]["id"]
    call("POST", f"{base}/{mid_page}/publish", t_admin)
    mpub = f"/api/public/website-pages/club/{club}/e2e-wb-members"
    st, body, _ = pub_get(mpub)
    check("anonymous gets 401 and none of the content", st == 401 and b"E2E members" not in body and b"Board minutes" not in body
          and b"membersOnly" in body, (st, body[:200]))
    for name, tok in (("tampered", bad_sig), ("expired", expired), ("other club's", other), ("non-member's", stranger)):
        check(f"{name} session refused", pub_get(mpub, tok)[0] == 401)
    st, body, hdr = pub_get(mpub, good)
    page = json.loads(body) if st == 200 else {}
    fsec = next((s for s in page.get("sections", []) if s["type"] == "file"), None)
    check("member sees the page, not cached", st == 200 and page.get("membersOnly") is True and "no-store" in (hdr.get("Cache-Control") or ""), (st, body[:200]))
    check("member gets a signed file link", fsec is not None and fsec["url"].startswith(f"/api/public/website-files/{fid}?e="), fsec)
    if fsec:
        check("member's file link works", pub_get(fsec["url"])[0] == 200)

    # A members-only file on a PUBLIC page is left out for visitors, shown to members.
    r = call("PUT", f"{base}/{pid}", t_admin, {"slug": "e2e-wb-a", "title": "E2E", "membersOnly": False,
                                               "sections": [{"id": "x", "type": "richtext", "html": "<p>Open</p>"}, {"id": "y", "type": "file", "url": f"media:{fid}"}]})
    call("POST", f"{base}/{pid}/publish", t_admin)
    st, body, _ = pub_get(pub)
    check("public page hides a members-only file from visitors", st == 200 and len(json.loads(body)["sections"]) == 1
          and b"e2e-minutes" not in body and f"media:{fid}".encode() not in body, body[:300])
    st, body, _ = pub_get(pub, good)
    check("public page shows it to members", st == 200 and len(json.loads(body)["sections"]) == 2, body[:300])

    # Visibility applies at once, without republishing.
    call("PUT", f"{base}/{pid}", t_admin, {"slug": "e2e-wb-a", "title": "E2E", "membersOnly": True, "sections": []})
    check("switching to members-only hides the published page at once", pub_get(pub)[0] == 401)
    check("list shows the flag", next(p for p in call("GET", base, t_admin)[1] if p["id"] == pid)["membersOnly"] is True)
    r = call("POST", base, t_admin, {"slug": "home", "title": "Home", "sections": [], "membersOnly": True})
    check("home layout cannot be members-only", r[0] == 400, r)

    # Real sign-in, with a temporary password on the member's credential in this LOCAL copy (restored afterwards).
    check("sign-in with an unknown email refused", call("POST", f"/api/public/website-session/club/{club}", None,
                                                        {"email": f"nobody-{secrets.token_hex(4)}@example.invalid", "password": "x"})[0] == 401)
    email = sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={member}")
    cred = sql(f"SELECT pk_member_credential_id, PasswordHash, IFNULL(FailedLoginAttempts,'NULL'), IFNULL(LockoutEndTime,'NULL'), "
               f"IFNULL(LastLoginDate,'NULL'), IFNULL(modified_date,'NULL') FROM member_credentials WHERE fk_member_master_profile_id={member} AND IsActive=1 AND isdeleted=0 LIMIT 1")
    if email and cred:
        import bcrypt
        cid, old_hash, old_failed, old_lock, old_last, old_mod = cred.split("\t")
        temp = "E2e-" + secrets.token_urlsafe(16)
        new_hash = bcrypt.hashpw(temp.encode(), bcrypt.gensalt(rounds=10)).decode().replace("$2b$", "$2a$")
        sql(f"UPDATE member_credentials SET PasswordHash='{new_hash}' WHERE pk_member_credential_id={cid}")
        try:
            r = call("POST", f"/api/public/website-session/club/{club}", None, {"email": email, "password": temp})
            check("member signs in on the club site", r[0] == 200 and r[1].get("token"), r[0])
            tok = r[1].get("token") if r[0] == 200 else None
            check("that session opens the members-only page", tok is not None and pub_get(mpub, tok)[0] == 200)
            check("session check endpoint", tok is not None and pub_get(f"/api/public/website-session/club/{club}", tok)[0] == 200)
            check("the same member cannot sign in to another club's site",
                  call("POST", f"/api/public/website-session/club/{other_club}", None, {"email": email, "password": temp})[0] == 401)
        finally:
            q = lambda v: "NULL" if v == "NULL" else f"'{v}'"
            sql(f"UPDATE member_credentials SET PasswordHash='{old_hash}', FailedLoginAttempts={q(old_failed)}, "
                f"LockoutEndTime={q(old_lock)}, LastLoginDate={q(old_last)}, modified_date={q(old_mod)} WHERE pk_member_credential_id={cid}")
        check("member credential restored", sql(f"SELECT PasswordHash FROM member_credentials WHERE pk_member_credential_id={cid}") == old_hash)
    else:
        print("SKIP real sign-in: the member has no email or credential row")
    check("members-only page deleted", call("DELETE", f"{base}/{mid_page}", t_admin)[0] == 200)
    check("members-only file deleted", call("DELETE", f"{mbase}/{fid}", t_admin)[0] == 200)
    created_media.remove(fid)
    check("its link is dead", pub_get(link[link.index("/api/"):])[0] == 404)

    # ── District site ─────────────────────────────────────────────────────────────────────────────────────
    dbase = f"/api/districts/{district}/website-pages"
    r = call("POST", dbase, t_sa, {"slug": "e2e-wb-d", "title": "District page", "sections": [{"id": "o", "type": "richtext", "html": "<p>Hi</p>"}]})
    check("SuperAdmin builds a district page", r[0] == 200, r)
    did = r[1]["id"]
    call("POST", f"{dbase}/{did}/publish", t_sa)
    r = call("GET", f"/api/public/website-pages/district/{district}/e2e-wb-d")
    check("district page is public once published", r[0] == 200 and r[1]["title"] == "District page", r)
    check("club page address is not shared with the district", call("GET", f"/api/public/website-pages/club/{club}/e2e-wb-d")[0] == 404)
    check("delete page", call("DELETE", f"{base}/{pid}", t_admin)[0] == 200)
    check("deleted page is gone", call("GET", f"{base}/{pid}", t_admin)[0] == 404)
finally:
    for m in created_media:
        call("DELETE", f"/api/clubs/{club}/website-media/{m}", t_admin)
    sql("DELETE FROM website_pages WHERE slug LIKE 'e2e-wb-%'")
    if not home_existed:
        sql(f"DELETE FROM website_pages WHERE owner_type='club' AND owner_id={club} AND slug='home'")
    left = one("SELECT COUNT(*) FROM website_pages WHERE slug LIKE 'e2e-wb-%'")
    print(f"cleanup: {left} test pages left")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
