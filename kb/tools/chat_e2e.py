"""Chat (build spec 3.10, flag chat): REST, authorisation, moderation and real-time delivery.

    python -I kb/tools/chat_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Writes chats, messages and
reports to the given local database plus one temporary district Admin role, and removes them again; switches the flag
through the API and puts it back. Audit rows stay (audit_log is append-only). Local copies only, never production.
"""
import base64, hashlib, hmac, json, os, socket, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
FLAG = "chat"
RS = "\x1e"  # SignalR record separator
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles, **extra):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900, **extra}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, timeout=60, raw=None, ctype="application/json"):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    headers = {"Content-Type": ctype} if data is not None else {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            try:
                return r.status, json.loads(payload) if payload else None
            except ValueError:
                return r.status, payload.decode()
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload) if payload else None
        except ValueError:
            return e.code, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def one(q):
    v = sql(q)
    return int(v) if v else None


# A club with a club admin and three plain members; an outsider from another district; the SuperAdmin.
ACTIVE = "c.isdeleted=0 AND c.IsActive=1 AND d.isdeleted=0 AND d.IsActive=1"
JOINS = "club_master c JOIN district_master d ON d.pk_district_id=c.fk_district_id"
PLAIN = ("cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND cm.fk_member_master_profile_id NOT IN "
         "(SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id<>1 AND IsActive=1 AND isdeleted=0)")
club, district = [int(x) for x in sql(
    f"SELECT c.pk_club_id, c.fk_district_id FROM {JOINS} JOIN member_roles r ON r.fk_club_id=c.pk_club_id AND r.fk_role_id=2 "
    f"AND r.IsActive=1 AND r.isdeleted=0 WHERE {ACTIVE} AND (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id=c.pk_club_id "
    f"AND {PLAIN}) >= 3 ORDER BY 1 LIMIT 1").split()]
admin = one(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={club} AND fk_role_id=2 AND IsActive=1 AND isdeleted=0 LIMIT 1")
p1, p2, p3 = [int(x) for x in sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND {PLAIN} "
                                  "ORDER BY 1 LIMIT 3").split()]
outsider, other_club = [int(x) for x in sql(
    f"SELECT cm.fk_member_master_profile_id, c.pk_club_id FROM {JOINS} JOIN club_members cm ON cm.fk_club_id=c.pk_club_id "
    f"WHERE {ACTIVE} AND c.fk_district_id<>{district} AND {PLAIN} AND cm.fk_member_master_profile_id NOT IN "
    f"(SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club}) ORDER BY 1 LIMIT 1").split()]
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
t_sa, t_admin, t_out = token(sa, "SuperAdmin"), token(admin, "Admin"), token(outsider, "Member")
t1, t2, t3 = token(p1, "Member"), token(p2, "Member"), token(p3, "Member")
t_family = token(p2, "Member", familyMemberId="1")
name2 = sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={p2}")

was_on = sql(f"SELECT COUNT(*) FROM platform_features WHERE feature_key='{FLAG}' AND enabled=1") == "1"
had_row = sql(f"SELECT COUNT(*) FROM platform_features WHERE feature_key='{FLAG}'") == "1"
start_conv = one("SELECT COALESCE(MAX(pk_conversation_id),0) FROM chat_conversations")
start_msg = one("SELECT COALESCE(MAX(pk_message_id),0) FROM chat_messages")
start_report = one("SELECT COALESCE(MAX(pk_report_id),0) FROM chat_reports")
chat_audit_before = one("SELECT COUNT(*) FROM audit_log WHERE details LIKE '% /api/chat/%'")
temp_role = None
restore_force = None
MOD = f"/api/clubs/{club}/chat-moderation"


def send(tok, conv, text, key=None):
    return call("POST", f"/api/chat/conversations/{conv}/messages", tok, {"body": text, "clientKey": key})


def hub(tok):
    """Negotiates and opens a long-polling SignalR connection; returns its id after the handshake."""
    q = f"access_token={urllib.parse.quote(tok)}"
    s, neg = call("POST", f"/api/chat/hub/negotiate?negotiateVersion=1&{q}")
    cid = neg["connectionToken"]
    call("GET", f"/api/chat/hub?id={cid}&{q}")  # first poll returns at once
    call("POST", f"/api/chat/hub?id={cid}&{q}", raw=('{"protocol":"json","version":1}' + RS).encode(), ctype="text/plain")
    s, hand = call("GET", f"/api/chat/hub?id={cid}&{q}", timeout=10)
    return cid, q, s == 200 and hand == "{}" + RS


