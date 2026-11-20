"""District speaker bureau (gap #13, 2026-11-19): list, propose, approve, search, book, cancel, rate, hide a comment.

    python -I kb/tools/speaker_bureau_e2e.py <api_base> <mysql_port> <database>
Environment: ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret). Tokens are signed here for the copy's members:
club admin 1068 (club 341, Colombo West), ordinary member 999 and the copy's first Super Admin (district manager).
No email is sent by these routes. Local copies only. Everything created is removed at the end and the 'volunteers'
switch is put back as it was.
"""
import base64, datetime, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, MEMBER = 341, 1068, 999
TAG = "e2e bureau " + secrets.token_hex(3)
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def sign(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, token, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
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


sa_id = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
SA, ADM, MEM = sign(sa_id, "SuperAdmin"), sign(ADMIN, "Admin"), sign(MEMBER, "Member")
DISTRICT = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}"))
OTHER_CLUB = int(sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id<>{DISTRICT} LIMIT 1"))
OTHER_DISTRICT = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={OTHER_CLUB}"))
had_flag = sql("SELECT COUNT(*) FROM platform_features WHERE feature_key='volunteers'") != "0"
was = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='volunteers'")
D, C = f"/api/districts/{DISTRICT}/speaker-bureau", f"/api/clubs/{CLUB}/speaker-bureau"
today = datetime.date.today()
future, past = str(today + datetime.timedelta(days=20)), str(today - datetime.timedelta(days=7))
entry_ids = []

try:
    check("the volunteers module is switched on", call("PUT", "/api/features/volunteers", SA, {"enabled": True})[0] in (200, 204))

    # District manager adds a speaker (listed at once); bad input is refused.
    st, body = call("POST", D, SA, {"name": TAG + " Asha", "topics": "Polio, Water", "languages": "English, Sinhala",
                                    "email": "asha@example.invalid", "city": "Colombo", "availableOnline": True,
                                    "availableInPerson": True, "bio": "Speaks on polio."})
    check("district manager adds a speaker, approved at once", st == 200 and body["status"] == "approved", (st, body))
    asha = body["id"]; entry_ids.append(asha)
    st, body = call("POST", D, SA, {"name": TAG + " NoTopic", "topics": " , ", "availableInPerson": True})
    check("a speaker without a topic is refused (400)", st == 400, (st, body))
    st, _ = call("POST", D, ADM, {"name": TAG + " x", "topics": "x", "availableInPerson": True})
    check("a club admin cannot add straight to the district bureau (403)", st == 403, st)

    # Members find speakers.
    st, body = call("GET", C + "?topic=polio&language=sinhala", MEM)
    found = [e for e in (body or []) if e["id"] == asha]
    check("a club member finds the speaker by topic and language", st == 200 and len(found) == 1, (st, body))
    check("the member sees the contact details", found and found[0]["email"] == "asha@example.invalid", found)
    st, body = call("GET", C + "?language=Sin", MEM)
    check("language matches a whole tag only", st == 200 and all(e["id"] != asha for e in body), body)
    st, _ = call("POST", C + f"/{asha}/bookings", MEM, {"talkDate": future})
    check("an ordinary member cannot book (403)", st == 403, st)

    # Club proposes: pending, hidden from members until approved.
    st, body = call("POST", C, ADM, {"name": TAG + " Ben", "topics": "Peace", "languages": "English", "availableOnline": True})
    check("club admin proposes a speaker, pending", st == 200 and body["status"] == "pending", (st, body))
    ben = body["id"]; entry_ids.append(ben)
    st, body = call("GET", C, MEM)
    check("a pending speaker is not listed for members", all(e["id"] != ben for e in body), body)
    st, body = call("GET", D + "?status=pending", SA)
    check("the district manager sees it among pending", st == 200 and any(e["id"] == ben for e in body), (st, body))
    st, body = call("POST", D + f"/{ben}/status", SA, {"status": "approved"})
    check("the district manager approves it", st == 200 and body["status"] == "approved", (st, body))
    st, body = call("GET", C + "?mode=online", MEM)
    check("approved speaker is listed, online filter", st == 200 and any(e["id"] == ben for e in body), body)

    # Booking for a future meeting.
    st, fb = call("POST", C + f"/{asha}/bookings", ADM, {"talkDate": future})
    check("club admin books the speaker for a coming meeting", st == 200 and fb["talkDate"][:10] == future and not fb["canRate"], (st, fb))
    check("the booking puts the speaker on the club's meeting schedule",
          sql(f"SELECT COUNT(*) FROM club_speakers s JOIN speaker_bureau_talks t ON t.fk_club_speaker_id=s.pk_speaker_id "
              f"WHERE t.pk_talk_id={fb['id']} AND s.fk_club_id={CLUB} AND s.meeting_date='{future}'") == "1")
    st, body = call("POST", C + f"/{asha}/bookings", ADM, {"talkDate": future})
    check("the same booking twice is refused (400)", st == 400, (st, body))
    st, body = call("POST", C + f"/{asha}/ratings", ADM, {"talkDate": future, "rating": 5})
    check("a talk cannot be rated before it took place (400)", st == 400, (st, body))
    st, body = call("POST", C + f"/{asha}/bookings", ADM, {"talkDate": str(today + datetime.timedelta(days=800))})
    check("a booking more than two years ahead is refused (400)", st == 400, (st, body))

    # A past talk, rated.
    st, pb = call("POST", C + f"/{asha}/bookings", ADM, {"talkDate": past})
    check("club admin records a past talk", st == 200 and pb["canRate"], (st, pb))
    st, body = call("POST", C + f"/{asha}/ratings", ADM, {"talkDate": past, "rating": 7})
    check("a rating outside 1 to 5 is refused (400)", st == 400, (st, body))
    st, r = call("POST", C + f"/{asha}/ratings", ADM, {"talkDate": past, "rating": 4, "comment": TAG + " great talk"})
    check("club admin rates the talk", st == 200 and r["rating"] == 4, (st, r))
    st, body = call("POST", C + f"/{asha}/ratings", ADM, {"talkDate": past, "rating": 5})
    check("the club cannot rate the same talk twice (400)", st == 400, (st, body))
    st, body = call("GET", C + f"/{asha}", MEM)
    check("the profile shows the average and counts", st == 200 and body["entry"]["averageRating"] == 4.0
          and body["entry"]["ratingCount"] == 1 and body["entry"]["talkCount"] == 2, (st, body))
    check("the profile lists the comment", any(x["comment"] == TAG + " great talk" for x in body["ratings"]), body)
    st, body = call("GET", C + "/bookings", ADM)
    mine = {b["id"]: b for b in body or []}
    check("the club's bookings list both, the rated one with its score",
          st == 200 and fb["id"] in mine and mine.get(pb["id"], {}).get("rating") == 4 and not mine[pb["id"]]["canRate"], (st, body))
    st, body = call("GET", C + "?minRating=4.5", MEM)
    check("minimum rating filter leaves out a 4.0 speaker", st == 200 and all(e["id"] != asha for e in body), body)

    # Moderation.
    st, _ = call("POST", D + f"/ratings/{r['id']}/hide", SA, {"hidden": True})
    check("the district manager hides the comment", st == 204, st)
    st, body = call("GET", C + f"/{asha}", MEM)
    check("members no longer see the hidden comment, the score still counts",
          all(x["comment"] is None for x in body["ratings"] if x["id"] == r["id"]) and body["entry"]["averageRating"] == 4.0, body)

    # Cancel.
    st, body = call("DELETE", C + f"/bookings/{pb['id']}", ADM)
    check("a rated talk cannot be cancelled (400)", st == 400, (st, body))
    st, _ = call("DELETE", C + f"/bookings/{fb['id']}", ADM)
    check("club admin cancels the coming booking", st == 204, st)
    check("cancelling takes the speaker off the meeting schedule",
          sql(f"SELECT COUNT(*) FROM club_speakers WHERE fk_club_id={CLUB} AND meeting_date='{future}' AND name='{TAG} Asha'") == "0")

    # No IDOR.
    st, _ = call("GET", f"/api/districts/{OTHER_DISTRICT}/speaker-bureau", ADM)
    check("another district's bureau is refused (403)", st == 403, st)
    st, _ = call("GET", f"/api/clubs/{OTHER_CLUB}/speaker-bureau", MEM)
    check("another club's bureau view is refused (403)", st == 403, st)
    st, _ = call("GET", f"/api/districts/{OTHER_DISTRICT}/speaker-bureau/{asha}", SA)
    check("an entry read under another district is not found (404)", st == 404, st)
    st, _ = call("POST", f"/api/clubs/{OTHER_CLUB}/speaker-bureau/{asha}/bookings", ADM, {"talkDate": future})
    check("booking for another club is refused (403)", st == 403, st)
    st, _ = call("PUT", D + f"/{asha}", ADM, {"name": "hijack", "topics": "x", "availableInPerson": True})
    check("a club admin cannot edit a district entry (403)", st == 403, st)
finally:
    for i in entry_ids:
        call("DELETE", D + f"/{i}", SA)
    sql(f"DELETE FROM club_speakers WHERE fk_club_id={CLUB} AND name LIKE '{TAG}%'")
    sql(f"DELETE FROM speaker_bureau_entries WHERE name LIKE '{TAG}%'")
    if had_flag:
        call("PUT", "/api/features/volunteers", SA, {"enabled": was == "1"})
    else:
        sql("DELETE FROM platform_features WHERE feature_key='volunteers'")
    left = sql(f"SELECT COUNT(*) FROM speaker_bureau_entries WHERE name LIKE '{TAG}%'")
    check("test rows removed", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
