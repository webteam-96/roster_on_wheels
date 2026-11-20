"""Surveys and polls (gap #9): a club admin builds a survey with every question type, publishes it, members get a bell
notification and answer in the app, the admin reads results and a CSV. Also: an anonymous survey never shows who
answered, a closed survey refuses answers, a district survey reaches the district's officers only, and every route
refuses other clubs' admins and plain members (no IDOR).

    python -I kb/tools/surveys_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Test logins: club
admin 1068 and member 999 of club 341 (Colombo West, district 5); member 1 is a SuperAdmin (district admin here).
Writes to the given LOCAL database only and removes what it creates at the end (the surveys with their questions,
answers and notifications, one temporary district committee row). Sends no email. Never run it against production.
"""
import base64, csv, hashlib, hmac, io, json, os, subprocess, sys, time, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, OTHER_CLUB, DISTRICT = 341, 18724, 5
ADMIN, MEMBER, SUPER = 1068, 999, 1
MARK = 'e2e-survey'
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
    headers = {"Authorization": f"Bearer {tok}"} if tok else {}
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
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [{detail}]"))
    if not ok:
        fails += 1


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S+00:00')


now = datetime.now(timezone.utc)
admin, member, sa = token(ADMIN, ["Admin"]), token(MEMBER, ["Member"]), token(SUPER, ["SuperAdmin"])
other_admin = token(ADMIN, ["Admin"])  # 1068 does not manage OTHER_CLUB
created = []  # (scope, scopeId, id)
committee_row = None

QUESTIONS = [
    {"text": "Where should we meet?", "type": "single", "required": True, "options": ["Hotel", "Club house", "Online"]},
    {"text": "Which causes matter to you?", "type": "multiple", "required": False, "options": ["Polio", "Water", "Youth"]},
    {"text": "Rate this Rotary year", "type": "rating", "required": True},
    {"text": "Anything else?", "type": "text", "required": False},
]


def survey(title, anonymous=False, show=True, opens=-1):
    return {"title": f"{MARK} {title}", "description": "e2e", "isAnonymous": anonymous, "showResults": show,
            "opensAt": iso(now + timedelta(minutes=opens)), "closesAt": iso(now + timedelta(days=1)), "questions": QUESTIONS}


def answers(q, venue, causes, rating, text):
    a = [{"questionId": q[0]["id"], "choices": [venue]}, {"questionId": q[2]["id"], "rating": rating}]
    if causes:
        a.append({"questionId": q[1]["id"], "choices": causes})
    if text:
        a.append({"questionId": q[3]["id"], "text": text})
    return {"answers": a}