def poll(cid, q, seconds):
    try:
        return call("GET", f"/api/chat/hub?id={cid}&{q}", timeout=seconds)[1] or ""
    except (TimeoutError, socket.timeout, urllib.error.URLError):
        return ""  # nothing arrived in time


try:
    # Off: every chat route and the hub answer 404.
    call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": False})
    check("flag off: chat 404", call("GET", "/api/chat/conversations", t1)[0] == 404)
    check("flag off: hub 404", call("POST", f"/api/chat/hub/negotiate?access_token={t1}")[0] == 404)
    check("flag off: moderation 404", call("GET", f"{MOD}/reports", t_admin)[0] == 404)
    check("SuperAdmin switches the flag on", call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": True})[0] in (200, 204))
    check("flag listed as flagged", any(f["key"] == FLAG and f["kind"] == "flagged" for f in call("GET", "/api/features", t_sa)[1]))

    check("signed out: 401", call("GET", "/api/chat/conversations")[0] == 401)
    check("family session refused", call("GET", "/api/chat/conversations", t_family)[0] == 403)
    check("query token refused outside the hub", call("GET", f"/api/chat/conversations?access_token={t1}")[0] == 401)

    # Direct chat between two members of the club.
    s, direct = call("POST", "/api/chat/conversations", t1, {"kind": "direct", "scope": "club", "ownerId": club, "memberIds": [p2]})
    check("member opens a direct chat", s == 200 and direct["kind"] == "direct" and direct["title"] == name2
          and direct["otherMemberId"] == p2, (s, direct))
    conv = direct["id"]
    s, again = call("POST", "/api/chat/conversations", t2, {"kind": "direct", "scope": "club", "ownerId": club, "memberIds": [p1]})
    check("opening it again returns the same chat", s == 200 and again["id"] == conv, (s, again))
    check("direct chat with a member of another club refused",
          call("POST", "/api/chat/conversations", t1, {"kind": "direct", "scope": "club", "ownerId": club, "memberIds": [outsider]})[0] == 400)
    check("outsider cannot open a chat in the club",
          call("POST", "/api/chat/conversations", t_out, {"kind": "direct", "scope": "club", "ownerId": club, "memberIds": [p1]})[0] == 403)
    check("direct chat in a district refused",
          call("POST", "/api/chat/conversations", t1, {"kind": "direct", "scope": "district", "ownerId": district, "memberIds": [p2]})[0] == 400)

    # Send: stored as typed (plain text), idempotent with a client key, validated.
    text = "Hello <b>world</b> & 'friends' \U0001F64F"
    s, m1 = send(t1, conv, text, "e2e-key-1")
    check("message sent and stored as typed", s == 200 and m1["body"] == text and m1["senderId"] == p1 and not m1["hidden"], (s, m1))
    s, retry = send(t1, conv, text, "e2e-key-1")
    check("retry with the same client key returns the stored message", s == 200 and retry["id"] == m1["id"], (s, retry))
    check("empty message refused", send(t1, conv, "   ")[0] == 400)
    check("message over 2000 characters refused", send(t1, conv, "x" * 2001)[0] == 400)

    s, lst = call("GET", "/api/chat/conversations", t2)
    mine = next((c for c in lst or [] if c["id"] == conv), None)
    check("recipient's list: one unread, last message", mine and mine["unread"] == 1 and mine["lastBody"] == text, mine)
    s, hist = call("GET", f"/api/chat/conversations/{conv}/messages", t2)
    check("recipient reads the history", s == 200 and [m["id"] for m in hist] == [m1["id"]] and hist[0]["body"] == text, (s, hist))
    check("read state saved", call("POST", f"/api/chat/conversations/{conv}/read", t2, {"messageId": m1["id"]})[0] == 204)
    mine = next(c for c in call("GET", "/api/chat/conversations", t2)[1] if c["id"] == conv)
    check("unread back to 0", mine["unread"] == 0, mine)
    s, members = call("GET", f"/api/chat/conversations/{conv}/members", t1)
    check("members show the read position", s == 200 and {m["memberId"]: m["lastReadMessageId"] for m in members}.get(p2) == m1["id"], members)

    # Authorisation: a member of another club, and the club's admin, cannot read or post.
    for who, tok in (("outsider", t_out), ("club admin outside the chat", t_admin)):
        check(f"{who} cannot read the messages", call("GET", f"/api/chat/conversations/{conv}/messages", tok)[0] == 404)
        check(f"{who} cannot post", send(tok, conv, "hi")[0] == 404)
    check("outsider cannot list the members", call("GET", f"/api/chat/conversations/{conv}/members", t_out)[0] == 404)
    check("outsider cannot report", call("POST", f"/api/chat/messages/{m1['id']}/report", t_out, {"reason": "x"})[0] == 404)
    check("outsider's list does not show the chat", all(c["id"] != conv for c in call("GET", "/api/chat/conversations", t_out)[1]))

    # History paging.
    later = [send(t1, conv, f"message {i}")[1]["id"] for i in (2, 3, 4)]
    ids = lambda path: [m["id"] for m in call("GET", path, t2)[1]]
    check("latest page, oldest first", ids(f"/api/chat/conversations/{conv}/messages?limit=2") == later[1:])
    check("page before", ids(f"/api/chat/conversations/{conv}/messages?before={later[1]}&limit=2") == [m1["id"], later[0]])
    check("catch up after", ids(f"/api/chat/conversations/{conv}/messages?after={later[0]}") == later[1:])

    # Groups.
    s, grp = call("POST", "/api/chat/conversations", t1, {"kind": "group", "scope": "club", "ownerId": club, "memberIds": [p2, p3], "title": "E2E group"})
    check("member starts a club group", s == 200 and grp["title"] == "E2E group" and grp["isOwner"] and grp["memberCount"] == 3, (s, grp))
    g = grp["id"]
    check("group with a member of another club refused", call("POST", "/api/chat/conversations", t1,
          {"kind": "group", "scope": "club", "ownerId": club, "memberIds": [p2, outsider], "title": "x"})[0] == 400)
    check("group without a name refused", call("POST", "/api/chat/conversations", t1,
          {"kind": "group", "scope": "club", "ownerId": club, "memberIds": [p2], "title": " "})[0] == 400)
    check("only the owner adds members", call("POST", f"/api/chat/conversations/{g}/members", t2, {"memberIds": [admin]})[0] == 403)
    check("outsider cannot be added", call("POST", f"/api/chat/conversations/{g}/members", t1, {"memberIds": [outsider]})[0] == 400)
    check("group message", send(t3, g, "group hello")[0] == 200)
    check("member leaves the group", call("DELETE", f"/api/chat/conversations/{g}/members/{p3}", t3)[0] == 204)
    check("after leaving, no access", call("GET", f"/api/chat/conversations/{g}/messages", t3)[0] == 404)
    check("non-owner cannot remove others", call("DELETE", f"/api/chat/conversations/{g}/members/{p1}", t2)[0] == 403)
    check("owner leaves", call("DELETE", f"/api/chat/conversations/{g}/members/{p1}", t1)[0] == 204)
    check("ownership passes on", next(c for c in call("GET", "/api/chat/conversations", t2)[1] if c["id"] == g)["isOwner"])
    check("a direct chat has no members to remove", call("DELETE", f"/api/chat/conversations/{conv}/members/{p2}", t1)[0] == 400)

    # District group: started by the district's managers (a temporary district Admin role for p3).
    temp_role = int(sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, IsActive, isdeleted) "
                        f"VALUES ({p3}, 2, {district}, 1, 0); SELECT LAST_INSERT_ID();").splitlines()[-1])
    district_group = {"kind": "group", "scope": "district", "ownerId": district, "memberIds": [p1], "title": "E2E district"}
    s, body = call("POST", "/api/chat/conversations", t1, {**district_group, "memberIds": [p2]})
    check("plain member cannot start a district group", s == 403, (s, body))
    s, dg = call("POST", "/api/chat/conversations", t3, district_group)
    check("district admin starts a district group", s == 200 and dg["scope"] == "district", (s, dg))
    s, dmsg = send(t1, dg["id"], "district hello")
    check("district group member posts", s == 200, (s, dmsg))
    check("outsider cannot read the district group", call("GET", f"/api/chat/conversations/{dg['id']}/messages", t_out)[0] == 404)

    # Real time: the recipient's connection gets the message, an outsider's and a family session's do not.
    check("hub refuses a missing token", call("POST", "/api/chat/hub/negotiate?negotiateVersion=1")[0] == 401)
    rc, rq, ok_r = hub(t2)
    oc, oq, ok_o = hub(t_out)
    fc, fq, ok_f = hub(t_family)
    check("hub handshake with the query token", ok_r and ok_o and ok_f)
    s, live = send(t1, conv, "realtime e2e")
    got = {}
    threads = [threading.Thread(target=lambda k=k, c=c, q=q: got.__setitem__(k, poll(c, q, 5))) for k, c, q in
               (("recipient", rc, rq), ("outsider", oc, oq), ("family", fc, fq))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    check("recipient's connection gets the message", '"target":"message"' in got["recipient"] and "realtime e2e" in got["recipient"], got["recipient"])
    check("outsider's connection gets nothing", "realtime e2e" not in got["outsider"], got["outsider"])
    check("family session's connection gets nothing", "realtime e2e" not in got["family"], got["family"])
    for c, q in ((rc, rq), (oc, oq), (fc, fq)):
        call("DELETE", f"/api/chat/hub?id={c}&{q}")

    # WebSocket upgrade with the token in the query.
    s, neg = call("POST", f"/api/chat/hub/negotiate?negotiateVersion=1&access_token={t2}")
    host, port = urllib.parse.urlparse(API).hostname, urllib.parse.urlparse(API).port or 80
    with socket.create_connection((host, port), timeout=10) as sock:
        sock.sendall((f"GET /api/chat/hub?id={neg['connectionToken']}&access_token={t2} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                      "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                      "Sec-WebSocket-Version: 13\r\n\r\n").encode())
        status = sock.recv(200).decode(errors="replace").split("\r\n")[0]
    check("WebSocket upgrade accepted with the query token", " 101 " in status, status)

    # A forced re-login (the member's mobile number changed) shuts the old app token out of the hub too.
    restore_force = sql(f"SELECT CONCAT_WS('|', IFNULL(DATE_FORMAT(mobile_force_relogin_at, '%Y-%m-%d %H:%i:%s'), 'NULL'), "
                        f"IFNULL(DATE_FORMAT(modified_date, '%Y-%m-%d %H:%i:%s'), 'NULL')) FROM member_master_profile "
                        f"WHERE pk_member_master_profile_id={p3}").split("|")
    sql(f"UPDATE member_master_profile SET mobile_force_relogin_at=NOW() WHERE pk_member_master_profile_id={p3}")
    t_stale = token(p3, "Member", loginType="mobile", iat=int(time.time()) - 86400)
    check("forced re-login: REST refuses the old token", call("GET", "/api/chat/conversations", t_stale)[0] == 401)
    check("forced re-login: hub refuses the old token",
          call("POST", f"/api/chat/hub/negotiate?negotiateVersion=1&access_token={t_stale}")[0] == 401)

    # Reports and moderation.
    check("member reports a message", call("POST", f"/api/chat/messages/{m1['id']}/report", t2, {"reason": "Not kind"})[0] == 204)
    check("reporting it again keeps one report", call("POST", f"/api/chat/messages/{m1['id']}/report", t2, {"reason": "again"})[0] == 204
          and sql(f"SELECT COUNT(*) FROM chat_reports WHERE message_id={m1['id']}") == "1")
    check("own message cannot be reported", call("POST", f"/api/chat/messages/{later[0]}/report", t1, {})[0] == 400)
    check("plain member cannot see the queue", call("GET", f"{MOD}/reports", t2)[0] == 403)
    check("club admin cannot see another club's queue", call("GET", f"/api/clubs/{other_club}/chat-moderation/reports", t_admin)[0] == 403)
    check("club admin cannot moderate the district", call("GET", f"/api/districts/{district}/chat-moderation/reports", t_admin)[0] == 403)
    check("SuperAdmin sees the district queue", call("GET", f"/api/districts/{district}/chat-moderation/reports", t_sa)[0] == 200)
    s, queue = call("GET", f"{MOD}/reports", t_admin)
    rep = next((r for r in queue or [] if r["messageId"] == m1["id"]), None)
    check("club admin sees the report with the message", s == 200 and rep and rep["messageBody"] == text and rep["reason"] == "Not kind"
          and rep["senderId"] == p1 and rep["reporterId"] == p2 and rep["conversationKind"] == "direct", rep)

    check("hide", call("POST", f"{MOD}/messages/{m1['id']}/hide", t_admin)[0] == 204)
    first = call("GET", f"/api/chat/conversations/{conv}/messages?before={later[0]}", t2)[1][0]
    check("hidden message has no text for members", first["hidden"] and first["body"] is None, first)
    check("unhide", call("POST", f"{MOD}/messages/{m1['id']}/unhide", t_admin)[0] == 204
          and call("GET", f"/api/chat/conversations/{conv}/messages?before={later[0]}", t2)[1][0]["body"] == text)
    call("POST", f"{MOD}/messages/{m1['id']}/hide", t_admin)
    check("hide a district group message from the club: 404", call("POST", f"{MOD}/messages/{dmsg['id']}/hide", t_admin)[0] == 404)
    check("plain member cannot hide", call("POST", f"{MOD}/messages/{m1['id']}/hide", t2)[0] == 403)

    check("mute", call("POST", f"{MOD}/conversations/{conv}/mute/{p1}", t_admin)[0] == 204)
    check("muted member cannot post", send(t1, conv, "muted?")[0] == 403)
    check("muted member still reads", call("GET", f"/api/chat/conversations/{conv}/messages", t1)[0] == 200)
    check("mute shows in the queue", next(r for r in call("GET", f"{MOD}/reports", t_admin)[1] if r["messageId"] == m1["id"])["senderMuted"])
    check("unmute", call("POST", f"{MOD}/conversations/{conv}/unmute/{p1}", t_admin)[0] == 204 and send(t1, conv, "back")[0] == 200)
    check("mute someone not in the chat: 404", call("POST", f"{MOD}/conversations/{conv}/mute/{outsider}", t_admin)[0] == 404)
    check("district group not moderated from the club", call("POST", f"{MOD}/conversations/{dg['id']}/mute/{p1}", t_admin)[0] == 404)

    rid = rep["id"]
    check("resolve", call("POST", f"{MOD}/reports/{rid}/resolve", t_admin, {"note": "Hidden and warned"})[0] == 204)
    check("resolved report leaves the open queue", all(r["id"] != rid for r in call("GET", f"{MOD}/reports", t_admin)[1]))
    done = next((r for r in call("GET", f"{MOD}/reports?status=resolved", t_admin)[1] if r["id"] == rid), None)
    check("resolved list shows the note and who resolved", done and done["resolution"] == "Hidden and warned" and done["resolvedAt"] and done["resolvedByName"], done)
    check("resolve a report of another club: 404", call("POST", f"/api/clubs/{other_club}/chat-moderation/reports/{rid}/resolve", t_sa, {})[0] == 404)

    audit = sql(f"SELECT COUNT(*), MIN(entity_type) FROM audit_log WHERE details LIKE 'POST /api/clubs/{club}/chat-moderation/%' "
                "AND created_date >= NOW() - INTERVAL 10 MINUTE").split()
    check("moderation actions are in the audit log", int(audit[0]) >= 6 and " ".join(audit[1:]) == "Chat Moderation", audit)
    check("members' chat writes are not in the audit log",
          one("SELECT COUNT(*) FROM audit_log WHERE details LIKE '% /api/chat/%'") == chat_audit_before)

    # Rate limit: 30 messages a minute per member.
    codes = [send(t2, conv, f"burst {i}")[0] for i in range(35)]
    check("rate limit on send", 429 in codes and codes.count(200) <= 30, codes)
finally:
    if restore_force:
        q = lambda v: "NULL" if v == "NULL" else f"'{v}'"
        sql(f"UPDATE member_master_profile SET mobile_force_relogin_at={q(restore_force[0])}, modified_date={q(restore_force[1])} "
            f"WHERE pk_member_master_profile_id={p3}")
    if temp_role:
        sql(f"DELETE FROM member_roles WHERE pk_member_role_id={temp_role}")
    sql(f"DELETE FROM chat_reports WHERE pk_report_id>{start_report}")
    sql(f"DELETE FROM chat_messages WHERE pk_message_id>{start_msg}")
    sql(f"DELETE FROM chat_members WHERE conversation_id>{start_conv}")
    sql(f"DELETE FROM chat_conversations WHERE pk_conversation_id>{start_conv}")
    call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": was_on})
    if not had_row:
        sql(f"DELETE FROM platform_features WHERE feature_key='{FLAG}'")  # no row and a 0 row both mean off
    left = sql(f"SELECT (SELECT COUNT(*) FROM chat_conversations WHERE pk_conversation_id>{start_conv}) + "
               f"(SELECT COUNT(*) FROM chat_messages WHERE pk_message_id>{start_msg}) + "
               f"(SELECT COUNT(*) FROM member_roles WHERE pk_member_role_id={temp_role or 0})")
    check("test rows removed", left == "0", left)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)
