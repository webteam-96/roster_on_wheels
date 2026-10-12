using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class PphCampService : IPphCampService
{
    private readonly string _connectionString;
    private readonly ICitationRecalcTrigger _citationRecalc;

    public PphCampService(IConfiguration configuration, ICitationRecalcTrigger citationRecalc)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _citationRecalc = citationRecalc;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Camps ──────────────────────────────────────────────────────────

    public async Task<IEnumerable<PphCampListDto>> GetCampsAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryAsync<PphCampListDto>(
            @"SELECT c.pk_camp_id AS Id, c.Title, c.Description, c.Address,
                     c.CampDate,
                     CASE
                         WHEN c.CampLogoPath IS NULL OR c.CampLogoPath = '' THEN NULL
                         WHEN c.CampLogoPath LIKE '/%' THEN c.CampLogoPath
                         WHEN c.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Campmaster/District', c.fk_district_id, '/', c.CampLogoPath)
                         ELSE CONCAT('/Documents/Campmaster/Group', c.fk_club_id, '/', c.CampLogoPath)
                     END AS CampLogoPath,
                     c.IsActive,
                     COUNT(a.pk_attendance_id) AS AttendanceCount
              FROM pph_camps c
              LEFT JOIN pph_camp_attendance a ON a.fk_camp_id = c.pk_camp_id AND COALESCE(a.isdeleted, 0) = 0
              WHERE c.fk_club_id = @ClubId AND COALESCE(c.isdeleted, 0) = 0
              GROUP BY c.pk_camp_id, c.Title, c.Description, c.Address,
                       c.CampDate, c.CampLogoPath, c.fk_club_id, c.fk_district_id, c.IsActive
              ORDER BY c.CampDate DESC, c.pk_camp_id DESC",
            new { ClubId = clubId });
    }

    public async Task<PphCampListDto> CreateCampAsync(int clubId, CreatePphCampDto dto, IFormFile? logo, int userId, IWebHostEnvironment env)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        string? logoPath = null;
        if (logo != null)
        {
            logoPath = await SaveLogoAsync(clubId, logo, env);
        }

        var id = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO pph_camps (fk_club_id, Title, Description, Address, CampDate, CampLogoPath, IsActive, created_by, created_date, isdeleted)
              VALUES (@ClubId, @Title, @Description, @Address, @CampDate, @CampLogoPath, 1, @CreatedBy, NOW(), 0);
              SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = clubId,
                dto.Title,
                dto.Description,
                dto.Address,
                CampDate = DateTime.Parse(dto.CampDate),
                CampLogoPath = logoPath,
                CreatedBy = userId
            });

        _citationRecalc.TriggerForClub(clubId);

        return new PphCampListDto
        {
            Id = id,
            Title = dto.Title,
            Description = dto.Description,
            Address = dto.Address,
            CampDate = DateTime.Parse(dto.CampDate),
            // Reconstruct full URL (DB stores filename only)
            CampLogoPath = string.IsNullOrEmpty(logoPath) ? logoPath :
                           logoPath.StartsWith("/") ? logoPath :
                           $"/Documents/Campmaster/Group{clubId}/{logoPath}",
            IsActive = true,
            AttendanceCount = 0
        };
    }

    public async Task<PphCampListDto> UpdateCampAsync(int clubId, int campId, UpdatePphCampDto dto, IFormFile? logo, int userId, IWebHostEnvironment env)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get existing camp — CampLogoPathRaw is filename-only (DB value), CampLogoPathFull is reconstructed for disk-delete
        var existing = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_camp_id,
                     CampLogoPath AS CampLogoPathRaw,
                     CASE
                         WHEN CampLogoPath IS NULL OR CampLogoPath = '' THEN NULL
                         WHEN CampLogoPath LIKE '/%' THEN CampLogoPath
                         WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Campmaster/District', fk_district_id, '/', CampLogoPath)
                         ELSE CONCAT('/Documents/Campmaster/Group', fk_club_id, '/', CampLogoPath)
                     END AS CampLogoPathFull
              FROM pph_camps WHERE pk_camp_id = @CampId AND fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0",
            new { CampId = campId, ClubId = clubId });

        if (existing == null)
            throw new KeyNotFoundException("Camp not found.");

        // DB stores filename only after migration
        string? logoPath = (string?)existing.CampLogoPathRaw;

        if (logo != null)
        {
            // Delete old logo from disk using reconstructed full URL
            string? oldFullPath = (string?)existing.CampLogoPathFull;
            if (!string.IsNullOrEmpty(oldFullPath))
                DeleteFileFromDisk(oldFullPath, env);

            logoPath = await SaveLogoAsync(clubId, logo, env);
        }

        await connection.ExecuteAsync(
            @"UPDATE pph_camps
              SET Title = @Title, Description = @Description, Address = @Address,
                  CampDate = @CampDate, CampLogoPath = @CampLogoPath, IsActive = @IsActive,
                  modified_by = @ModifiedBy, modified_date = NOW()
              WHERE pk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0",
            new
            {
                CampId = campId,
                dto.Title,
                dto.Description,
                dto.Address,
                CampDate = DateTime.Parse(dto.CampDate),
                CampLogoPath = logoPath,
                IsActive = dto.IsActive ? 1 : 0,
                ModifiedBy = userId
            });

        var attendanceCount = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM pph_camp_attendance WHERE fk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0",
            new { CampId = campId });

        _citationRecalc.TriggerForClub(clubId);

        return new PphCampListDto
        {
            Id = campId,
            Title = dto.Title,
            Description = dto.Description,
            Address = dto.Address,
            CampDate = DateTime.Parse(dto.CampDate),
            // Reconstruct full URL (DB stores filename only)
            CampLogoPath = string.IsNullOrEmpty(logoPath) ? logoPath :
                           logoPath.StartsWith("/") ? logoPath :
                           $"/Documents/Campmaster/Group{clubId}/{logoPath}",
            IsActive = dto.IsActive,
            AttendanceCount = attendanceCount
        };
    }

    public async Task DeleteCampAsync(int campId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Check if camp has any attendance records
        var attendanceCount = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM pph_camp_attendance WHERE fk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0",
            new { CampId = campId });

        if (attendanceCount > 0)
            throw new InvalidOperationException("Cannot delete camp with attendance records.");

        // Capture the club ID before soft-delete so we can recalc citation
        // points for that club. After the UPDATE the row is still readable
        // (isdeleted=1), but reading clubId before keeps the recalc target
        // explicit regardless of join filters.
        int clubId = await connection.ExecuteScalarAsync<int>(
            "SELECT fk_club_id FROM pph_camps WHERE pk_camp_id = @CampId",
            new { CampId = campId });

        await connection.ExecuteAsync(
            @"UPDATE pph_camps SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW() WHERE pk_camp_id = @CampId",
            new { CampId = campId, DeletedBy = userId });

        if (clubId > 0) _citationRecalc.TriggerForClub(clubId);
    }

    public async Task ToggleCampActiveAsync(int campId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(
            @"UPDATE pph_camps SET IsActive = NOT IsActive, modified_by = @ModifiedBy, modified_date = NOW() WHERE pk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0",
            new { CampId = campId, ModifiedBy = userId });

        int clubId = await connection.ExecuteScalarAsync<int>(
            "SELECT fk_club_id FROM pph_camps WHERE pk_camp_id = @CampId AND COALESCE(isdeleted, 0) = 0",
            new { CampId = campId });
        if (clubId > 0) _citationRecalc.TriggerForClub(clubId);
    }

    // ── 3-level: Attendee (person) + medical readings ───────────────────

    private const string MedicalSelect =
        @"SELECT pk_attendance_id AS Id, fk_attendee_id AS AttendeeId, fk_camp_id AS CampId,
                 RegistrationNo, created_date AS ReadingDate, Age,
                 BPSystolic, BPDiastolic, BloodSugarType, BloodSugarValue,
                 HeightCm, WeightKg, BMI, DiabetesStatus, BPStatus,
                 IsOverweight, IsObese, Remarks
          FROM pph_camp_attendance";

    private static (decimal? bmi, bool isOverweight, bool isObese) CalcBmi(decimal? heightCm, decimal? weightKg)
    {
        if (heightCm.HasValue && heightCm.Value > 0 && weightKg.HasValue && weightKg.Value > 0)
        {
            var heightM = heightCm.Value / 100m;
            var bmi = Math.Round(weightKg.Value / (heightM * heightM), 2);
            return (bmi, bmi >= 25 && bmi < 30, bmi >= 30);
        }
        return (null, false, false);
    }

    public async Task<IEnumerable<PphAttendeeDto>> GetAttendeesAsync(int campId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var attendees = (await connection.QueryAsync<PphAttendeeDto>(
            @"SELECT pk_attendee_id AS Id, fk_camp_id AS CampId, Name, MobileNo, Sex, Address,
                     IsConsentedForMessages
              FROM pph_camp_attendies
              WHERE fk_camp_id = @CampId AND isdeleted = 0
              ORDER BY pk_attendee_id DESC",
            new { CampId = campId })).ToList();

        if (attendees.Count == 0) return attendees;

        // All non-deleted readings for this camp, newest first → group in memory for count + latest.
        var readings = (await connection.QueryAsync<PphMedicalReadingDto>(
            MedicalSelect + " WHERE fk_camp_id = @CampId AND isdeleted = 0 ORDER BY pk_attendance_id DESC",
            new { CampId = campId })).ToList();

        var byAttendee = readings.Where(r => r.AttendeeId != 0)
                                 .GroupBy(r => r.AttendeeId)
                                 .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var att in attendees)
        {
            if (byAttendee.TryGetValue(att.Id, out var list))
            {
                att.ReadingCount = list.Count;
                att.LatestReading = list.First(); // already ordered newest first
            }
        }
        return attendees;
    }

    public async Task<PphAttendeeDetailDto?> GetAttendeeDetailAsync(int campId, int attendeeId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var attendee = await connection.QueryFirstOrDefaultAsync<PphAttendeeDto>(
            @"SELECT pk_attendee_id AS Id, fk_camp_id AS CampId, Name, MobileNo, Sex, Address,
                     IsConsentedForMessages
              FROM pph_camp_attendies
              WHERE pk_attendee_id = @AttendeeId AND fk_camp_id = @CampId AND isdeleted = 0",
            new { AttendeeId = attendeeId, CampId = campId });

        if (attendee == null) return null;

        var history = (await connection.QueryAsync<PphMedicalReadingDto>(
            MedicalSelect + " WHERE fk_attendee_id = @AttendeeId AND isdeleted = 0 ORDER BY pk_attendance_id DESC",
            new { AttendeeId = attendeeId })).ToList();

        attendee.ReadingCount = history.Count;
        attendee.LatestReading = history.FirstOrDefault();

        return new PphAttendeeDetailDto { Attendee = attendee, History = history };
    }

    public async Task<PphAttendeeDetailDto> AddReadingAsync(int campId, CreatePphReadingDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var mobile = (dto.MobileNo ?? "").Trim();

        // Reuse attendee by (camp, mobile); else create. Mobile is unique per camp.
        var attendeeId = await connection.ExecuteScalarAsync<int?>(
            @"SELECT pk_attendee_id FROM pph_camp_attendies
              WHERE fk_camp_id = @CampId AND MobileNo = @Mobile AND isdeleted = 0
              ORDER BY pk_attendee_id LIMIT 1",
            new { CampId = campId, Mobile = mobile });

        if (attendeeId == null || attendeeId.Value == 0)
        {
            attendeeId = await connection.ExecuteScalarAsync<int>(
                @"INSERT INTO pph_camp_attendies
                      (fk_camp_id, Name, MobileNo, Sex, Address, IsConsentedForMessages, created_by, created_date, isdeleted)
                  VALUES (@CampId, @Name, @Mobile, @Sex, @Address, @Consent, @CreatedBy, NOW(), 0);
                  SELECT LAST_INSERT_ID();",
                new
                {
                    CampId = campId,
                    dto.Name,
                    Mobile = mobile,
                    dto.Sex,
                    dto.Address,
                    Consent = dto.IsConsentedForMessages ? 1 : 0,
                    CreatedBy = userId
                });
        }

        var (bmi, isOverweight, isObese) = CalcBmi(dto.HeightCm, dto.WeightKg);

        // Global, continuous registration number (PPH-0001…), unique across all camps and never
        // reused (max includes soft-deleted rows). Per-reading: every reading gets its own number.
        var maxRegNo = await connection.ExecuteScalarAsync<long?>(
            "SELECT MAX(CAST(SUBSTRING(RegistrationNo, 5) AS UNSIGNED)) FROM pph_camp_attendance WHERE RegistrationNo IS NOT NULL");
        var registrationNo = "PPH-" + ((maxRegNo ?? 0) + 1).ToString("D4");

        // Always insert a NEW reading. Person columns on the reading row are denormalized from the
        // attendee so legacy/flat reads + reports keep working.
        await connection.ExecuteAsync(
            @"INSERT INTO pph_camp_attendance
                  (fk_camp_id, fk_attendee_id, RegistrationNo, Age,
                   BPSystolic, BPDiastolic, BloodSugarType, BloodSugarValue,
                   HeightCm, WeightKg, BMI, DiabetesStatus, BPStatus,
                   IsOverweight, IsObese, IsConsentedForMessages, Remarks,
                   created_by, created_date, isdeleted)
              VALUES (@CampId, @AttendeeId, @RegistrationNo, @Age,
                   @BPSystolic, @BPDiastolic, @BloodSugarType, @BloodSugarValue,
                   @HeightCm, @WeightKg, @BMI, @DiabetesStatus, @BPStatus,
                   @IsOverweight, @IsObese, @IsConsentedForMessages, @Remarks,
                   @CreatedBy, NOW(), 0)",
            new
            {
                CampId = campId,
                AttendeeId = attendeeId,
                RegistrationNo = registrationNo,
                dto.Age,
                dto.BPSystolic,
                dto.BPDiastolic,
                dto.BloodSugarType,
                dto.BloodSugarValue,
                dto.HeightCm,
                dto.WeightKg,
                BMI = bmi,
                dto.DiabetesStatus,
                dto.BPStatus,
                IsOverweight = isOverweight ? 1 : 0,
                IsObese = isObese ? 1 : 0,
                IsConsentedForMessages = dto.IsConsentedForMessages ? 1 : 0,
                dto.Remarks,
                CreatedBy = userId
            });

        return (await GetAttendeeDetailAsync(campId, attendeeId!.Value))!;
    }

    public async Task<PphAttendeeDto> UpdateAttendeeAsync(int campId, int attendeeId, UpdatePphAttendeeDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var mobile = (dto.MobileNo ?? "").Trim();

        // Mobile must stay unique per camp — block if another attendee in this camp already has it.
        var clash = await connection.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM pph_camp_attendies
              WHERE fk_camp_id = @CampId AND MobileNo = @Mobile AND pk_attendee_id <> @AttendeeId AND isdeleted = 0",
            new { CampId = campId, Mobile = mobile, AttendeeId = attendeeId });
        if (clash > 0)
            throw new InvalidOperationException("This mobile number is already used by another attendee in this camp.");

        var affected = await connection.ExecuteAsync(
            @"UPDATE pph_camp_attendies
              SET Name = @Name, MobileNo = @Mobile, Sex = @Sex, Address = @Address,
                  IsConsentedForMessages = @Consent, modified_by = @ModifiedBy, modified_date = NOW()
              WHERE pk_attendee_id = @AttendeeId AND fk_camp_id = @CampId AND isdeleted = 0",
            new
            {
                AttendeeId = attendeeId,
                CampId = campId,
                dto.Name,
                Mobile = mobile,
                dto.Sex,
                dto.Address,
                Consent = dto.IsConsentedForMessages ? 1 : 0,
                ModifiedBy = userId
            });

        if (affected == 0) throw new KeyNotFoundException("Attendee not found.");

        // Name/Mobile/Sex/Address are NOT duplicated on readings anymore (normalized onto the attendee).
        // Keep only the consent mirror in sync on this attendee's readings.
        await connection.ExecuteAsync(
            @"UPDATE pph_camp_attendance
              SET IsConsentedForMessages = @Consent
              WHERE fk_attendee_id = @AttendeeId AND isdeleted = 0",
            new
            {
                AttendeeId = attendeeId,
                Consent = dto.IsConsentedForMessages ? 1 : 0
            });

        var detail = await GetAttendeeDetailAsync(campId, attendeeId);
        return detail!.Attendee;
    }

    public async Task<PphMedicalReadingDto> UpdateReadingAsync(int campId, int readingId, UpdatePphReadingDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var (bmi, isOverweight, isObese) = CalcBmi(dto.HeightCm, dto.WeightKg);

        var affected = await connection.ExecuteAsync(
            @"UPDATE pph_camp_attendance
              SET Age = @Age, BPSystolic = @BPSystolic, BPDiastolic = @BPDiastolic,
                  BloodSugarType = @BloodSugarType, BloodSugarValue = @BloodSugarValue,
                  HeightCm = @HeightCm, WeightKg = @WeightKg, BMI = @BMI,
                  DiabetesStatus = @DiabetesStatus, BPStatus = @BPStatus,
                  IsOverweight = @IsOverweight, IsObese = @IsObese, Remarks = @Remarks,
                  modified_by = @ModifiedBy, modified_date = NOW()
              WHERE pk_attendance_id = @ReadingId AND fk_camp_id = @CampId AND isdeleted = 0",
            new
            {
                ReadingId = readingId,
                CampId = campId,
                dto.Age,
                dto.BPSystolic,
                dto.BPDiastolic,
                dto.BloodSugarType,
                dto.BloodSugarValue,
                dto.HeightCm,
                dto.WeightKg,
                BMI = bmi,
                dto.DiabetesStatus,
                dto.BPStatus,
                IsOverweight = isOverweight ? 1 : 0,
                IsObese = isObese ? 1 : 0,
                dto.Remarks,
                ModifiedBy = userId
            });

        if (affected == 0) throw new KeyNotFoundException("Reading not found.");

        return (await connection.QueryFirstAsync<PphMedicalReadingDto>(
            MedicalSelect + " WHERE pk_attendance_id = @ReadingId",
            new { ReadingId = readingId }));
    }

    public async Task DeleteReadingAsync(int campId, int readingId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        await connection.ExecuteAsync(
            @"UPDATE pph_camp_attendance SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
              WHERE pk_attendance_id = @ReadingId AND fk_camp_id = @CampId",
            new { ReadingId = readingId, CampId = campId, DeletedBy = userId });
    }

    public async Task DeleteAttendeeAsync(int campId, int attendeeId, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Soft-delete the attendee and cascade soft-delete their readings (no hard deletes).
        await connection.ExecuteAsync(
            @"UPDATE pph_camp_attendies SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
              WHERE pk_attendee_id = @AttendeeId AND fk_camp_id = @CampId",
            new { AttendeeId = attendeeId, CampId = campId, DeletedBy = userId });

        await connection.ExecuteAsync(
            @"UPDATE pph_camp_attendance SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
              WHERE fk_attendee_id = @AttendeeId AND isdeleted = 0",
            new { AttendeeId = attendeeId, DeletedBy = userId });
    }

    // ── History by mobile (cross-club / cross-camp / cross-year) ─────────

    // Rotary year runs 1 Jul – 30 Jun. e.g. a camp on 2025-09-01 → "2025-26".
    private static string RotaryYearLabel(DateTime d)
    {
        int startYear = d.Month >= 7 ? d.Year : d.Year - 1;
        return $"{startYear}-{((startYear + 1) % 100):D2}";
    }

    public async Task<PphMobileHistoryDto> GetAttendeeHistoryByMobileAsync(string mobile)
    {
        // Normalize to digits only, then take the last 10 (Indian national number length),
        // mirroring the mobile-matching convention used elsewhere (Interakt/webhook).
        var digits = new string((mobile ?? "").Where(char.IsDigit).ToArray());
        var last10 = digits.Length >= 10 ? digits[^10..] : digits;

        var result = new PphMobileHistoryDto { Mobile = last10 };
        if (string.IsNullOrEmpty(last10)) return result;

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // One flat row per attendee entry (= one camp participation). NEVER deduped.
        // Spans all clubs, all district camps, all camps, all years.
        var rows = (await connection.QueryAsync<HistoryRow>(
            @"SELECT a.pk_attendee_id      AS AttendeeId,
                     a.fk_camp_id          AS CampId,
                     a.Name                AS AttendeeName,
                     a.MobileNo            AS MobileNo,
                     a.Sex                 AS Sex,
                     a.Address             AS Address,
                     a.IsConsentedForMessages AS IsConsentedForMessages,
                     c.Title               AS CampTitle,
                     c.CampDate            AS CampDate,
                     c.fk_club_id          AS ClubId,
                     c.fk_district_id      AS DistrictId,
                     cm.ClubName           AS ClubName,
                     dm.DistrictNumber     AS DistrictNumber,
                     (SELECT COUNT(*) FROM pph_camp_attendance r
                        WHERE r.fk_attendee_id = a.pk_attendee_id AND COALESCE(r.isdeleted,0) = 0) AS ReadingCount,
                     (SELECT MAX(r2.created_date) FROM pph_camp_attendance r2
                        WHERE r2.fk_attendee_id = a.pk_attendee_id AND COALESCE(r2.isdeleted,0) = 0) AS LatestReadingDate
              FROM pph_camp_attendies a
              JOIN pph_camps c        ON c.pk_camp_id = a.fk_camp_id AND COALESCE(c.isdeleted,0) = 0
              LEFT JOIN club_master cm ON cm.pk_club_id = c.fk_club_id
              LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
              WHERE COALESCE(a.isdeleted,0) = 0
                AND RIGHT(REGEXP_REPLACE(COALESCE(a.MobileNo,''), '[^0-9]', ''), 10) = @Last10
              ORDER BY c.CampDate DESC, a.pk_attendee_id DESC",
            new { Last10 = last10 })).ToList();

        // Full medical readings for every matched participation, in one query (newest first per attendee).
        var readingsByAttendee = new Dictionary<int, List<PphMedicalReadingDto>>();
        if (rows.Count > 0)
        {
            var attendeeIds = rows.Select(r => r.AttendeeId).Distinct().ToList();
            readingsByAttendee = (await connection.QueryAsync<PphMedicalReadingDto>(
                    MedicalSelect + " WHERE fk_attendee_id IN @Ids AND COALESCE(isdeleted,0) = 0 ORDER BY pk_attendance_id DESC",
                    new { Ids = attendeeIds }))
                .GroupBy(r => r.AttendeeId)
                .ToDictionary(g => g.Key, g => g.ToList());
        }

        // Group club-wise. District-scope camps (fk_club_id NULL) group under a
        // per-district pseudo-group so they still surface in the history.
        var groups = rows
            .GroupBy(r => r.ClubId.HasValue ? $"C{r.ClubId}" : (r.DistrictId.HasValue ? $"D{r.DistrictId}" : "U"))
            .Select(g =>
            {
                var first = g.First();
                bool isDistrict = !first.ClubId.HasValue;
                var groupDto = new PphMobileHistoryGroupDto
                {
                    ClubId = first.ClubId,
                    DistrictId = isDistrict ? first.DistrictId : null,
                    IsDistrict = isDistrict,
                    GroupName = !string.IsNullOrWhiteSpace(first.ClubName) ? first.ClubName!
                              : isDistrict && !string.IsNullOrWhiteSpace(first.DistrictNumber) ? $"District {first.DistrictNumber} (District Camp)"
                              : "Unknown club",
                    EntryCount = g.Count(),
                    Entries = g.Select(r => new PphMobileHistoryEntryDto
                    {
                        AttendeeId = r.AttendeeId,
                        CampId = r.CampId,
                        CampTitle = r.CampTitle,
                        CampDate = r.CampDate,
                        AttendeeName = r.AttendeeName,
                        MobileNo = r.MobileNo ?? "",
                        Sex = r.Sex,
                        Address = r.Address,
                        ReadingCount = r.ReadingCount,
                        LatestReadingDate = r.LatestReadingDate,
                        YearLabel = RotaryYearLabel(r.CampDate),
                        IsConsentedForMessages = r.IsConsentedForMessages,
                        Readings = readingsByAttendee.TryGetValue(r.AttendeeId, out var readings) ? readings : new List<PphMedicalReadingDto>()
                    }).ToList()
                };
                return groupDto;
            })
            // Most-recent camp first within each group already; order groups by their newest camp.
            .OrderByDescending(gr => gr.Entries.Max(e => e.CampDate))
            .ToList();

        result.Groups = groups;
        result.GroupCount = groups.Count;
        result.TotalEntries = rows.Count;
        return result;
    }

    public async Task<IEnumerable<PphAttendeeReportRowDto>> GetAttendeeReportAsync(string scope, int? scopeId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Scope only widens WHICH clubs' rows are included — entries are NEVER deduped.
        //   club     → that club's camps only
        //   district → every club in that district + that district's own district-scope camps
        //   all      → everything
        string scopeFilter = (scope ?? "").ToLowerInvariant() switch
        {
            "club"     => "AND c.fk_club_id = @ScopeId",
            "district" => "AND (cm.fk_district_id = @ScopeId OR c.fk_district_id = @ScopeId)",
            _          => ""   // "all" — no extra filter
        };

        var rows = (await connection.QueryAsync<PphAttendeeReportRowDto>(
            $@"SELECT dm.DistrictNumber   AS DistrictNumber,
                     COALESCE(cm.ClubName,
                              CASE WHEN c.fk_district_id IS NOT NULL
                                   THEN CONCAT('District ', dm.DistrictNumber, ' (District Camp)')
                                   ELSE 'Unknown club' END) AS ClubName,
                     a.fk_camp_id         AS CampId,
                     c.Title              AS CampTitle,
                     c.CampDate           AS CampDate,
                     a.Name               AS AttendeeName,
                     a.MobileNo           AS MobileNo,
                     a.Sex                AS Sex,
                     a.Address            AS Address,
                     (SELECT COUNT(*) FROM pph_camp_attendance r
                        WHERE r.fk_attendee_id = a.pk_attendee_id AND COALESCE(r.isdeleted,0) = 0) AS ReadingCount,
                     (SELECT MAX(r2.created_date) FROM pph_camp_attendance r2
                        WHERE r2.fk_attendee_id = a.pk_attendee_id AND COALESCE(r2.isdeleted,0) = 0) AS LatestReadingDate
              FROM pph_camp_attendies a
              JOIN pph_camps c         ON c.pk_camp_id = a.fk_camp_id AND COALESCE(c.isdeleted,0) = 0
              LEFT JOIN club_master cm ON cm.pk_club_id = c.fk_club_id
              LEFT JOIN district_master dm ON dm.pk_district_id = COALESCE(cm.fk_district_id, c.fk_district_id)
              WHERE COALESCE(a.isdeleted,0) = 0
                {scopeFilter}
              ORDER BY ClubName, c.CampDate DESC, a.pk_attendee_id DESC",
            new { ScopeId = scopeId })).ToList();

        // Rotary-year label derived from CampDate (no fk_year_id on pph_camps).
        foreach (var r in rows) r.YearLabel = RotaryYearLabel(r.CampDate);
        return rows;
    }

    private class HistoryRow
    {
        public int AttendeeId { get; set; }
        public int CampId { get; set; }
        public string AttendeeName { get; set; } = "";
        public string? MobileNo { get; set; }
        public string? Sex { get; set; }
        public string? Address { get; set; }
        public bool IsConsentedForMessages { get; set; }
        public string CampTitle { get; set; } = "";
        public DateTime CampDate { get; set; }
        public int? ClubId { get; set; }
        public int? DistrictId { get; set; }
        public string? ClubName { get; set; }
        public string? DistrictNumber { get; set; }
        public int ReadingCount { get; set; }
        public DateTime? LatestReadingDate { get; set; }
    }

    // ── File Helpers ────────────────────────────────────────────────────

    private static async Task<string> SaveLogoAsync(int clubId, IFormFile file, IWebHostEnvironment env)
    {
        var groupFolder = $"Group{clubId}";
        var uploadsPath = Path.Combine(env.WebRootPath, "Documents", "Campmaster", groupFolder);
        Directory.CreateDirectory(uploadsPath);

        var extension = Path.GetExtension(file.FileName);
        var now = DateTime.Now;
        var timestamp = now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{Guid.NewGuid():N}_{timestamp}{extension}";
        var fullPath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(fullPath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return fileName;
    }

    private static void DeleteFileFromDisk(string relativePath, IWebHostEnvironment env)
    {
        if (string.IsNullOrEmpty(relativePath)) return;
        var fullPath = Path.Combine(env.WebRootPath, relativePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(fullPath))
            File.Delete(fullPath);
    }
}
