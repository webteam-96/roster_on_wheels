"""Membership fields (build spec 3.12): Foundation designations, committee documents, duplicate check naming the member.

    python -I kb/tools/membership_fields_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only,
never production. Writes test designations, a committee document (and its file), a test sub-committee and the
membership_fields switch, and removes them all at the end; audit_log rows stay (that table is append-only).
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request, uuid

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
WWWROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "row", "api", "wwwroot")
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q, ints=True):
    out = sql(q)
    if not out:
        sys.exit(f"setup query found nothing: {q}")
    return [int(x) if ints and x.lstrip('-').isdigit() else x for x in out.splitlines()[0].split('\t')]


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None, form=None):
    headers = {"Authorization": f"Bearer {tok}"}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if form is not None:  # {name: str | (filename, bytes)}
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in form.items():
            if isinstance(v, tuple):
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{v[0]}"\r\n'
                             f'Content-Type: application/octet-stream\r\n\r\n'.encode() + v[1] + b"\r\n")
            else:
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, raw.decode(errors="replace")


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


# ── Who is who (real ids, picked by query) ──────────────────────────────────────────────────────────────────
ACTIVE = "IsActive=1 AND IFNULL(isdeleted,0)=0"
sa = one(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND {ACTIVE} LIMIT 1")[0]
# active members of club {c} with no role beyond Member
PLAIN = ("SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
         "ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0 "
         "WHERE cm.fk_club_id={c} AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 "
         "AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles "
         "WHERE fk_role_id<>1 AND IsActive=1 AND IFNULL(isdeleted,0)=0) ORDER BY 1 LIMIT 1")
HAS_PLAIN = f"EXISTS ({PLAIN.format(c='c.pk_club_id')})"
# a club admin with no wider role (SuperAdmin, district admin, zone, ...), so cross-club refusals are meaningful
club, district, admin = one(
    "SELECT c.pk_club_id, c.fk_district_id, r.fk_member_master_profile_id FROM club_master c "
    "JOIN member_roles r ON r.fk_club_id=c.pk_club_id AND r.fk_role_id=2 AND r.IsActive=1 AND IFNULL(r.isdeleted,0)=0 "
    f"WHERE IFNULL(c.isdeleted,0)=0 AND c.fk_district_id IS NOT NULL AND {HAS_PLAIN} AND NOT EXISTS (SELECT 1 FROM member_roles x "
    "WHERE x.fk_member_master_profile_id=r.fk_member_master_profile_id AND x.IsActive=1 AND IFNULL(x.isdeleted,0)=0 "
    "AND (x.fk_role_id NOT IN (1,2) OR (x.fk_role_id=2 AND IFNULL(x.fk_club_id,0)=0))) ORDER BY c.pk_club_id LIMIT 1")
plain = one(PLAIN.format(c=club))[0]
other_club = one(f"SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id<>{district} AND IFNULL(c.isdeleted,0)=0 "
                 f"AND {HAS_PLAIN} ORDER BY 1 LIMIT 1")[0]
foreign = one(PLAIN.format(c=other_club))[0]
t_sa, t_admin = token(sa, "SuperAdmin"), token(admin, "Admin")
t_plain, t_foreign = token(plain, "Member"), token(foreign, "Member")

flag_before = sql("SELECT enabled FROM platform_features WHERE feature_key='membership_fields'")
designation_ids, document_ids, sub_group_id = [], [], None

try:
    # ── Feature flag ────────────────────────────────────────────────────────────────────────────────────────
    call("PUT", "/api/features/membership_fields", t_sa, {"enabled": False})
    s, _ = call("GET", f"/api/members/{plain}/foundation-designations", t_sa)
    check("flag off: designations answer 404", s == 404, s)
    s, _ = call("PUT", "/api/features/membership_fields", t_sa, {"enabled": True})
    check("SuperAdmin switches the flag on", s in (200, 204), s)

    # ── Designations ────────────────────────────────────────────────────────────────────────────────────────
    base = f"/api/members/{plain}/foundation-designations"
    s, b = call("POST", base, t_admin, {"type": "PHF", "awardedDate": "2015-03-01"})
    check("club admin adds Paul Harris Fellow", s == 200 and b.get("id"), (s, b))
    if s == 200: designation_ids.append(b["id"])
    s, b = call("POST", base, t_admin, {"type": "phf", "level": 2, "awardedDate": "2019-06-30", "notes": "e2e"})
    check("club admin adds PHF+2", s == 200, (s, b))
    if s == 200: designation_ids.append(b["id"])
    s, b = call("POST", base, t_admin, {"type": "PHF", "level": 2, "awardedDate": "2020-01-01"})
    check("same designation twice is refused (409)", s == 409, (s, b))
    for name, body in [("Major Donor level 7", {"type": "MAJOR_DONOR", "level": 7, "awardedDate": "2020-01-01"}),
                       ("Bequest Society with a level", {"type": "BEQUEST_SOCIETY", "level": 1, "awardedDate": "2020-01-01"}),
                       ("a date in the future", {"type": "MAJOR_DONOR", "level": 1, "awardedDate": "2999-01-01"}),
                       ("no date", {"type": "MAJOR_DONOR", "level": 1}),
                       ("an unknown type", {"type": "AKS", "awardedDate": "2020-01-01"})]:
        s, b = call("POST", base, t_admin, body)
        check(f"validation refuses {name} (400)", s == 400, (s, b))
    s, b = call("POST", f"/api/members/{foreign}/foundation-designations", t_admin,
                {"type": "PHF", "awardedDate": "2015-03-01"})
    check("club admin cannot add for another club's member (403)", s == 403, (s, b))
    s, b = call("POST", base, t_plain, {"type": "BEQUEST_SOCIETY", "awardedDate": "2015-03-01"})
    check("a member cannot add their own designation (403)", s == 403, (s, b))
    s, b = call("GET", base, t_plain)
    check("member reads own history, newest first",
          s == 200 and [r["label"] for r in b] == ["Paul Harris Fellow +2", "Paul Harris Fellow"], (s, b))
    s, _ = call("GET", base, t_foreign)
    check("another club's member cannot read it (403)", s == 403, s)

    s, b = call("GET", f"/api/clubs/{club}/foundation-designations?type=PHF", t_admin)
    row = next((r for r in (b or []) if r["memberId"] == plain), None) if s == 200 else None
    check("club report lists the member at the highest level",
          row is not None and row["label"] == "Paul Harris Fellow +2" and row["awardedDate"] == "2019-06-30", (s, row))
    s, b = call("GET", f"/api/clubs/{club}/foundation-designations?type=PHF&minLevel=3", t_admin)
    check("club report minimum level filters the member out",
          s == 200 and all(r["memberId"] != plain for r in b), (s, b))
    s, _ = call("GET", f"/api/clubs/{club}/foundation-designations?type=PHF", t_plain)
    check("a plain member cannot read the club report (403)", s == 403, s)
    s, b = call("GET", f"/api/districts/{district}/foundation-designations?type=PHF", t_sa)
    check("district report lists the member", s == 200 and any(r["memberId"] == plain for r in b), (s, b))
    s, _ = call("GET", f"/api/districts/{district}/foundation-designations?type=PHF", t_plain)
    check("a plain member cannot read the district report (403)", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{club}/foundation-designations?type=NOPE", t_admin)
    check("report refuses an unknown type (400)", s == 400, s)

    if designation_ids:
        s, _ = call("DELETE", f"/api/members/{foreign}/foundation-designations/{designation_ids[0]}", t_sa)
        check("delete through another member's path finds nothing (404)", s == 404, s)
        s, _ = call("DELETE", f"{base}/{designation_ids[0]}", t_admin)
        check("club admin removes a designation", s == 200, s)
        s, b = call("GET", base, t_admin)
        check("removed row leaves the history", s == 200 and [r["label"] for r in b] == ["Paul Harris Fellow +2"], (s, b))
        s, _ = call("DELETE", f"{base}/{designation_ids[0]}", t_admin)
        check("removing it again is 404", s == 404, s)

    # ── Committee documents ─────────────────────────────────────────────────────────────────────────────────
    group, g_district = one("SELECT id, fk_district_id FROM district_committee_group WHERE IFNULL(isdeleted,0)=0 ORDER BY id LIMIT 1")
    wrong_district = one(f"SELECT pk_district_id FROM district_master WHERE pk_district_id<>{g_district} "
                         "AND IFNULL(isdeleted,0)=0 ORDER BY 1 LIMIT 1")[0]
    docs = f"/api/districts/{g_district}/committee/documents"
    pdf = ("e2e-minutes.pdf", b"%PDF-1.4\n% e2e test document\n")
    s, b = call("POST", docs, t_sa, form={"groupId": group, "title": "E2E minutes", "file": pdf})
    check("upload a committee document", s == 200 and b.get("id"), (s, b))
    if s == 200: document_ids.append(b["id"])
    s, b = call("GET", f"{docs}?groupId={group}", t_sa)
    doc = next((d for d in (b or []) if d["id"] in document_ids), None) if s == 200 else None
    check("committee lists the document with its file url",
          doc is not None and doc["url"].startswith(f"/Documents/documentsafe/Group{g_district}/"), (s, doc))
    s, b = call("POST", docs, t_sa, form={"groupId": group, "title": "E2E page", "file": ("x.html", b"<script>1</script>")})
    check("an .html upload is refused (400)", s == 400, (s, b))
    s, b = call("POST", f"/api/districts/{wrong_district}/committee/documents", t_sa,
                form={"groupId": group, "title": "E2E wrong", "file": pdf})
    check("a committee of another district is not found (404)", s == 404, (s, b))
    s, b = call("POST", docs, t_plain, form={"groupId": group, "title": "E2E member", "file": pdf})
    check("a member who does not manage the district cannot upload (403)", s == 403, (s, b))
    s, _ = call("GET", f"{docs}?groupId={group}&subGroupId=1", t_sa)
    check("committee and sub-committee together is refused (404)", s == 404, s)

    sql(f"INSERT INTO district_committee_sub_group (fk_group_id, sub_group_name, sort_order, is_active, isdeleted) "
        f"VALUES ({group}, 'E2E sub-committee', 0, 1, 0)")
    sub_group_id = one(f"SELECT MAX(id) FROM district_committee_sub_group WHERE fk_group_id={group} "
                       "AND sub_group_name='E2E sub-committee'")[0]
    s, b = call("POST", docs, t_sa, form={"subGroupId": sub_group_id, "title": "E2E sub minutes", "file": pdf})
    check("upload a sub-committee document", s == 200, (s, b))
    if s == 200: document_ids.append(b["id"])
    s, b = call("GET", f"{docs}?subGroupId={sub_group_id}", t_sa)
    check("sub-committee lists only its own document",
          s == 200 and [d["title"] for d in b] == ["E2E sub minutes"], (s, b))
    s, b = call("GET", f"{docs}?groupId={group}", t_sa)
    check("committee list leaves out the sub-committee document",
          s == 200 and all(d["title"] != "E2E sub minutes" for d in b), (s, b))
    if document_ids:
        s, _ = call("DELETE", f"/api/districts/{wrong_district}/committee/documents/{document_ids[0]}", t_sa)
        check("delete under another district finds nothing (404)", s == 404, s)
        s, _ = call("DELETE", f"{docs}/{document_ids[0]}", t_sa)
        check("remove a committee document", s == 200, s)

    # ── Duplicate check names the matching member ───────────────────────────────────────────────────────────
    a_id, a_name, a_email = one("SELECT pk_member_master_profile_id, MemberName, EmailId FROM member_master_profile "
                                "WHERE isdeleted=0 AND IFNULL(EmailId,'')<>'' ORDER BY 1 LIMIT 1", ints=False)
    b_id, b_name, b_rid = one("SELECT pk_member_master_profile_id, MemberName, RotaryId FROM member_master_profile "
                              f"WHERE isdeleted=0 AND IFNULL(RotaryId,'')<>'' AND pk_member_master_profile_id<>{a_id} "
                              "ORDER BY 1 LIMIT 1", ints=False)
    s, b = call("POST", "/api/members", t_sa, {"memberName": "E2E Duplicate Check", "emailId": a_email, "rotaryId": b_rid})
    msg = (b or {}).get("message", "") if isinstance(b, dict) else str(b)
    check("add refuses a used email and Rotary ID (409)", s == 409, (s, msg))
    check("add names the member holding the email", f"email ID already exists (used by {a_name}" in msg, msg)
    check("add names the member holding the Rotary ID", f"Rotary ID already exists (used by {b_name}" in msg, msg)
    s, current = call("GET", f"/api/members/{a_id}", t_sa)
    if s == 200:
        current["rotaryId"] = b_rid
        s, b = call("PUT", f"/api/members/{a_id}", t_sa, current)
        msg = (b or {}).get("message", "") if isinstance(b, dict) else str(b)
        check("edit refuses another member's Rotary ID and names them",
              s == 409 and f"Rotary ID already exists (used by {b_name}" in msg, (s, msg))
    else:
        check("read a member to edit", False, s)
finally:
    # ── Clean up everything this run wrote (audit_log is append-only and keeps its rows) ────────────────────
    if designation_ids:
        sql(f"DELETE FROM member_foundation_designations WHERE pk_member_designation_id IN ({','.join(map(str, designation_ids))})")
    for doc_id in document_ids:
        row = sql(f"SELECT fk_district_id, file_path FROM district_committee_documents WHERE id={doc_id}").split('\t')
        if len(row) == 2:
            path = os.path.join(WWWROOT, "Documents", "documentsafe", f"Group{row[0]}", row[1])
            if os.path.isfile(path):
                os.remove(path)
            if os.path.isdir(os.path.dirname(path)) and not os.listdir(os.path.dirname(path)):
                os.rmdir(os.path.dirname(path))  # left empty by this run; the API recreates it on upload
        sql(f"DELETE FROM district_committee_documents WHERE id={doc_id}")
    if sub_group_id:
        sql(f"DELETE FROM district_committee_sub_group WHERE id={sub_group_id}")
    if flag_before:
        sql(f"UPDATE platform_features SET enabled={int(flag_before)} WHERE feature_key='membership_fields'")
    else:
        sql("DELETE FROM platform_features WHERE feature_key='membership_fields'")
    left = sql(f"SELECT (SELECT COUNT(*) FROM member_foundation_designations WHERE fk_member_master_profile_id IN ({plain},{foreign})) "
               "+ (SELECT COUNT(*) FROM district_committee_documents WHERE title LIKE 'E2E %') "
               "+ (SELECT COUNT(*) FROM district_committee_sub_group WHERE sub_group_name='E2E sub-committee')")
    check("clean-up left no test rows", left == "0", left)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
