"""RIZones goal module restored in ROW (2026-11-20): per-category goal locks, one-to-one and group goal messages,
RAG clubs, RCC pages behind the goal_setting_rotary switch.
    python -I kb/tools/goal_module_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret). Local copies only, never production.
Uses the test district 5656. Every lock it sets is put back and every message it writes is deleted at the end.
The goal_setting_rotary switch must be ON in the database before the API starts (FeatureGate caches it).
"""
import base64, hashlib, hmac, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0

def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()

def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"

def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def js(raw):
    try: return json.loads(raw or b"null")
    except Exception: return None

def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))

DIST = int(sql("SELECT pk_district_id FROM district_master WHERE DistrictNumber = '5656'"))
YEAR = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 ORDER BY pk_year_id DESC LIMIT 1"))
CLUB = int(sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id = {DIST} AND ClubName LIKE '%Thane City View%' LIMIT 1"))
SA_ID = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1"))
DA_ID = int(sql(f"""SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 2 AND fk_district_id = {DIST}
                   AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0 ORDER BY fk_member_master_profile_id LIMIT 1"""))
DG_ID = int(sql(f"SELECT fk_member_id FROM district_governors WHERE fk_district_id = {DIST} AND fk_year_id = {YEAR} AND isdeleted = 0 LIMIT 1"))
CA_ID = int(sql(f"""SELECT r.fk_member_master_profile_id FROM member_roles r WHERE r.fk_role_id = 2 AND r.fk_club_id = {CLUB}
                   AND r.IsActive = 1 AND r.isdeleted = 0 AND NOT EXISTS (SELECT 1 FROM member_roles x
                   WHERE x.fk_member_master_profile_id = r.fk_member_master_profile_id AND x.IsActive = 1 AND x.isdeleted = 0
                     AND (x.fk_role_id = 3 OR (x.fk_role_id = 2 AND (x.fk_club_id IS NULL OR x.fk_club_id = 0))))
                   AND r.fk_member_master_profile_id <> {DG_ID} LIMIT 1"""))
SA, DA, DG, CA = token(SA_ID, "SuperAdmin"), token(DA_ID, "Admin"), token(DG_ID, "Admin"), token(CA_ID, "Admin")
CAT = 1  # Membership
print(f"district {DIST} year {YEAR} club {CLUB} | SA {SA_ID} DA {DA_ID} DG {DG_ID} club admin {CA_ID}")

lock_before = sql(f"""SELECT IsLocked FROM goal_locks WHERE EntityType = 'Club' AND fk_club_id = {CLUB} AND fk_district_id = 0
                      AND fk_category_id = {CAT} AND fk_year_id = {YEAR}""")
direct_max = int(sql("SELECT COALESCE(MAX(pk_id), 0) FROM goal_direct_messages") or 0) if sql("SHOW TABLES LIKE 'goal_direct_messages'") else 0
group_max = int(sql("SELECT COALESCE(MAX(pk_id), 0) FROM goal_group_messages") or 0) if sql("SHOW TABLES LIKE 'goal_group_messages'") else 0
try:
    # ── Locks ──
    st, raw = call("GET", f"/api/goal-setting/clubs/{CAT}?yearId={YEAR}&clubId={CLUB}", DA); f = js(raw) or {}
    check("club form carries the lock fields", st == 200 and {"isLocked", "lockedByName", "lockedDate", "canLock"} <= set(f), f"{st} {list(f)[:14]}")
    check("District Admin may lock the club's goals", f.get("canLock") is True, f.get("canLock"))
    st, raw = call("GET", f"/api/goal-setting/clubs/{CAT}?yearId={YEAR}&clubId={CLUB}", CA); f = js(raw) or {}
    check("club admin may not lock their own goals", st == 200 and f.get("canLock") is False, f"{st} {f.get('canLock')}")
    st, raw = call("POST", f"/api/goal-setting/clubs/{CAT}/lock?yearId={YEAR}&clubId={CLUB}", CA)
    check("club admin lock call refused", st == 403, f"{st} {raw[:120]}")
    st, raw = call("POST", f"/api/goal-setting/clubs/{CAT}/lock?yearId={YEAR}&clubId={CLUB}", DA); l = js(raw) or {}
    check("District Admin locks Membership for the club", st == 200 and l.get("isLocked") is True and l.get("lockedByName"), f"{st} {raw[:160]}")
    st, raw = call("GET", f"/api/goal-setting/clubs/{CAT}?yearId={YEAR}&clubId={CLUB}", CA); f = js(raw) or {}
    check("locked form is read only", f.get("isLocked") is True and f.get("isEditable") is False, f"{f.get('isLocked')} {f.get('isEditable')}")
    st, raw = call("POST", f"/api/goal-setting/clubs/{CAT}?clubId={CLUB}", CA, {"yearId": YEAR, "entries": []})
    check("saving a locked category is refused", st == 400 and b"locked" in raw, f"{st} {raw[:160]}")
    st, raw = call("POST", f"/api/goal-setting/clubs/{CAT}/unlock?yearId={YEAR}&clubId={CLUB}", DA); l = js(raw) or {}
    check("District Admin unlocks it again", st == 200 and l.get("isLocked") is False, f"{st} {raw[:160]}")
    st, raw = call("GET", f"/api/goal-setting/districts/{CAT}?yearId={YEAR}&districtId={DIST}", DA); f = js(raw) or {}
    check("district form carries the lock fields", st == 200 and "isLocked" in f and "canLock" in f, f"{st} {list(f)[:14]}")

    # ── One-to-one messages. RIZones rule: oversight roles (RI Director / Zone Co-ordinator / District Assistant)
    #    and Super Admin chat with the district side; a District Admin and the DG never chat one-to-one (they share
    #    the District group). ROW has no oversight roles, so the live pairs are Super Admin <-> DG / District Admin. ──
    scope = f"yearId={YEAR}&districtId={DIST}"
    st, raw = call("GET", f"/api/goal-setting/direct/contacts?{scope}", DA)
    check("District Admin starts with no one-to-one contacts (no oversight roles in ROW)", st == 200 and js(raw) == [], f"{st} {raw[:200]}")
    st, raw = call("POST", f"/api/goal-setting/direct/{DG_ID}?{scope}", DA, {"commentText": "e2e direct refused", "categoryId": CAT, "districtId": DIST})
    check("District Admin -> DG one-to-one refused (RIZones rule)", st == 403, f"{st} {raw[:160]}")
    st, raw = call("GET", f"/api/goal-setting/direct/contacts?{scope}", SA); contacts = js(raw) or []
    ids = [c.get("memberId") for c in contacts] if isinstance(contacts, list) else []
    # Super Admin sees the district side as ONE chat per district (DG + District Admins), keyed -districtId.
    check("Super Admin's contacts include District 5656 (one chat for DG + District Admins)", st == 200 and -DIST in ids, f"{st} {ids[:12]}")
    text = f"e2e direct {int(time.time())}"
    st, raw = call("POST", f"/api/goal-setting/direct/{DG_ID}?{scope}", SA, {"commentText": text, "categoryId": CAT, "districtId": DIST})
    check("Super Admin messages the DG", st == 200 and (js(raw) or {}).get("commentText") == text, f"{st} {raw[:200]}")
    st, raw = call("GET", f"/api/goal-setting/direct/has-unread?{scope}", DG)
    check("DG sees the unread dot", st == 200 and (js(raw) or {}).get("hasUnread") is True, f"{st} {raw[:120]}")
    st, raw = call("GET", f"/api/goal-setting/direct/contacts?{scope}", DG); dgc = js(raw) or []
    check("Super Admin now in the DG's contacts", st == 200 and SA_ID in [c.get("memberId") for c in dgc], f"{st} {raw[:200]}")
    st, raw = call("GET", f"/api/goal-setting/direct/{SA_ID}?{scope}", DG); conv = js(raw) or {}
    check("DG reads the chat", st == 200 and any(m.get("commentText") == text for m in conv.get("messages", [])), f"{st} {raw[:200]}")
    msg = next((m for m in conv.get("messages", []) if m.get("commentText") == text), {})
    check("message time is printed (yyyy-MM-dd HH:mm, + ' UTC' for a UTC viewer)", re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d( UTC)?", msg.get("createdDate") or "") is not None, msg.get("createdDate"))
    st, raw = call("GET", f"/api/goal-setting/direct/has-unread?{scope}", DG)
    check("unread dot clears once read", st == 200 and (js(raw) or {}).get("hasUnread") is False, f"{st} {raw[:120]}")
    reply = text + " reply"
    st, raw = call("POST", f"/api/goal-setting/direct/{SA_ID}?{scope}", DG, {"commentText": reply, "categoryId": CAT, "districtId": DIST})
    check("DG replies to Super Admin", st == 200, f"{st} {raw[:200]}")
    st, raw = call("GET", f"/api/goal-setting/direct/{-DIST}?{scope}", SA); c = js(raw) or {}
    check("Super Admin reads the reply in the district chat", st == 200 and any(m.get("commentText") == reply for m in c.get("messages", [])), f"{st} {raw[:200]}")
    st, raw = call("GET", f"/api/goal-setting/direct/{SA_ID}?{scope}", CA); c = js(raw) or {}
    check("a club admin cannot read the Super Admin-DG chat", st in (403, 400) or not any(m.get("commentText") == text for m in c.get("messages", [])), f"{st} {raw[:160]}")
    st, raw = call("POST", f"/api/goal-setting/direct/{DG_ID}?{scope}", SA, {"commentText": "  ", "categoryId": CAT, "districtId": DIST})
    check("empty message refused", st == 400, f"{st} {raw[:120]}")

    # ── Group messages ──
    st, raw = call("GET", f"/api/goal-setting/groups?{scope}", DA); groups = js(raw) or []
    check("District Admin has goal groups", st == 200 and isinstance(groups, list) and len(groups) > 0, f"{st} {raw[:200]}")
    g = next((x for x in groups if x.get("kind") == "District" and x.get("categoryId") == CAT and x.get("canPost")), None) if isinstance(groups, list) else None
    check("a District group for Membership the DA can post in", g is not None, [(x.get("key"), x.get("kind"), x.get("canPost")) for x in groups][:6] if isinstance(groups, list) else groups)
    if g:
        key = urllib.parse.quote(g["key"], safe="")
        gtext = f"e2e group {int(time.time())}"
        st, raw = call("POST", f"/api/goal-setting/groups/conversation?key={key}&{scope}", DA, {"commentText": gtext})
        check("DA posts in the District group", st == 200, f"{st} {raw[:200]}")
        st, raw = call("GET", f"/api/goal-setting/groups/has-unread?{scope}", DG)
        check("DG sees the group unread dot", st == 200 and (js(raw) or {}).get("hasUnread") is True, f"{st} {raw[:120]}")
        st, raw = call("GET", f"/api/goal-setting/groups/conversation?key={key}&{scope}", DG); gc = js(raw) or {}
        check("DG reads the group", st == 200 and any(m.get("commentText") == gtext for m in gc.get("messages", [])), f"{st} {raw[:200]}")
        st, raw = call("GET", f"/api/goal-setting/groups/conversation?key={key}&{scope}", CA)
        check("a club admin cannot open the District group", st in (403, 400) or not any(m.get("commentText") == gtext for m in (js(raw) or {}).get("messages", [])), f"{st} {raw[:160]}")

    # ── RAG clubs + RCC pages switch ──
    st, raw = call("GET", f"/api/goal-setting-rotary/rag-clubs?yearId={YEAR}&districtId={DIST}", DA)
    check("RAG clubs open to the district's admin", st == 200 and isinstance(js(raw), list), f"{st} {raw[:160]}")
    st, raw = call("GET", f"/api/goal-setting-rotary/rag-clubs?yearId={YEAR}&districtId={DIST}", CA)
    check("RAG clubs closed to a club admin", st == 403, f"{st} {raw[:160]}")
    st, raw = call("GET", f"/api/rcc-goals/report/club/{CLUB}?yearId={YEAR}", SA)
    check("RCC club report still downloads with the switch on", st == 200 and raw[:2] == b"PK", f"{st} {raw[:80]}")
finally:
    if lock_before == "":
        sql(f"""DELETE FROM goal_locks WHERE EntityType = 'Club' AND fk_club_id = {CLUB} AND fk_district_id = 0
                AND fk_category_id = {CAT} AND fk_year_id = {YEAR}""")
    else:
        sql(f"""UPDATE goal_locks SET IsLocked = {lock_before} WHERE EntityType = 'Club' AND fk_club_id = {CLUB}
                AND fk_district_id = 0 AND fk_category_id = {CAT} AND fk_year_id = {YEAR}""")
    if sql("SHOW TABLES LIKE 'goal_direct_messages'"):
        sql(f"DELETE FROM goal_direct_messages WHERE pk_id > {direct_max} AND CommentText LIKE 'e2e direct %'")
    if sql("SHOW TABLES LIKE 'goal_group_messages'"):
        sql(f"DELETE FROM goal_group_messages WHERE pk_id > {group_max} AND CommentText LIKE 'e2e group %'")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
