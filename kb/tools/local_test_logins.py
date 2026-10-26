"""Local test logins for the role crawls: one Club Admin, one District Admin and one AG, made from three existing
members of one club in a LOCAL copy of production (never production). Their password becomes the local SuperAdmin's
(the hash is copied, so no bcrypt library is needed). Roles are written the way the app writes them; every row this
script adds carries created_by = -7 so `--remove` can take them away again.

    python -I kb/tools/local_test_logins.py <mysql_port> <database> [club_id]          # add, prints the logins
    python -I kb/tools/local_test_logins.py <mysql_port> <database> --remove           # remove the roles again
The printed emails stay on your screen: do not commit them.
"""
import subprocess, sys

PORT, DB = sys.argv[1], sys.argv[2]
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MARK = -7


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


if len(sys.argv) > 3 and sys.argv[3] == "--remove":
    sql(f"UPDATE member_roles SET IsActive = 0, isdeleted = 1, RevokedDate = NOW() WHERE created_by = {MARK}")
    sql(f"UPDATE district_ag SET is_active = 0, isdeleted = 1 WHERE created_by = {MARK}")
    print("test roles removed")
    sys.exit(0)

club = sys.argv[3] if len(sys.argv) > 3 else sql(
    "SELECT c.pk_club_id FROM club_master c JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 "
    "JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND IFNULL(m.EmailId,'') <> '' "
    "WHERE c.isdeleted = 0 AND c.fk_district_id > 0 GROUP BY c.pk_club_id HAVING COUNT(*) >= 3 ORDER BY COUNT(*) DESC LIMIT 1")
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {club}")
year = sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")
sa = sql("SELECT r.fk_member_master_profile_id FROM member_roles r JOIN member_credentials c "
         "ON c.fk_member_master_profile_id = r.fk_member_master_profile_id WHERE r.fk_role_id = 3 AND r.IsActive = 1 LIMIT 1")
members = sql(
    f"SELECT DISTINCT m.pk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
    f"ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = {club} AND cm.IsActive = 1 "
    f"AND IFNULL(cm.isdeleted,0) = 0 AND IFNULL(m.EmailId,'') <> '' AND m.pk_member_master_profile_id <> {sa} "
    f"AND m.pk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE IsActive = 1 AND fk_role_id <> 1) "
    f"ORDER BY m.pk_member_master_profile_id LIMIT 3").split()
assert len(members) == 3, f"club {club} has fewer than 3 plain members with an email"
club_admin, district_admin, ag = members
other_club = sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id = {district} AND isdeleted = 0 "
                 f"AND pk_club_id <> {club} LIMIT 1") or club

sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, created_by) "
    f"VALUES ({club_admin}, 2, {club}, 1, {MARK})")
sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, IsActive, created_by) "
    f"VALUES ({district_admin}, 2, {district}, 1, {MARK})")
sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, IsActive, created_by) "
    f"VALUES ({ag}, 6, {district}, 1, {MARK})")
for c in sorted({club, other_club}):
    sql(f"INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, created_by) "
        f"VALUES ({district}, {ag}, {c}, {year}, {MARK}) "  # a row --remove retired keeps the club-year key: reuse it
        f"ON DUPLICATE KEY UPDATE fk_member_id = {ag}, is_active = 1, isdeleted = 0, created_by = {MARK}")
hash_ = sql(f"SELECT PasswordHash FROM member_credentials WHERE fk_member_master_profile_id = {sa} LIMIT 1")
for m in members:
    if sql(f"SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = {m}") == "0":
        sql(f"INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES ({m}, '{hash_}', 0)")
    else:
        sql(f"UPDATE member_credentials SET PasswordHash = '{hash_}', IsTemporaryPassword = 0 WHERE fk_member_master_profile_id = {m}")

print(f"club={club} district={district} other_club={other_club} year={year} (password: the local SuperAdmin's)")
for role, m in (("ClubAdmin", club_admin), ("DistrictAdmin", district_admin), ("AG", ag)):
    print(role, m, sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id = {m}"))
