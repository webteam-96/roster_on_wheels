"""Job postings and B2B offers (flag job_board): a member posts, the district admin approves, members of the same
district browse and search, members of other districts never see it, abuse reports hide a post until an admin keeps
or removes it, reject with a note, withdraw, expiry, and the access checks.

    python -I kb/tools/job_board_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Writes test rows to
the given LOCAL database only and removes them at the end (a temporary district Admin role, the posts and reports,
the feature switch). audit_log rows stay: that table is append-only by design. No email is sent by this module.
Never run it against production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MARK = 'e2e-jobboard'
ROLE_MARK = -5131
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


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {tok}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, rtype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, rtype = e.read(), e.code, e.headers.get("Content-Type", "")
    if "json" in rtype and payload:
        return status, json.loads(payload)
    return status, payload


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def ids(r):
    return [p["id"] for p in r[1]] if r[0] == 200 and isinstance(r[1], list) else []


# ── People, picked by query: plain members (no roles but Member) of active clubs ──────────────────────────────────
NO_ROLES = ("NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id=cm.fk_member_master_profile_id "
            "AND x.fk_role_id<>1 AND x.IsActive=1 AND x.isdeleted=0)")
# members of exactly one club, so the district of a member is unambiguous
ONE_CLUB = ("(SELECT COUNT(*) FROM club_members y WHERE y.fk_member_master_profile_id=cm.fk_member_master_profile_id "
            "AND y.IsActive=1 AND IFNULL(y.isdeleted,0)=0)=1")
PLAIN = (f"FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.IsActive=1 AND IFNULL(c.isdeleted,0)=0 "
         f"WHERE cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND {NO_ROLES} AND {ONE_CLUB}")
district = one(f"SELECT c.fk_district_id {PLAIN} AND c.fk_district_id>0 GROUP BY c.fk_district_id "
               "HAVING COUNT(DISTINCT cm.fk_member_master_profile_id)>=6 ORDER BY COUNT(*) DESC LIMIT 1")
people = [int(x) for x in sql(f"SELECT DISTINCT cm.fk_member_master_profile_id {PLAIN} AND c.fk_district_id={district} "
                              "ORDER BY 1 LIMIT 6").split()]
poster, viewer, r1, r2, dadmin = people[:5]
outsider = one(f"SELECT cm.fk_member_master_profile_id {PLAIN} AND c.fk_district_id>0 AND c.fk_district_id<>{district} "
               "ORDER BY 1 LIMIT 1")
other_district = one(f"SELECT c.fk_district_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id "
                     f"WHERE cm.fk_member_master_profile_id={outsider} LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
assert None not in (district, outsider, other_district, sa) and len(people) >= 5, "test data missing"
print(f"district {district}, other district {other_district}")

T = {n: token(m, "Member") for n, m in
     dict(poster=poster, viewer=viewer, r1=r1, r2=r2, outsider=outsider).items()}
t_da, t_sa = token(dadmin, "Admin"), token(sa, "SuperAdmin")
M, D, DO = "/api/mobile/job-board", f"/api/districts/{district}/job-board", f"/api/districts/{other_district}/job-board"

# ── Setup (undone in finally) ───────────────────────────────────────────────────────────────────────────────────
sql(f"DELETE FROM job_board_posts WHERE title LIKE '{MARK}%'")
sql(f"DELETE FROM member_roles WHERE created_by={ROLE_MARK}")
flag_before = sql("SELECT enabled FROM platform_features WHERE feature_key='job_board'")
job = offer = None


def post(tok, **kw):
    body = dict(kind="job", title=f"{MARK} Accountant", description="Part-time bookkeeping for a small firm.",
                company="Acme Traders", location="Colombo", contact="hr@example.org")
    body.update(kw)
    return call("POST", M, tok, body)


try:
    # ── Feature flag ──────────────────────────────────────────────────────────────────────────────────────────
    call("PUT", "/api/features/job_board", t_sa, {"enabled": False})
    r = call("GET", M, T["viewer"])
    check("flag off: the board answers 404", r[0] == 404, r)
    r = call("PUT", "/api/features/job_board", t_sa, {"enabled": True})
    check("SuperAdmin switches the board on", r[0] in (200, 204), r)


    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, AllClubsAccess, IsActive, created_by) "
        f"VALUES ({dadmin}, 2, {district}, 0, 1, {ROLE_MARK})")

    # ── Validation ────────────────────────────────────────────────────────────────────────────────────────────
    check("a bad kind is refused", post(T["poster"], kind="event")[0] == 400)
    check("a missing title is refused", post(T["poster"], title=" ")[0] == 400)
    check("a missing contact is refused", post(T["poster"], contact="")[0] == 400)
    check("a past expiry is refused", post(T["poster"], expiresOn="2020-01-01")[0] == 400)
    check("more than 90 days is refused", post(T["poster"], expiresOn="2099-01-01")[0] == 400)

    # ── Post, approve, browse ─────────────────────────────────────────────────────────────────────────────────
    r = post(T["poster"])
    job = r[1].get("id") if r[0] == 200 else None
    check("a member posts a job", job is not None, r)
    row = sql(f"SELECT fk_district_id, status, expires_on = UTC_DATE() + INTERVAL 30 DAY FROM job_board_posts WHERE pk_post_id={job}").split()
    check("stored pending, in the poster's district, 30 days by default", row == [str(district), "pending", "1"], row)
    check("a pending post is not on the board", job not in ids(call("GET", M, T["viewer"])))
    mine = call("GET", M + "/mine", T["poster"])
    check("the poster sees it as pending", any(p["id"] == job and p["status"] == "pending" for p in mine[1]), mine)

    check("a member cannot read the district queue", call("GET", D, T["viewer"])[0] == 403)
    check("the district admin cannot read another district's queue", call("GET", DO, t_da)[0] == 403)
    q = call("GET", D + "?filter=pending", t_da)
    check("the district admin sees it waiting", job in ids(q), q)
    check("a bad filter is refused", call("GET", D + "?filter=all", t_da)[0] == 400)
    check("a member cannot approve", call("PUT", f"{D}/{job}/review", T["viewer"], {"action": "approve"})[0] == 403)
    check("the post is not reviewable through another district",
          call("PUT", f"{DO}/{job}/review", t_da, {"action": "approve"})[0] == 403)
    check("a bad action is refused", call("PUT", f"{D}/{job}/review", t_da, {"action": "publish"})[0] == 400)
    r = call("PUT", f"{D}/{job}/review", t_da, {"action": "approve"})
    check("the district admin approves", r[0] == 204, r)
    check("a live post cannot be rejected", call("PUT", f"{D}/{job}/review", t_da, {"action": "reject"})[0] == 400)

    b = call("GET", M, T["viewer"])
    check("a member of the district sees the live post", job in ids(b), b)
    check("a member of another district does not", job not in ids(call("GET", M, T["outsider"])))
    check("search by company finds it", job in ids(call("GET", M + "?q=" + urllib.parse.quote("acme trad"), T["viewer"])))
    check("search for something else does not", job not in ids(call("GET", M + "?q=zzqq-no-such", T["viewer"])))
    check("the offers filter leaves the job out", job not in ids(call("GET", M + "?kind=offer", T["viewer"])))
    check("a bad kind filter is refused", call("GET", M + "?kind=event", T["viewer"])[0] == 400)
    check("search wildcards are literal", job not in ids(call("GET", M + "?q=%25", T["viewer"])))

    # ── Abuse reports ─────────────────────────────────────────────────────────────────────────────────────────
    check("the poster cannot report their own post",
          call("POST", f"{M}/{job}/report", T["poster"], {"reason": "x"})[0] == 400)
    check("a member of another district cannot report it",
          call("POST", f"{M}/{job}/report", T["outsider"], {"reason": "x"})[0] == 404)
    for n in ("viewer", "r1"):
        call("POST", f"{M}/{job}/report", T[n], {"reason": f"{MARK} looks like a scam"})
    call("POST", f"{M}/{job}/report", T["viewer"], {"reason": f"{MARK} reported twice"})
    check("a second report by the same member counts once",
          one(f"SELECT COUNT(*) FROM job_board_reports WHERE fk_post_id={job}") == 2)
    check("two reports keep the post on the board", job in ids(call("GET", M, T["viewer"])))
    r = call("POST", f"{M}/{job}/report", T["r2"], {"reason": f"{MARK} spam"})
    check("a third report is taken", r[0] == 204, r)
    check("three open reports hide the post", job not in ids(call("GET", M, T["viewer"])))
    q = call("GET", D + "?filter=reported", t_da)
    item = next((p for p in q[1] if p["id"] == job), {}) if q[0] == 200 else {}
    check("the admin sees it under Reported with the reasons",
          item.get("openReports") == 3 and len(item.get("reports") or []) == 3, q)
    r = call("PUT", f"{D}/{job}/review", t_da, {"action": "approve", "note": "Checked, genuine"})
    check("the admin keeps it", r[0] == 204, r)
    check("keeping closes the reports", one(f"SELECT COUNT(*) FROM job_board_reports WHERE fk_post_id={job} AND resolved_at IS NULL") == 0)
    check("the kept post is back on the board", job in ids(call("GET", M, T["viewer"])))

    # ── Reject with a note, remove, withdraw ──────────────────────────────────────────────────────────────────
    r = post(T["poster"], kind="offer", title=f"{MARK} 10% off printing for members", company=None)
    offer = r[1].get("id") if r[0] == 200 else None
    check("a member posts a B2B offer", offer is not None, r)
    r = call("PUT", f"{D}/{offer}/review", t_da, {"action": "reject", "note": "Please add the terms"})
    check("the admin rejects it", r[0] == 204, r)
    mine = call("GET", M + "/mine", T["poster"])
    o = next((p for p in mine[1] if p["id"] == offer), {})
    check("the poster sees the rejection and the note", o.get("status") == "rejected" and o.get("reviewNote") == "Please add the terms", o)
    check("a rejected post cannot be withdrawn", call("DELETE", f"{M}/{offer}", T["poster"])[0] == 404)
    check("someone else cannot withdraw the job", call("DELETE", f"{M}/{job}", T["viewer"])[0] == 404)
    r = call("DELETE", f"{M}/{job}", T["poster"])
    check("the poster withdraws the job", r[0] == 204, r)
    check("a withdrawn post leaves the board", job not in ids(call("GET", M, T["viewer"])))
    check("a withdrawn post cannot be approved again", call("PUT", f"{D}/{job}/review", t_da, {"action": "approve"})[0] == 400)
    check("the closed list holds both", {job, offer} <= set(ids(call("GET", D + "?filter=closed", t_da))))

    # ── Expiry ────────────────────────────────────────────────────────────────────────────────────────────────
    r = post(T["poster"], title=f"{MARK} Driver")
    third = r[1].get("id") if r[0] == 200 else None
    call("PUT", f"{D}/{third}/review", t_da, {"action": "approve"})
    check("the third post is live", third in ids(call("GET", M, T["viewer"])))
    r = call("PUT", f"{D}/{third}/review", t_da, {"action": "remove", "note": "Filled"})
    check("the admin removes a live post", r[0] == 204 and third not in ids(call("GET", M, T["viewer"])), r)
    r = post(T["poster"], title=f"{MARK} Clerk")
    fourth = r[1].get("id") if r[0] == 200 else None
    call("PUT", f"{D}/{fourth}/review", t_da, {"action": "approve"})
    sql(f"UPDATE job_board_posts SET expires_on = UTC_DATE() - INTERVAL 1 DAY WHERE pk_post_id={fourth}")
    check("an expired post leaves the board", fourth not in ids(call("GET", M, T["viewer"])))
    mine = call("GET", M + "/mine", T["poster"])
    check("the poster sees it as expired", any(p["id"] == fourth and p["status"] == "expired" for p in mine[1]), mine)
    check("an expired post is under Closed", fourth in ids(call("GET", D + "?filter=closed", t_da)))
    check("an expired post cannot be reported", call("POST", f"{M}/{fourth}/report", T["viewer"], {})[0] == 404)

    # ── Spam limit ────────────────────────────────────────────────────────────────────────────────────────────
    made = [post(T["r1"], title=f"{MARK} limit {i}")[0] for i in range(11)]
    check("a member has 10 open posts at most", made[:10] == [200] * 10 and made[10] == 400, made)
finally:
    sql(f"DELETE FROM job_board_posts WHERE title LIKE '{MARK}%'")
    sql(f"DELETE FROM member_roles WHERE created_by={ROLE_MARK}")
    call("PUT", "/api/features/job_board", t_sa, {"enabled": flag_before == "1"})
    if flag_before == "":
        sql("DELETE FROM platform_features WHERE feature_key='job_board'")
    left = one(f"SELECT COUNT(*) FROM job_board_posts WHERE title LIKE '{MARK}%'") + \
        one(f"SELECT COUNT(*) FROM job_board_reports WHERE reason LIKE '{MARK}%'")
    check("cleanup left no test rows", left == 0, left)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
