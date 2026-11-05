-- Looks for past misuse of the dues and event payment routes. READ-ONLY: every statement below is a SELECT.
-- Run it on a ROW or RIZones database, ideally with a read-only user or on a restored copy:
--     mysql -h <host> -u <read_only_user> -p <database> --table < paid_order_misuse_check.sql
-- Results hold member ids and order ids, not names or contact details. Treat them as confidential all the same.
--
-- HOW FAR THIS GOES
-- The flaw left no direct trace. The status route marked the row in the request as paid, but never stored the order it
-- asked the gateway about, and the row kept its own order id. So no query here can prove misuse, or prove there was none.
-- A row listed here is a row to check, not a finding. The proof is the gateway's own report: for each row in checks 3, 4
-- and 5, find its order in Cashfree and confirm that a successful payment exists for that order and amount.
--
-- The two ways in:
--   Status route: GET .../verify-payment used another order's id, which marks the row with PaidSource='Page'.
--   Forged webhook: POST .../webhook with a made-up "PAID" body, which marks the row with PaidSource='Webhook'.


-- CHECK 0: the size of the question. Online paid rows by how they were marked.
-- 'Page' is the status route, 'Webhook' the webhook, 'Reconciled' the background check that asks Cashfree itself.
SELECT 'dues' AS flow, COALESCE(PaidSource, '(none)') AS paid_source, COUNT(*) AS paid_rows, SUM(Amount) AS total_amount
FROM membership_dues_payments
WHERE IsPaid = 1 AND IsOnline = 1 AND COALESCE(isdeleted, 0) = 0
GROUP BY PaidSource
UNION ALL
SELECT 'event', COALESCE(PaidSource, '(none)'), COUNT(*), SUM(Amount)
FROM event_payment_members
WHERE IsPaid = 1 AND IsOnline = 1 AND COALESCE(isdeleted, 0) = 0
GROUP BY PaidSource;


-- CHECK 1: paid rows whose own order id does not belong to them.
-- A dues order id starts DUES<dues id>_, an event order id EVT<link id>_. Listed: no order id at all, or one naming a
-- different campaign. Event rows on the Cashfree path hold Cashfree's numeric id, which is normal and not listed.
-- Old dues rows may have lost their order id to an earlier bug, so an empty id alone is weak evidence.
SELECT 'dues' AS flow, pk_id, fk_membership_dues_id AS campaign_id, fk_member_profile_id AS member_id, Amount,
       PaidSource, PaymentDate, TransactionId AS order_id, CfOrderId AS gateway_id
FROM membership_dues_payments
WHERE IsPaid = 1 AND IsOnline = 1 AND COALESCE(isdeleted, 0) = 0
  AND (COALESCE(TransactionId, '') = ''
       OR (TransactionId LIKE 'DUES%' AND TransactionId NOT LIKE CONCAT('DUES', fk_membership_dues_id, '\_%')))
UNION ALL
SELECT 'event', pk_id, fk_payment_link_id, fk_member_profile_id, Amount,
       PaidSource, PaymentDate, NULL, CfOrderId
FROM event_payment_members
WHERE IsPaid = 1 AND IsOnline = 1 AND COALESCE(isdeleted, 0) = 0
  AND (COALESCE(CfOrderId, '') = ''
       OR (CfOrderId LIKE 'EVT%' AND CfOrderId NOT LIKE CONCAT('EVT', fk_payment_link_id, '\_%')))
ORDER BY PaymentDate DESC;


-- CHECK 2: one order id on more than one payment row. Each order is created for one row, so this should return nothing.
SELECT 'dues merchant id' AS id_kind, TransactionId AS order_id, COUNT(*) AS rows_with_it, SUM(IsPaid) AS paid_rows,
       GROUP_CONCAT(pk_id ORDER BY pk_id) AS payment_ids, GROUP_CONCAT(DISTINCT fk_member_profile_id) AS member_ids
FROM membership_dues_payments
WHERE COALESCE(TransactionId, '') <> '' AND IsOnline = 1 AND COALESCE(isdeleted, 0) = 0
GROUP BY TransactionId HAVING COUNT(*) > 1
UNION ALL
SELECT 'dues gateway id', CfOrderId, COUNT(*), SUM(IsPaid),
       GROUP_CONCAT(pk_id ORDER BY pk_id), GROUP_CONCAT(DISTINCT fk_member_profile_id)
FROM membership_dues_payments
WHERE COALESCE(CfOrderId, '') <> '' AND IsOnline = 1 AND COALESCE(isdeleted, 0) = 0
GROUP BY CfOrderId HAVING COUNT(*) > 1
UNION ALL
SELECT 'event id', CfOrderId, COUNT(*), SUM(IsPaid),
       GROUP_CONCAT(pk_id ORDER BY pk_id), GROUP_CONCAT(DISTINCT fk_member_profile_id)
FROM event_payment_members
WHERE COALESCE(CfOrderId, '') <> '' AND IsOnline = 1 AND COALESCE(isdeleted, 0) = 0
GROUP BY CfOrderId HAVING COUNT(*) > 1;


