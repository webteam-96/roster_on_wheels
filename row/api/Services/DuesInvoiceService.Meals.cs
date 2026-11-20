using Dapper;
using MySqlConnector;
using static RotaryApi.Services.DuesInvoiceMath;

namespace RotaryApi.Services;

// Meal charges (DACdb parity): a price per meeting or a club default, the diners marked from the meeting's attendance,
// guests as named lines on the host member, then billed as invoice lines on items invoices (never dues invoices, so a
// paid meal never becomes a membership_dues_payments row).
public sealed partial class DuesInvoiceService
{
    public sealed class MealMeeting
    {
        public int AttendanceId { get; set; }
        public string EventName { get; set; } = "";
        public DateTime EventDate { get; set; }
        public decimal? MeetingPrice { get; set; }
        public int Diners { get; set; }
        public int Billed { get; set; }
    }
    public sealed class MealDiner
    {
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public bool Attended { get; set; }
    }
    public sealed class MealCharge
    {
        public int Id { get; set; }
        public int AttendanceId { get; set; }
        public string EventName { get; set; } = "";
        public DateTime MealDate { get; set; }
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string GuestName { get; set; } = "";
        public decimal Amount { get; set; }
        public int? InvoiceId { get; set; }
        public string? InvoiceNo { get; set; }
        public string? InvoiceStatus { get; set; }
    }
    public sealed record MealBillResult(int InvoicesCreated, int InvoicesUpdated, int ChargesBilled, IReadOnlyList<string> InvoiceNos);

    private static void CheckPrice(decimal price)
    {
        if (price < 0 || price > 1_000_000) throw new ArgumentException("Meal price must be between 0 and 1,000,000.");
    }

    public async Task<decimal?> DefaultMealPriceAsync(int clubId)
    {
        await using var conn = Conn();
        return await conn.ExecuteScalarAsync<decimal?>("SELECT price FROM meal_prices WHERE fk_club_id = @C AND fk_attendance_id = 0", new { C = clubId });
    }

