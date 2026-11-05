"""paid_order_misuse_check.sql holds only SELECTs, runs, changes nothing, and lists the rows it is meant to find.

    python -I kb/tools/paid_order_misuse_check_e2e.py <api_base> <mysql_port> <database>
Local copies only. Adds rows titled 'e2e-misuse', removes them at the end.
"""
import pathlib, re, secrets, subprocess, sys

_, PORT, DB = sys.argv[1], sys.argv[2], sys.argv[3]
assert "production" not in DB, "local copies only"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
SCRIPT = pathlib.Path(__file__).resolve().parent / "paid_order_misuse_check.sql"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"), flush=True)
    fails += 0 if ok else 1


def checks(text):
    """The script's results, split per CHECK. mysql prints one header row per result set."""
    return [part for part in re.split(r"(?m)^(?=flow\t|id_kind\t)", text) if part.strip()]


source = SCRIPT.read_text(encoding="utf-8")
statements = [s.strip() for s in re.sub(r"(?m)^\s*--.*$", "", source).split(";") if s.strip()]
check("every statement is a SELECT", statements and all(s.upper().startswith("SELECT") for s in statements), [s[:40] for s in statements])
check("no write or session keyword anywhere", not re.search(r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE INTO|SET|GRANT|CALL|INTO OUTFILE)\b",
      re.sub(r"(?m)^\s*--.*$", "", source), re.I))

club, member, other = sql("""SELECT a.fk_club_id, a.fk_member_master_profile_id, b.fk_member_master_profile_id
    FROM club_members a JOIN club_members b ON b.fk_club_id=a.fk_club_id AND b.fk_member_master_profile_id<>a.fk_member_master_profile_id
    JOIN club_master c ON c.pk_club_id=a.fk_club_id AND c.isdeleted=0
    WHERE a.IsActive=1 AND a.isdeleted=0 AND b.IsActive=1 AND b.isdeleted=0 LIMIT 1""").split()
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1")
dues = sql(f"INSERT INTO membership_dues (fk_club_id,fk_district_id,RotaryYear,Purpose,OnlineSurchargePercent,ModeOfPayment,IsFees1,IsActive,isdeleted) VALUES ({club},{district},'{year}','e2e-misuse',0,3,1,1,0); SELECT LAST_INSERT_ID();")
fee = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id,fk_member_profile_id,AnnualAmount,Semi1Amount,Semi2Amount) VALUES ({dues},{member},100,0,0); SELECT LAST_INSERT_ID();")
link = sql(f"INSERT INTO event_payment_links (Title,fk_club_id,FormType,IsActive,isdeleted) VALUES ('e2e-misuse',{club},1,1,0); SELECT LAST_INSERT_ID();")
payments, events, settlements = [], [], []


def pay(order, source_, webhook=0, when="NOW()", created="NOW()"):
    pk = sql(f"""INSERT INTO membership_dues_payments (fk_membership_dues_id,fk_member_fee_id,fk_member_profile_id,FeeType,Amount,IsPaid,IsOnline,PaymentStatus,PaidSource,PaymentDate,TransactionId,IsWebhookReceived,created_date,isdeleted)
        VALUES ({dues},{fee},{member},1,100,1,1,'PAID','{source_}',{when},'{order}',{webhook},{created},0); SELECT LAST_INSERT_ID();""")
    payments.append(pk)
    return pk


def own(prefix="DUES", owner=None):
    return f"{prefix}{owner or dues}_{secrets.randbelow(10**20):020d}"


try:
    wrong_owner = pay(own(owner=999999), "Webhook")
    shared = own()
    twin_a, twin_b = pay(shared, "Webhook"), pay(shared, "Webhook")
    suspect = pay(own(), "Page", created="DATE_SUB(NOW(), INTERVAL 9 DAY)")
    genuine = pay(own(), "Page", webhook=1)
    forged = pay(own(), "Webhook", webhook=1)
    settled = pay(own(), "Page")
    settled_ok = sql(f"INSERT INTO membership_dues_settlements (fk_membership_dues_id,fk_payment_id,Amount,SettlementStatus) VALUES ({dues},{settled},100,'SUCCESS'); SELECT LAST_INSERT_ID();")
    burst = [pay(own(), "Page", webhook=1, when="'2026-01-15 10:30:00'") for _ in range(5)]
    ev = sql(f"""INSERT INTO event_payment_members (fk_payment_link_id,fk_member_profile_id,MemberName,Amount,IsPaid,IsOnline,PaymentStatus,PaidSource,PaymentDate,CfOrderId,IsWebhookReceived)
        VALUES ({link},{other},'x',100,1,1,'PAID','Page',NOW(),'6600000000',0); SELECT LAST_INSERT_ID();""")
    events.append(ev)

    before = sql("CHECKSUM TABLE membership_dues_payments, event_payment_members, membership_dues_settlements, event_payment_settlements")
    run = subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "--batch"], input=source, capture_output=True, text=True, encoding="utf-8")
    check("the script runs", run.returncode == 0, run.stderr)
    out = checks(run.stdout)
    check("all six checks answer", len(out) == 6, len(out))
    print(run.stdout[:1500])
    summary, wrong, dupes, by_page, by_webhook, bursts = out


    def lists(section, pk):
        return any(line.split("\t")[1] == str(pk) and line.startswith(("dues", "event")) for line in section.splitlines()[1:])


    check("check 1 finds an order id naming another campaign", lists(wrong, wrong_owner))
    check("check 1 skips a row's own order id", not lists(wrong, suspect))
    check("check 1 skips a numeric gateway id on an event", not lists(wrong, ev))
    check("check 2 finds one order on two rows", shared in dupes and f"{twin_a},{twin_b}" in dupes, dupes)
    check("check 3 finds status-route rows with no webhook or settlement", lists(by_page, suspect))
    check("check 3 shows how late it was marked", next(l for l in by_page.splitlines() if l.startswith(f"dues\t{suspect}\t")).split("\t")[7] == "9")
    check("check 3 finds the event row too", lists(by_page, ev))
    check("check 3 skips a row with a webhook", not lists(by_page, genuine))
    check("check 3 skips a row with a settlement", not lists(by_page, settled))
    check("check 4 finds webhook rows with no settlement", lists(by_webhook, forged))
    check("check 5 finds a burst", "2026-01-15 10:30" in bursts and f"\t{dues}\t" in bursts, bursts)
    check("results hold no names", "MemberName" not in run.stdout)
    check("no table changed", sql("CHECKSUM TABLE membership_dues_payments, event_payment_members, membership_dues_settlements, event_payment_settlements") == before)
finally:
    sql(f"DELETE FROM membership_dues_settlements WHERE fk_membership_dues_id={dues}")
    if payments:
        sql(f"DELETE FROM membership_dues_payments WHERE pk_id IN ({','.join(payments)})")
    if events:
        sql(f"DELETE FROM event_payment_members WHERE pk_id IN ({','.join(events)})")
    sql(f"DELETE FROM membership_dues_member_fees WHERE pk_id={fee}")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id={dues}")
    sql(f"DELETE FROM event_payment_links WHERE pk_id={link}")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
