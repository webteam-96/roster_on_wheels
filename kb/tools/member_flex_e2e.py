"""Member flexibility: club tags on members and contacts, custom profile fields, smart lists (gap agent, 2026-11-19).

    python -I kb/tools/member_flex_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Uses club 341 (club admin
member 1068, ordinary member 999) and the first member of another club as the outsider. Writes test rows named
'E2E MF ...' to the given LOCAL database and removes them at the end (also rows left by an earlier failed run).
The smart-list mass email step only creates a DRAFT (nothing is sent); the draft is deleted at the end.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, MEMBER = 341, 1068, 999
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1200}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, raw=False):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            if raw:
                return r.status, data.decode("utf-8-sig")
            return r.status, json.loads(data) if data else None
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data) if data else None
        except ValueError:
            return e.code, data.decode(errors="replace")[:200]


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def cleanup():
    sql(f"""DELETE a FROM club_tag_assignments a JOIN club_tags t ON t.pk_club_tag_id = a.fk_club_tag_id
            WHERE t.fk_club_id = {CLUB} AND t.name LIKE 'E2E MF%';
            DELETE FROM club_tags WHERE fk_club_id = {CLUB} AND name LIKE 'E2E MF%';
            DELETE v FROM club_profile_values v JOIN club_profile_fields f ON f.pk_profile_field_id = v.fk_profile_field_id
            WHERE f.fk_club_id = {CLUB} AND f.label LIKE 'E2E MF%';
            DELETE FROM club_profile_fields WHERE fk_club_id = {CLUB} AND label LIKE 'E2E MF%';
            DELETE FROM club_smart_lists WHERE fk_club_id = {CLUB} AND name LIKE 'E2E MF%';
            DELETE r FROM club_mass_email_recipients r JOIN club_mass_emails e ON e.pk_mass_email_id = r.fk_mass_email_id
            WHERE e.fk_club_id = {CLUB} AND e.Subject LIKE 'E2E MF%';
            DELETE FROM club_mass_emails WHERE fk_club_id = {CLUB} AND Subject LIKE 'E2E MF%';
            DELETE FROM contacts WHERE fk_club_id = {CLUB} AND name LIKE 'E2E MF%';""")


cleanup()
outsider, other_club = [int(x) for x in sql(
    f"SELECT cm.fk_member_master_profile_id, cm.fk_club_id FROM club_members cm WHERE cm.IsActive=1 AND cm.isdeleted=0 "
    f"AND cm.fk_club_id<>{CLUB} AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members "
    f"WHERE fk_club_id={CLUB}) AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles "
    f"WHERE fk_role_id IN (2,3) AND IsActive=1 AND isdeleted=0) ORDER BY 1 LIMIT 1").split()]
third = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
                f"ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id WHERE cm.fk_club_id={CLUB} AND cm.IsActive=1 "
                f"AND cm.isdeleted=0 AND m.isdeleted=0 AND m.EmailId LIKE '%@%' AND cm.fk_member_master_profile_id NOT IN ({ADMIN},{MEMBER}) "
                f"ORDER BY 1 LIMIT 1"))
ta, tm, to = token(ADMIN, "Admin"), token(MEMBER, "Member"), token(outsider, "Member")
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
# Contact tags live behind the contacts_growth switch: switched on for the contact steps, restored at the end.
contacts_was_on = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='contacts_growth'") == "1"


def set_contacts(on):
    return call("PUT", "/api/features/contacts_growth", token(sa, "SuperAdmin"), {"enabled": on})[0]

C = f"/api/clubs/{CLUB}"
print(f"club {CLUB}: admin {ADMIN}, member {MEMBER}, third member {third}; outsider {outsider} (club {other_club})")

try:
    # ── Tags ──
    s, r = call("POST", C + "/tags", ta, {"name": "E2E MF Golfers", "color": "#2a6f4e"})
    check("admin creates a tag", s == 200 and r["id"] > 0, (s, r))
    golf = r["id"]
    s, r = call("POST", C + "/tags", ta, {"name": "E2E MF Donors", "color": "#7A3E00"})
    donors = r["id"]
    check("second tag", s == 200, (s, r))
    s, r = call("POST", C + "/tags", ta, {"name": "e2e mf golfers"})
    check("duplicate tag name is refused (409)", s == 409, (s, r))
    s, r = call("POST", C + "/tags", ta, {"name": "E2E MF Bad", "color": "red;drop"})
    check("bad colour is refused (400)", s == 400, (s, r))
    s, r = call("GET", C + "/tags", tm)
    check("ordinary member cannot read tags (403)", s == 403, (s, r))
    s, r = call("POST", C + "/tags", tm, {"name": "E2E MF Member"})
    check("ordinary member cannot create a tag (403)", s == 403, (s, r))
    s, r = call("GET", f"/api/clubs/{other_club}/tags", ta)
    check("admin cannot read another club's tags (403)", s == 403, (s, r))

    s, r = call("PUT", f"{C}/members/{MEMBER}/tags", ta, {"tagIds": [golf, donors]})
    check("tag a member with two tags", s == 200, (s, r))
    s, r = call("PUT", f"{C}/members/{third}/tags", ta, {"tagIds": [golf]})
    check("tag a second member", s == 200, (s, r))
    s, r = call("PUT", f"{C}/members/{outsider}/tags", ta, {"tagIds": [golf]})
    check("cannot tag a member of another club (404)", s == 404, (s, r))
    s, r = call("PUT", f"{C}/members/{MEMBER}/tags", ta, {"tagIds": [golf, 999999]})
    check("unknown tag id is refused (400)", s == 400, (s, r))
    s, r = call("GET", C + "/tags", ta)
    g = next((t for t in r if t["id"] == golf), None) if s == 200 else None
    check("tag list counts members", g is not None and g["memberCount"] == 2 and g["color"] == "#2A6F4E", (s, g))

    # contacts: tag + filter by tag
    check("contacts switch on for the contact steps", set_contacts(True) == 204)
    s, r = call("POST", C + "/contacts", ta, {"name": "E2E MF Contact", "email": "mfe2e@example.org", "contactType": "guest"})
    contact = r["id"] if s == 200 else 0
    check("create a club contact", s == 200, (s, r))
    s, r = call("PUT", f"{C}/contacts/{contact}/tags", ta, {"tagIds": [donors]})
    check("tag a contact", s == 200, (s, r))
    s, r = call("GET", f"{C}/contacts?tagId={donors}", ta)
    check("contacts filtered by tag", s == 200 and [c["id"] for c in r["items"]] == [contact] and r["items"][0]["tagIds"] == [donors], (s, r))
    s, r = call("GET", f"{C}/contacts?tagId={golf}", ta)
    check("contacts filter excludes untagged", s == 200 and r["totalCount"] == 0, (s, r))

    # ── Profile fields ──
    fields = {}
    for label, ftype, vis, opts in [("E2E MF Nickname", "text", "members", None), ("E2E MF Level", "choice", "admins", ["Gold", "Silver"]),
                                    ("E2E MF Years", "number", "members", None), ("E2E MF Badge date", "date", "admins", None),
                                    ("E2E MF Vegetarian", "yesno", "members", None)]:
        s, r = call("POST", C + "/profile-fields", ta, {"label": label, "fieldType": ftype, "visibility": vis, "options": opts})
        check(f"create {ftype} field", s == 200, (s, r))
        fields[ftype] = r["id"] if s == 200 else 0
    s, r = call("POST", C + "/profile-fields", ta, {"label": "E2E MF Html", "fieldType": "html"})
    check("unknown field type is refused (400)", s == 400, (s, r))
    s, r = call("POST", C + "/profile-fields", ta, {"label": "E2E MF Empty choice", "fieldType": "choice", "options": []})
    check("choice field without options is refused (400)", s == 400, (s, r))
    s, r = call("POST", C + "/profile-fields", tm, {"label": "E2E MF Member field", "fieldType": "text"})
    check("ordinary member cannot create a field (403)", s == 403, (s, r))
    s, r = call("PUT", f"{C}/profile-fields/{fields['number']}", ta, {"label": "E2E MF Years", "fieldType": "text"})
    check("field type cannot change (400)", s == 400, (s, r))

    vals = {"values": [{"fieldId": fields["text"], "value": "Robbie"}, {"fieldId": fields["choice"], "value": "gold"},
                       {"fieldId": fields["number"], "value": "12.50"}, {"fieldId": fields["date"], "value": "2025-03-01"},
                       {"fieldId": fields["yesno"], "value": "yes"}]}
    s, r = call("PUT", f"{C}/members/{MEMBER}/profile-fields", ta, vals)
    check("admin saves a member's profile fields", s == 200, (s, r))
    s, r = call("PUT", f"{C}/members/{third}/profile-fields", ta, {"values": [{"fieldId": fields["number"], "value": "3"},
                                                                               {"fieldId": fields["choice"], "value": "Silver"}]})
    check("admin saves a second member's fields", s == 200, (s, r))
    s, r = call("PUT", f"{C}/members/{MEMBER}/profile-fields", ta, {"values": [{"fieldId": fields["number"], "value": "lots"}]})
    check("non-number is refused (400)", s == 400, (s, r))
    s, r = call("PUT", f"{C}/members/{MEMBER}/profile-fields", ta, {"values": [{"fieldId": fields["choice"], "value": "Bronze"}]})
    check("value outside the options is refused (400)", s == 400, (s, r))
    s, r = call("PUT", f"{C}/members/{MEMBER}/profile-fields", tm, vals)
    check("ordinary member cannot write values (403)", s == 403, (s, r))
    s, r = call("PUT", f"{C}/profile-fields/{fields['choice']}", ta, {"label": "E2E MF Level", "options": ["Silver"], "visibility": "admins"})
    check("cannot remove an option still in use (400)", s == 400, (s, r))

    s, r = call("GET", f"{C}/members/{MEMBER}/profile-fields", ta)
    got = {f["id"]: f["value"] for f in r} if s == 200 else {}
    check("admin reads every field with stored values",
          got.get(fields["choice"]) == "Gold" and got.get(fields["number"]) == "12.5" and got.get(fields["date"]) == "2025-03-01", (s, got))
    s, r = call("GET", f"{C}/members/{MEMBER}/profile-fields", tm)
    seen = {f["id"] for f in r} if s == 200 else set()
    check("member sees members-visible fields only",
          s == 200 and fields["text"] in seen and fields["choice"] not in seen and fields["date"] not in seen, (s, r))
    s, r = call("GET", f"{C}/members/{third}/profile-fields", tm)
    check("member sees a fellow member's members-visible fields", s == 200 and all(f["visibility"] == "members" for f in r), (s, r))
    s, r = call("GET", f"{C}/members/{MEMBER}/profile-fields", to)
    check("outsider cannot read the club's profile fields (403)", s == 403, (s, r))
    s, r = call("GET", f"{C}/members/{outsider}/profile-fields", ta)
    check("values of a non-member are not served (404)", s == 404, (s, r))
    s, r = call("GET", f"{C}/profile-fields", tm)
    check("member lists members-visible field definitions", s == 200 and all(f["visibility"] == "members" for f in r), (s, r))

    # ── Smart lists ──
    def preview(f, tok=ta):
        s, r = call("POST", C + "/smart-lists/preview", tok, {"filter": f, "pageSize": 500})
        return s, ({m["memberId"] for m in r["items"]} if s == 200 else r)

    s, ids = preview({"tagIds": [golf]})
    check("filter by tag (any)", s == 200 and ids == {MEMBER, third}, (s, ids))
    s, ids = preview({"tagIds": [golf, donors], "tagMode": "all"})
    check("filter by tags (all)", s == 200 and ids == {MEMBER}, (s, ids))
    s, ids = preview({"fields": [{"fieldId": fields["number"], "op": "gt", "value": "10"}]})
    check("number field greater than", s == 200 and ids == {MEMBER}, (s, ids))
    s, ids = preview({"fields": [{"fieldId": fields["choice"], "op": "eq", "value": "silver"}]})
    check("choice field equals", s == 200 and ids == {third}, (s, ids))
    s, ids = preview({"fields": [{"fieldId": fields["date"], "op": "before", "value": "2026-01-01"}, {"fieldId": fields["yesno"], "op": "eq", "value": "yes"}]})
    check("date before + yes/no", s == 200 and ids == {MEMBER}, (s, ids))
    s, ids = preview({"tagIds": [golf], "fields": [{"fieldId": fields["text"], "op": "notset"}]})
    check("tag + field not set", s == 200 and ids == {third}, (s, ids))
    s, ids = preview({"search": "x' OR '1'='1", "tagIds": [golf]})
    check("injection text in search is just text", s == 200 and ids == set(), (s, ids))
    s, ids = preview({"fields": [{"fieldId": fields["text"], "op": "eq", "value": "Robbie' OR 1=1 --"}]})
    check("injection text in a value is just text", s == 200 and ids == set(), (s, ids))
    s, r = preview({"fields": [{"fieldId": fields["text"], "op": "gt", "value": "a"}]})
    check("operator not allowed for type is refused (400)", s == 400, (s, r))
    s, r = preview({"tagIds": [123456789]})
    check("tag of no club is refused (400)", s == 400, (s, r))
    s, r = preview({"memberType": "honorary; DROP"})
    check("unknown member type is refused (400)", s == 400, (s, r))
    s, ids = preview({"joinedFrom": "1900-01-01", "memberType": "active", "tagIds": [golf]})
    check("join date + member type", s == 200, (s, ids))
    s, r = preview({"tagIds": [golf]}, tm)
    check("ordinary member cannot preview (403)", s == 403, (s, r))

    s, r = call("POST", C + "/smart-lists", ta, {"name": "E2E MF Golfers over 10", "filter": {"tagIds": [golf], "fields": [{"fieldId": fields["number"], "op": "gt", "value": "10"}]}})
    check("save a smart list", s == 200, (s, r))
    lst = r["id"] if s == 200 else 0
    s, r = call("POST", C + "/smart-lists", ta, {"name": "E2E MF Broken", "filter": {"fields": [{"fieldId": 987654, "op": "set"}]}})
    check("smart list with unknown field is refused (400)", s == 400, (s, r))
    s, r = call("GET", C + "/smart-lists", ta)
    check("smart lists listed with filter", s == 200 and any(l["id"] == lst and l["filter"]["tagIds"] == [golf] for l in r), (s, r))
    s, r = call("GET", f"{C}/smart-lists/{lst}/members", ta)
    check("smart list members", s == 200 and [m["memberId"] for m in r["items"]] == [MEMBER], (s, r))
    s, r = call("GET", f"{C}/smart-lists/{lst}/export", ta, raw=True)
    lines = r.strip().splitlines() if s == 200 else []
    check("CSV export has fields as columns and the member row",
          s == 200 and len(lines) == 2 and '"E2E MF Level"' in lines[0] and '"Gold"' in lines[1] and 'E2E MF Golfers' in lines[1], (s, lines[:1]))  # header only: rows are real people
    s, r = call("GET", f"{C}/smart-lists/{lst}/export", tm, raw=True)
    check("ordinary member cannot export (403)", s == 403, (s, r))
    s, r = call("POST", f"{C}/smart-lists/{lst}/mass-email", ta, {"subject": "E2E MF Golf day", "fromName": "E2E MF"})
    draft = r.get("massEmailId") if s == 200 and isinstance(r, dict) else 0
    check("mass email draft from smart list", s == 200 and draft, (s, r))
    if draft:
        row = sql(f"SELECT Status, RecipientType, (SELECT GROUP_CONCAT(fk_member_id) FROM club_mass_email_recipients WHERE fk_mass_email_id={draft}) "
                  f"FROM club_mass_emails WHERE pk_mass_email_id={draft}").split("\t")
        check("draft is a draft addressed to the list's members", row[1] == "3" and row[2] == str(MEMBER) and row[0].lower() == "draft", row)
    s, r = call("PUT", f"{C}/smart-lists/{lst}", ta, {"name": "E2E MF Golfers", "filter": {"tagIds": [golf]}})
    check("edit a smart list", s == 200, (s, r))
    s, r = call("GET", f"{C}/smart-lists/{lst}/members", ta)
    check("edited list re-evaluates", s == 200 and r["totalCount"] == 2, (s, r))
    s, r = call("GET", f"/api/clubs/{other_club}/smart-lists/{lst}/members", ta)
    check("cannot reach the list through another club (403)", s == 403, (s, r))

    # ── Deletes ──
    s, r = call("DELETE", f"{C}/smart-lists/{lst}", ta)
    check("delete smart list", s == 200, (s, r))
    s, r = call("DELETE", f"{C}/profile-fields/{fields['choice']}", ta)
    left = sql(f"SELECT COUNT(*) FROM club_profile_values WHERE fk_profile_field_id={fields['choice']}")
    check("delete field removes its values", s == 200 and left == "0", (s, left))
    s, r = call("DELETE", f"{C}/tags/{golf}", ta)
    left = sql(f"SELECT COUNT(*) FROM club_tag_assignments WHERE fk_club_tag_id={golf}")
    check("delete tag removes its assignments", s == 200 and left == "0", (s, left))
    s, r = call("DELETE", f"{C}/contacts/{contact}", ta)
    left = sql(f"SELECT COUNT(*) FROM club_tag_assignments WHERE entity_type='contact' AND entity_id={contact}")
    check("delete contact removes its tags", s == 200 and left == "0", (s, left))
finally:
    set_contacts(contacts_was_on)
    cleanup()
    left = sql(f"SELECT (SELECT COUNT(*) FROM club_tags WHERE name LIKE 'E2E MF%') + (SELECT COUNT(*) FROM club_profile_fields WHERE label LIKE 'E2E MF%') "
               f"+ (SELECT COUNT(*) FROM club_smart_lists WHERE name LIKE 'E2E MF%') + (SELECT COUNT(*) FROM club_mass_emails WHERE Subject LIKE 'E2E MF%')")
    check("test rows cleaned up", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