    private static Task SetPriceAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId, int attendanceId, decimal price, int userId) =>
        conn.ExecuteAsync(@"
            INSERT INTO meal_prices (fk_club_id, fk_attendance_id, price, updated_by, updated_at) VALUES (@C, @A, @P, @U, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE price = VALUES(price), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
            new { C = clubId, A = attendanceId, P = Math.Round(price, 2, MidpointRounding.AwayFromZero), U = userId }, tx);

    public async Task SetDefaultMealPriceAsync(int clubId, decimal price, int userId)
    {
        CheckPrice(price);
        await using var conn = Conn();
        await SetPriceAsync(conn, null, clubId, 0, price, userId);
    }

    public async Task<IReadOnlyList<MealMeeting>> MealMeetingsAsync(int clubId, DateTime from, DateTime to)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<MealMeeting>(@"
            SELECT a.pk_attendance_id AS AttendanceId, COALESCE(a.EventName, '') AS EventName, a.EventDateTime AS EventDate, mp.price AS MeetingPrice,
                   (SELECT COUNT(*) FROM meal_charges c WHERE c.fk_attendance_id = a.pk_attendance_id) AS Diners,
                   (SELECT COUNT(*) FROM meal_charges c WHERE c.fk_attendance_id = a.pk_attendance_id AND c.fk_invoice_id IS NOT NULL) AS Billed
            FROM club_attendance a
            LEFT JOIN meal_prices mp ON mp.fk_club_id = a.fk_club_id AND mp.fk_attendance_id = a.pk_attendance_id
            WHERE a.fk_club_id = @C AND IFNULL(a.isdeleted, 0) = 0 AND DATE(a.EventDateTime) BETWEEN @F AND @T
            ORDER BY a.EventDateTime DESC LIMIT 500", new { C = clubId, F = from.Date, T = to.Date })).ToList();
    }

    private static async Task<(string Name, DateTime Date)> MeetingOfClubAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId, int attendanceId)
    {
        var m = await conn.QueryFirstOrDefaultAsync<(string? Name, DateTime? Date)>(
            "SELECT EventName, EventDateTime FROM club_attendance WHERE pk_attendance_id = @A AND fk_club_id = @C AND IFNULL(isdeleted, 0) = 0",
            new { A = attendanceId, C = clubId }, tx);
        if (m.Date == null) throw new KeyNotFoundException("Meeting not found in this club.");
        return (m.Name ?? "", m.Date.Value);
    }

    /// <summary>The meeting's attendees first (from the attendance list), then the club's other active members, so an
    /// officer can also mark someone who ate but was not marked present.</summary>
    public async Task<(MealMeeting Meeting, IReadOnlyList<MealDiner> Members, IReadOnlyList<MealCharge> Charges)> MealMeetingAsync(int clubId, int attendanceId)
    {
        await using var conn = Conn();
        await MeetingOfClubAsync(conn, null, clubId, attendanceId);
        var meeting = (await MealMeetingsAsync(clubId, new DateTime(2000, 1, 1), new DateTime(2100, 1, 1))).FirstOrDefault(m => m.AttendanceId == attendanceId)
            ?? throw new KeyNotFoundException("Meeting not found in this club.");
        var members = (await conn.QueryAsync<MealDiner>(@"
            SELECT p.pk_member_master_profile_id AS MemberId, COALESCE(p.MemberName, '') AS MemberName,
                   EXISTS (SELECT 1 FROM club_attendance_members am WHERE am.fk_attendance_id = @A AND am.fk_member_id = p.pk_member_master_profile_id) AS Attended
            FROM member_master_profile p
            WHERE p.pk_member_master_profile_id IN (
                SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0
                UNION SELECT fk_member_id FROM club_attendance_members WHERE fk_attendance_id = @A
                UNION SELECT fk_member_profile_id FROM meal_charges WHERE fk_attendance_id = @A)
            ORDER BY Attended DESC, MemberName", new { A = attendanceId, C = clubId })).ToList();
        return (meeting, members, await MealChargesAsync(conn, clubId, attendanceId, null));
    }

    private static async Task<IReadOnlyList<MealCharge>> MealChargesAsync(MySqlConnection conn, int? clubId, int? attendanceId, int? memberId) =>
        (await conn.QueryAsync<MealCharge>(@"
            SELECT c.pk_meal_charge_id AS Id, c.fk_attendance_id AS AttendanceId, COALESCE(a.EventName, '') AS EventName, c.meal_date AS MealDate,
                   c.fk_member_profile_id AS MemberId, COALESCE(p.MemberName, '') AS MemberName, c.guest_name AS GuestName, c.amount AS Amount,
                   c.fk_invoice_id AS InvoiceId, i.invoice_no AS InvoiceNo, i.status AS InvoiceStatus
            FROM meal_charges c
            LEFT JOIN club_attendance a ON a.pk_attendance_id = c.fk_attendance_id
            LEFT JOIN member_master_profile p ON p.pk_member_master_profile_id = c.fk_member_profile_id
            LEFT JOIN dues_invoices i ON i.pk_invoice_id = c.fk_invoice_id
            WHERE (@C IS NULL OR c.fk_club_id = @C) AND (@A IS NULL OR c.fk_attendance_id = @A) AND (@M IS NULL OR c.fk_member_profile_id = @M)
            ORDER BY c.meal_date DESC, p.MemberName, c.guest_name LIMIT 2000", new { C = clubId, A = attendanceId, M = memberId })).ToList();

    /// <summary>Replaces the meeting's unbilled diners with <paramref name="diners"/> at the meeting price (set here when
    /// given, else the club default). A billed diner cannot be removed until its invoice is voided.</summary>
    public async Task<int> SaveMealDinersAsync(int clubId, int attendanceId, decimal? meetingPrice, IEnumerable<DinerInput>? diners, int userId)
    {
        var meals = Diners(diners);
        if (meetingPrice != null) CheckPrice(meetingPrice.Value);
        await using var conn = Conn();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var (_, date) = await MeetingOfClubAsync(conn, tx, clubId, attendanceId);
        if (meetingPrice != null) await SetPriceAsync(conn, tx, clubId, attendanceId, meetingPrice.Value, userId);
        var price = await conn.ExecuteScalarAsync<decimal?>(@"
            SELECT COALESCE((SELECT price FROM meal_prices WHERE fk_club_id = @C AND fk_attendance_id = @A),
                            (SELECT price FROM meal_prices WHERE fk_club_id = @C AND fk_attendance_id = 0))", new { C = clubId, A = attendanceId }, tx);
        if (meals.Count > 0 && price == null) throw new ArgumentException("Set a meal price for this meeting or a club default first.");
        var ids = meals.Select(m => m.MemberId).Distinct().ToArray();
        if (ids.Length > 0)
        {
            var known = (await conn.QueryAsync<int>(@"
                SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = @C AND IFNULL(isdeleted, 0) = 0 AND fk_member_master_profile_id IN @M",
                new { C = clubId, M = ids }, tx)).ToHashSet();
            if (ids.Any(i => !known.Contains(i))) throw new ArgumentException("Every diner must be a member of this club (guests go on their host).");
        }
        var billed = (await conn.QueryAsync<(int MemberId, string Guest)>(
            "SELECT fk_member_profile_id, guest_name FROM meal_charges WHERE fk_attendance_id = @A AND fk_invoice_id IS NOT NULL FOR UPDATE",
            new { A = attendanceId }, tx)).ToList();
        bool Same(Meal m, (int MemberId, string Guest) b) => m.MemberId == b.MemberId && string.Equals(m.GuestName, b.Guest, StringComparison.OrdinalIgnoreCase);
        if (billed.Any(b => !meals.Any(m => Same(m, b))))
            throw new InvalidOperationException("A diner you removed is already billed. Void that invoice first.");
        await conn.ExecuteAsync("DELETE FROM meal_charges WHERE fk_attendance_id = @A AND fk_invoice_id IS NULL", new { A = attendanceId }, tx);
        var fresh = meals.Where(m => !billed.Any(b => Same(m, b))).ToList();
        if (fresh.Count > 0)
            await conn.ExecuteAsync(@"
                INSERT INTO meal_charges (fk_club_id, fk_attendance_id, fk_member_profile_id, guest_name, meal_date, amount, created_by, created_at)
                VALUES (@C, @A, @MemberId, @GuestName, @D, @P, @U, UTC_TIMESTAMP())",
                fresh.Select(m => new { C = clubId, A = attendanceId, m.MemberId, m.GuestName, D = date.Date, P = price, U = userId }), tx);
        await tx.CommitAsync();
        return meals.Count;
    }

    /// <summary>Bills every unbilled meal of <paramref name="month"/>. mode "monthly": one new invoice per member;
    /// mode "open": added to the member's latest open items invoice (a new one when there is none). Free meals
    /// (price 0) are marked billed without a line.</summary>
    public async Task<MealBillResult> BillMealsAsync(int clubId, string month, string mode, DateTime issueDate, DateTime dueDate, int userId)
    {
        if (mode is not ("monthly" or "open")) throw new ArgumentException("Mode must be monthly or open.");
        var (from, to) = Month(month);
        CheckDates(issueDate, dueDate);
        await using var conn = Conn();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var seq = await LockSeqAsync(conn, tx, clubId);
        var charges = (await conn.QueryAsync<(int Id, int MemberId, string Guest, DateTime Date, decimal Amount, string? Event)>(@"
            SELECT c.pk_meal_charge_id, c.fk_member_profile_id, c.guest_name, c.meal_date, c.amount, a.EventName
            FROM meal_charges c LEFT JOIN club_attendance a ON a.pk_attendance_id = c.fk_attendance_id
            WHERE c.fk_club_id = @C AND c.fk_invoice_id IS NULL AND c.meal_date BETWEEN @F AND @T
            ORDER BY c.fk_member_profile_id, c.meal_date, c.guest_name FOR UPDATE", new { C = clubId, F = from, T = to }, tx)).ToList();
        int created = 0, updated = 0;
        var numbers = new List<string>();
        foreach (var g in charges.GroupBy(c => c.MemberId))
        {
            var paid = g.Where(c => c.Amount > 0).ToList();
            var lines = paid.Select(c => new PricedLine(null, MealLine(c.Date, c.Event, c.Guest), 1, c.Amount, c.Amount)).ToList();
            int? invoiceId = null;
            if (lines.Count > 0 && mode == "open")
            {
                var open = (await conn.QueryAsync<(int Id, decimal Amount, decimal Paid, string No)>(@"
                    SELECT pk_invoice_id, amount, paid_amount, invoice_no FROM dues_invoices
                    WHERE fk_club_id = @C AND fk_member_profile_id = @M AND fk_member_fee_id IS NULL AND status IN ('open', 'part_paid')
                    ORDER BY pk_invoice_id DESC LIMIT 1 FOR UPDATE", new { C = clubId, M = g.Key }, tx)).ToList();
                if (open.Count == 1 && open[0] is var o)
                {
                    await conn.ExecuteAsync(@"INSERT INTO dues_invoice_lines (fk_invoice_id, fk_product_id, description, quantity, unit_amount, amount)
                        VALUES (@I, NULL, @Description, @Quantity, @UnitAmount, @Amount)", lines.Select(l => new { I = o.Id, l.Description, l.Quantity, l.UnitAmount, l.Amount }), tx);
                    var total = o.Amount + lines.Sum(l => l.Amount);
                    await conn.ExecuteAsync("UPDATE dues_invoices SET amount = @A, status = @S WHERE pk_invoice_id = @Id",
                        new { A = total, S = StatusFor(total, o.Paid), o.Id }, tx);
                    invoiceId = o.Id;
                    updated++;
                    numbers.Add(o.No);
                }
            }
            if (lines.Count > 0 && invoiceId == null)
            {
                seq++;
                invoiceId = await InsertInvoiceAsync(conn, tx, clubId, null, null, g.Key, null, seq, issueDate, dueDate, lines, $"Meals {month}", userId);
                created++;
                numbers.Add(FormatInvoiceNo(seq));
            }
            // A free meal points at 0 (billed, no invoice) so it is not picked up again.
            await conn.ExecuteAsync("UPDATE meal_charges SET fk_invoice_id = @I WHERE pk_meal_charge_id IN @Ids",
                new { I = invoiceId ?? 0, Ids = g.Select(c => c.Id).ToArray() }, tx);
        }
        await SaveSeqAsync(conn, tx, clubId, seq);
        await tx.CommitAsync();
        return new MealBillResult(created, updated, charges.Count, numbers);
    }

    public async Task<IReadOnlyList<MealCharge>> MealChargesForAsync(int? clubId, int? memberId)
    {
        await using var conn = Conn();
        return await MealChargesAsync(conn, clubId, null, memberId);
    }
}