try:
    base = f"/api/clubs/{CLUB}/surveys"

    # ---- access: plain members and other clubs' admins are refused ----
    s, _ = call("GET", base, member)
    check("plain member cannot list the club's surveys", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{OTHER_CLUB}/surveys", other_admin)
    check("an admin cannot list another club's surveys", s == 403, s)
    s, _ = call("GET", base)
    check("no token is refused", s == 401, s)

    # ---- validation ----
    bad = survey("bad")
    bad["closesAt"] = bad["opensAt"]
    s, r = call("POST", base, admin, bad)
    check("closing before opening is refused", s == 400 and "close after" in r.get("message", ""), (s, r))
    bad = survey("bad")
    bad["questions"] = [{"text": "One option", "type": "single", "options": ["Only"]}]
    s, r = call("POST", base, admin, bad)
    check("a choice question with one option is refused", s == 400, (s, r))

    # ---- create, draft, publish ----
    s, r = call("POST", base, admin, survey("venue poll"))
    check("club admin creates a survey", s == 200 and r.get("id"), (s, r))
    sid = r["id"]
    created.append(("clubs", CLUB, sid))
    s, r = call("GET", f"{base}/{sid}", admin)
    check("draft has 4 questions and an audience", s == 200 and r["state"] == "draft" and len(r["questions"]) == 4 and r["audienceCount"] > 0, r)
    audience = r["audienceCount"]
    s, r = call("GET", "/api/mobile/surveys", member)
    check("members do not see a draft", s == 200 and all(x["id"] != sid for x in r), r)
    s, _ = call("GET", f"/api/mobile/surveys/{sid}", member)
    check("member cannot open a draft", s == 404, s)

    s, r = call("POST", f"{base}/{sid}/publish", admin)
    check("publish opens the survey", s == 200 and r["state"] == "open", (s, r))
    s, r = call("POST", f"{base}/{sid}/publish", admin)
    check("publishing twice is refused", s == 400, (s, r))
    n = int(sql(f"SELECT COUNT(*) FROM survey_notifications WHERE fk_survey_id = {sid}"))
    check("one notification per audience member", n == audience, (n, audience))
    s, r = call("GET", "/api/mobile/notifications?types=survey", member)
    items = r.get("items", r.get("Items", [])) if isinstance(r, dict) else []
    check("the member's bell has the survey", s == 200 and any(i.get("type") == "survey" and i.get("id") == sid for i in items), (s, r))

    # ---- members answer ----
    s, r = call("GET", "/api/mobile/surveys", member)
    mine = next((x for x in r if x["id"] == sid), None) if s == 200 else None
    check("member sees the open survey, unanswered", mine is not None and mine["state"] == "open" and not mine["answered"], r)
    s, r = call("GET", f"/api/mobile/surveys/{sid}", member)
    q = r["questions"]
    s, r = call("POST", f"/api/mobile/surveys/{sid}/responses", member, {"answers": [{"questionId": q[0]["id"], "choices": [0]}]})
    check("a missing required answer is refused", s == 400 and "needs an answer" in r.get("message", ""), (s, r))
    s, r = call("POST", f"/api/mobile/surveys/{sid}/responses", member, answers(q, 5, None, 3, None))
    check("an out-of-range choice is refused", s == 400, (s, r))
    s, r = call("POST", f"/api/mobile/surveys/{sid}/responses", member, answers(q, 0, [0], 2, "first try"))
    check("member answers", s == 204, (s, r))
    s, r = call("POST", f"/api/mobile/surveys/{sid}/responses", member, answers(q, 1, [0, 2], 4, "Later meetings please"))
    check("answering again replaces the answers", s == 204, (s, r))
    n = sql(f"SELECT COUNT(*) FROM survey_responses WHERE fk_survey_id = {sid}")
    check("still one response for the member", n == "1", n)
    s, r = call("GET", f"/api/mobile/surveys/{sid}", member)
    check("member sees their own answers", r["answered"] and any(a["rating"] == 4 for a in r["myAnswers"]) and r["canSeeResults"], r)
    s, r = call("POST", f"/api/mobile/surveys/{sid}/responses", admin, answers(q, 1, [1], 5, None))
    check("a second member answers", s == 204, (s, r))

    # ---- results ----
    s, r = call("GET", f"{base}/{sid}/results", admin)
    check("results count responses", s == 200 and r["responseCount"] == 2, r)
    venue, causes, rating, text = r["questions"]
    check("single choice: 2 for Club house, 100%", venue["options"][1]["count"] == 2 and venue["options"][1]["percent"] == 100, venue)
    check("multiple choice counts each pick", [o["count"] for o in causes["options"]] == [1, 1, 1], causes)
    check("rating average 4.5", rating["ratingAverage"] == 4.5, rating)
    check("named text answer shows its author", text["textAnswers"] and text["textAnswers"][0]["name"], text)
    s, r = call("GET", f"/api/mobile/surveys/{sid}/results", member)
    check("member results never carry names", s == 200 and all(t["name"] is None for t in r["questions"][3]["textAnswers"]), (s, r))
    s, body = call("GET", f"{base}/{sid}/export", admin)
    rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig")))) if s == 200 else []
    check("CSV export: header + 2 rows with names and labels",
          len(rows) == 3 and rows[0][:3] == ["Name", "Email", "Submitted (UTC)"] and "Club house" in rows[1] + rows[2], rows[:3])
    s, _ = call("GET", f"{base}/{sid}/results", member)
    check("plain member cannot read admin results", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{OTHER_CLUB}/surveys/{sid}/results", other_admin)
    check("another club's route cannot reach this survey", s == 403, s)
    s, _ = call("GET", f"/api/districts/{DISTRICT}/surveys/{sid}", sa)
    check("a club survey is not reachable through the district route", s == 404, s)

    # ---- editing a published survey ----
    upd = survey("venue poll renamed")
    upd["questions"] = [{"text": "Changed", "type": "text"}]
    s, r = call("PUT", f"{base}/{sid}", admin, upd)
    check("published: title changes, questions stay", s == 200 and r["title"].endswith("renamed") and len(r["questions"]) == 4, (s, r))

    # ---- anonymous survey ----
    s, r = call("POST", base, admin, survey("anonymous", anonymous=True))
    aid = r["id"]
    created.append(("clubs", CLUB, aid))
    call("POST", f"{base}/{aid}/publish", admin)
    s, r = call("GET", f"/api/mobile/surveys/{aid}", member)
    aq = r["questions"]
    call("POST", f"/api/mobile/surveys/{aid}/responses", member, answers(aq, 2, None, 1, "secret view"))
    s, r = call("GET", f"{base}/{aid}/results", admin)
    check("anonymous: admin results have no names", s == 200 and r["questions"][3]["textAnswers"][0]["name"] is None, r)
    s, body = call("GET", f"{base}/{aid}/export", admin)
    text_csv = body.decode("utf-8-sig") if s == 200 else ""
    member_name = sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}")
    check("anonymous: CSV has no name, email or time column", text_csv.startswith('"Where should we meet?"')
          and (not member_name or member_name not in text_csv), text_csv[:120])

    # ---- closing ----
    s, r = call("POST", f"{base}/{aid}/close", admin)
    check("close sets the state to closed", s == 200 and r["state"] == "closed", (s, r))
    s, r = call("POST", f"/api/mobile/surveys/{aid}/responses", member, answers(aq, 0, None, 5, None))
    check("a closed survey refuses answers", s == 400 and "closed" in r.get("message", ""), (s, r))

    # ---- scheduled: opens later, no bell yet ----
    s, r = call("POST", base, admin, survey("later", opens=120))
    lid = r["id"]
    created.append(("clubs", CLUB, lid))
    s, r = call("POST", f"{base}/{lid}/publish", admin)
    check("a future survey is scheduled", s == 200 and r["state"] == "scheduled", (s, r))
    s, r = call("GET", f"/api/mobile/surveys/{lid}", member)
    check("members cannot open it before it opens", s == 404, s)

    # ---- district survey: officers only ----
    year = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted, 0) = 0 LIMIT 1")
    committee_row = sql(f"""INSERT INTO district_committee_member (fk_district_id, fk_year_id, fk_member_id, name, is_active, isdeleted)
        VALUES ({DISTRICT}, {year}, {MEMBER}, '{MARK}', 1, 0); SELECT LAST_INSERT_ID();""")
    dbase = f"/api/districts/{DISTRICT}/surveys"
    s, _ = call("GET", dbase, admin)
    check("a club admin cannot manage district surveys", s == 403, s)
    d = survey("district officers")
    d["subGroupId"] = 1
    s, r = call("POST", dbase, sa, d)
    check("district surveys take no sub group", s == 400, (s, r))
    s, r = call("POST", dbase, sa, survey("district officers"))
    did = r["id"]
    created.append(("districts", DISTRICT, did))
    s, r = call("POST", f"{dbase}/{did}/publish", sa)
    check("district survey reaches its officers", s == 200 and r["audienceCount"] == 1, (s, r))
    s, _ = call("GET", f"/api/mobile/surveys/{did}", member)
    check("the officer can open it", s == 200, s)
    s, _ = call("GET", f"/api/mobile/surveys/{did}", admin)
    check("a non-officer cannot", s == 404, s)
finally:
    for scope, scope_id, i in created:
        tok = sa if scope == "districts" else admin
        s, _ = call("DELETE", f"/api/{scope}/{scope_id}/surveys/{i}", tok)
        if s != 204:
            print(f"cleanup: delete {scope} survey {i} answered {s}")
    if committee_row:
        sql(f"DELETE FROM district_committee_member WHERE id = {int(committee_row)}")
    left = sql(f"SELECT (SELECT COUNT(*) FROM surveys WHERE title LIKE '{MARK}%') + (SELECT COUNT(*) FROM district_committee_member WHERE name = '{MARK}')")
    check("cleanup removed every test row", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