-- CHECK 3: marked paid by the status route, with no webhook and no successful settlement. THE MAIN CHECK.
-- A real payment normally brings a Cashfree webhook and later a settlement. The exploit brings neither.
-- Expect some innocent rows: a webhook can be lost, settlements lag by days, and a campaign with no split account may
-- never have settlement rows. days_to_mark helps: a real return page fires minutes after the order, so a row marked
-- days after its order was created deserves a closer look.
SELECT 'dues' AS flow, p.pk_id, p.fk_membership_dues_id AS campaign_id, p.fk_member_profile_id AS member_id, p.Amount,
       p.created_date, p.PaymentDate, DATEDIFF(p.PaymentDate, p.created_date) AS days_to_mark,
       p.TransactionId AS order_id, p.CfOrderId AS gateway_id
FROM membership_dues_payments p
LEFT JOIN membership_dues_settlements s ON s.fk_payment_id = p.pk_id AND s.SettlementStatus = 'SUCCESS'
WHERE p.IsPaid = 1 AND p.IsOnline = 1 AND COALESCE(p.isdeleted, 0) = 0
  AND p.PaidSource = 'Page' AND COALESCE(p.IsWebhookReceived, 0) = 0 AND s.pk_id IS NULL
UNION ALL
SELECT 'event', p.pk_id, p.fk_payment_link_id, p.fk_member_profile_id, p.Amount,
       p.created_date, p.PaymentDate, DATEDIFF(p.PaymentDate, p.created_date),
       NULL, p.CfOrderId
FROM event_payment_members p
LEFT JOIN event_payment_settlements s ON s.fk_member_payment_id = p.pk_id AND s.SettlementStatus = 'SUCCESS'
WHERE p.IsPaid = 1 AND p.IsOnline = 1 AND COALESCE(p.isdeleted, 0) = 0
  AND p.PaidSource = 'Page' AND COALESCE(p.IsWebhookReceived, 0) = 0 AND s.pk_id IS NULL
ORDER BY days_to_mark DESC, PaymentDate DESC;


-- CHECK 4: the same, by webhook. The dues and event webhooks check no signature, so a forged one looks like a real one.
-- A real webhook is normally followed by a settlement, so paid-by-webhook with none is worth comparing with Cashfree.
-- Same innocent causes as check 3.
SELECT 'dues' AS flow, p.pk_id, p.fk_membership_dues_id AS campaign_id, p.fk_member_profile_id AS member_id, p.Amount,
       p.created_date, p.PaymentDate, p.TransactionId AS order_id, p.CfOrderId AS gateway_id
FROM membership_dues_payments p
LEFT JOIN membership_dues_settlements s ON s.fk_payment_id = p.pk_id AND s.SettlementStatus = 'SUCCESS'
WHERE p.IsPaid = 1 AND p.IsOnline = 1 AND COALESCE(p.isdeleted, 0) = 0
  AND p.PaidSource = 'Webhook' AND s.pk_id IS NULL
UNION ALL
SELECT 'event', p.pk_id, p.fk_payment_link_id, p.fk_member_profile_id, p.Amount,
       p.created_date, p.PaymentDate, NULL, p.CfOrderId
FROM event_payment_members p
LEFT JOIN event_payment_settlements s ON s.fk_member_payment_id = p.pk_id AND s.SettlementStatus = 'SUCCESS'
WHERE p.IsPaid = 1 AND p.IsOnline = 1 AND COALESCE(p.isdeleted, 0) = 0
  AND p.PaidSource = 'Webhook' AND s.pk_id IS NULL
ORDER BY PaymentDate DESC;


-- CHECK 5: bursts. Someone scripting the flaw would mark many rows within minutes. Five or more rows in a campaign,
-- marked by the status route in the same minute, is unusual. A club paying together could also do it, so compare with checks 3 and 4.
SELECT 'dues' AS flow, fk_membership_dues_id AS campaign_id, DATE_FORMAT(PaymentDate, '%Y-%m-%d %H:%i') AS minute_marked,
       COUNT(*) AS rows_marked, SUM(Amount) AS total_amount, GROUP_CONCAT(pk_id ORDER BY pk_id) AS payment_ids
FROM membership_dues_payments
WHERE IsPaid = 1 AND IsOnline = 1 AND PaidSource = 'Page' AND COALESCE(isdeleted, 0) = 0
GROUP BY fk_membership_dues_id, DATE_FORMAT(PaymentDate, '%Y-%m-%d %H:%i') HAVING COUNT(*) >= 5
UNION ALL
SELECT 'event', fk_payment_link_id, DATE_FORMAT(PaymentDate, '%Y-%m-%d %H:%i'),
       COUNT(*), SUM(Amount), GROUP_CONCAT(pk_id ORDER BY pk_id)
FROM event_payment_members
WHERE IsPaid = 1 AND IsOnline = 1 AND PaidSource = 'Page' AND COALESCE(isdeleted, 0) = 0
GROUP BY fk_payment_link_id, DATE_FORMAT(PaymentDate, '%Y-%m-%d %H:%i') HAVING COUNT(*) >= 5
ORDER BY rows_marked DESC;
