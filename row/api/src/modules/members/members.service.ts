import { Injectable, Logger } from "@nestjs/common";
import { Db, type DbCommands } from "../../database/db.service";
import { AppConfig } from "../../config/app-config";
import { Brand } from "../../brand/brand";
import { pagedResult } from "../../common/paged";
import { InvalidOperationException } from "../../common/exceptions";
import { dbDateTime } from "../../common/binding";
import { EmailService } from "../../services/email.service";
import { saveWithGuidName, type UploadedFile } from "../../services/media-storage";
import {
  FamilyMemberDto, MemberAddressDto, MemberDetailDto, MemberListDto, SaveAddressDto, SaveFamilyMemberDto,
  type SaveAddress, type SaveFamilyMember, type SaveMember,
} from "../../dtos/member.dtos";

const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s : null);
/** fk_*_country_id: 0 / missing means "no country" (RIZones assumed India, id 1). */
const countryOrNull = (id: number | null | undefined) => (id && id > 0 ? id : null);

/**
 * Birthdays and anniversaries keep day and month only, stored in year 1900
 * (29 February becomes the 28th); years before 1900 are treated as no date.
 */
export function normalizeBirthAnnivYear(value: string | null | undefined): string | null {
  const d = dbDateTime(value);
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (y < 1900) return null;
  const dd = m === 2 && day === 29 ? 28 : day;
  return `1900-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** WS1-10: on ROW, blood group (health data) and family details are not collected or shown. */
const bloodGroupOn = () => Brand.feature("member.bloodGroup");
const familyOn = () => Brand.feature("member.familyDetails");

/** Port of MemberService.cs. */
@Injectable()
export class MemberService {
  private readonly log = new Logger("MemberService");

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly email: EmailService,
  ) {}

  private async checkDuplicates(conn: DbCommands, mobile: string | null, email: string | null, rotaryId: string | null, excludeId: number | null = null) {
    const r = await conn.queryFirst(
      `SELECT
           SUM(CASE WHEN PrimaryMobileNumber = @Mobile AND @Mobile <> '' THEN 1 ELSE 0 END) AS MobileDuplicate,
           SUM(CASE WHEN EmailId = @Email AND @Email <> '' THEN 1 ELSE 0 END) AS EmailDuplicate,
           SUM(CASE WHEN RotaryId = @RotaryId AND @RotaryId <> '' THEN 1 ELSE 0 END) AS RotaryIdDuplicate
       FROM member_master_profile
       WHERE isdeleted = 0
         AND (@ExcludeId IS NULL OR pk_member_master_profile_id <> @ExcludeId)`,
      { Mobile: mobile ?? "", Email: email ?? "", RotaryId: rotaryId ?? "", ExcludeId: excludeId },
    );
    const errors: string[] = [];
    if (Number(r.MobileDuplicate ?? 0) > 0) errors.push("This mobile number already exists");
    if (Number(r.EmailDuplicate ?? 0) > 0) errors.push("This email ID already exists");
    if (Number(r.RotaryIdDuplicate ?? 0) > 0) errors.push("This Rotary ID already exists");
    if (errors.length) throw new InvalidOperationException(errors.join(", "));
  }

  private bindFamily(raw: unknown): SaveFamilyMember[] | null {
    if (!familyOn() || !Array.isArray(raw)) return null;
    return raw.map((f) => SaveFamilyMemberDto.create((f ?? {}) as Record<string, unknown>) as unknown as SaveFamilyMember);
  }

  private bindAddresses(raw: unknown): SaveAddress[] | null {
    if (!Array.isArray(raw)) return null;
    return raw.map((a) => SaveAddressDto.create((a ?? {}) as Record<string, unknown>) as unknown as SaveAddress);
  }

  private static checkSingleSpouse(family: SaveFamilyMember[] | null) {
    if (family && family.filter((f) => (f.relation ?? "").trim().toLowerCase() === "spouse").length > 1) {
      throw new InvalidOperationException("Only one family member can be the Spouse.");
    }
  }

  /** The same person entered twice (same name and relation): keep the last entry, with the first one's id. */
  private static mergeDuplicateFamily(family: SaveFamilyMember[]): SaveFamilyMember[] {
    const result: SaveFamilyMember[] = [];
    const index = new Map<string, number>();
    for (const f of family) {
      if (!f.name || !f.name.trim()) {
        result.push(f);
        continue;
      }
      const key = `${f.name.trim().toLowerCase()}|${(f.relation ?? "").trim().toLowerCase()}`;
      const at = index.get(key);
      if (at !== undefined) {
        if (f.id <= 0 && result[at].id > 0) f.id = result[at].id;
        result[at] = f;
      } else {
        index.set(key, result.length);
        result.push(f);
      }
    }
    return result;
  }

  private static async insertFamilyMember(conn: DbCommands, memberId: number, fm: SaveFamilyMember) {
    await conn.executeProcedure("sp_member_family_create", {
      p_FkMemberMasterProfileId: memberId,
      p_Name: fm.name,
      p_Relation: fm.relation,
      p_BloodGroup: bloodGroupOn() ? fm.bloodGroup : null,
      p_FkCountryId: countryOrNull(fm.fkCountryId),
      p_PhoneNumber: fm.phoneNumber,
      p_EmailId: fm.emailId,
      p_BirthDate: normalizeBirthAnnivYear(fm.birthDate),
      p_AnniversaryDate: normalizeBirthAnnivYear(fm.anniversaryDate),
      p_PhotoPath: fm.photoPath,
    });
  }

  private static async upsertFamilyMembers(conn: DbCommands, memberId: number, family: SaveFamilyMember[]) {
    const existing = new Set(
      (await conn.query(
        `SELECT pk_member_family_details_id AS id FROM member_family_details
         WHERE fk_member_master_profile_id = @MemberId AND COALESCE(isdeleted, 0) = 0`,
        { MemberId: memberId },
      )).map((r) => Number(r.id)),
    );
    const kept = new Set<number>();
    for (const fm of MemberService.mergeDuplicateFamily(family)) {
      if (fm.id > 0 && existing.has(fm.id) && !kept.has(fm.id)) {
        kept.add(fm.id);
        await conn.execute(
          `UPDATE member_family_details
           SET Name = @Name, Relation = @Relation, BloodGroup = @BloodGroup, fk_country_id = @FkCountryId,
               PhoneNumber = @PhoneNumber, EmailId = @EmailId, BirthDate = @BirthDate,
               AnniversaryDate = @AnniversaryDate, PhotoPath = @PhotoPath, modified_date = NOW()
           WHERE pk_member_family_details_id = @Id AND fk_member_master_profile_id = @MemberId`,
          {
            Id: fm.id, MemberId: memberId, Name: fm.name, Relation: fm.relation, BloodGroup: bloodGroupOn() ? fm.bloodGroup : null,
            FkCountryId: countryOrNull(fm.fkCountryId), PhoneNumber: fm.phoneNumber, EmailId: fm.emailId,
            BirthDate: normalizeBirthAnnivYear(fm.birthDate), AnniversaryDate: normalizeBirthAnnivYear(fm.anniversaryDate), PhotoPath: fm.photoPath,
          },
        );
      } else {
        await MemberService.insertFamilyMember(conn, memberId, fm);
      }
    }
    const removed = [...existing].filter((x) => !kept.has(x));
    if (removed.length) {
      await conn.execute(
        `UPDATE member_family_details SET isdeleted = 1, modified_date = NOW()
         WHERE pk_member_family_details_id IN @Ids AND fk_member_master_profile_id = @MemberId`,
        { Ids: removed, MemberId: memberId },
      );
    }
  }

  private static async insertAddress(conn: DbCommands, memberId: number, a: SaveAddress) {
    await conn.execute(
      `INSERT INTO member_address_details
           (fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber,
            Address, State, City, PinCode,
            BusinessName, BusinessEmailId, Keywords,
            created_date)
       VALUES
           (@MemberId, @AddressType, @FkCountryId, @PhoneNumber,
            @Address, @State, @City, @PinCode,
            @BusinessName, @BusinessEmailId, @Keywords,
            NOW())`,
      {
        MemberId: memberId, AddressType: a.addressType, FkCountryId: countryOrNull(a.fkCountryId), PhoneNumber: a.phoneNumber,
        Address: a.address, State: a.state, City: a.city, PinCode: a.pinCode, BusinessName: a.businessName,
        BusinessEmailId: a.businessEmailId, Keywords: a.keywords,
      },
    );
  }

  private static async updateDesignationAcrossClubs(conn: DbCommands, memberId: number, designation: string | null, classification: string | null) {
    await conn.execute(
      `UPDATE club_members
       SET Designation = @Designation,
           ClassificationProfession = @Classification,
           modified_date = NOW()
       WHERE fk_member_master_profile_id = @MemberId
         AND COALESCE(isdeleted, 0) = 0`,
      { Designation: blankToNull(designation)?.trim() ?? null, Classification: blankToNull(classification)?.trim() ?? null, MemberId: memberId },
    );
  }

  /** A mobile number held by a deleted profile is moved to its secondary slot so a live profile can use it. */
  static async releaseSoftDeletedMobile(conn: DbCommands, mobile: string | null, excludeId: number) {
    if (!mobile || !mobile.trim()) return;
    await conn.execute(
      `UPDATE member_master_profile
       SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                        THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
           PrimaryMobileNumber = NULL,
           modified_date = NOW()
       WHERE PrimaryMobileNumber = @Mobile
         AND isdeleted = 1
         AND pk_member_master_profile_id <> @ExcludeId`,
      { Mobile: mobile.trim(), ExcludeId: excludeId },
    );
  }

  private static profileValues(dto: SaveMember) {
    return {
      MemberName: dto.memberName, ProfilePhotoPath: dto.profilePhotoPath, FkPrimaryCountryId: countryOrNull(dto.fkPrimaryCountryId),
      PrimaryMobileNumber: dto.primaryMobileNumber, EmailId: dto.emailId,
      BirthDate: normalizeBirthAnnivYear(dto.birthDate), AnniversaryDate: normalizeBirthAnnivYear(dto.anniversaryDate),
      BloodGroup: bloodGroupOn() ? dto.bloodGroup : null,
      FkSecondaryCountryId: countryOrNull(dto.fkSecondaryCountryId), SecondaryMobileNumber: dto.secondaryMobileNumber,
      IsPersonalDetailsVisible: dto.isPersonalDetailsVisible ? 1 : 0, Gender: dto.gender, PrimaryLanguage: dto.primaryLanguage,
      IsYouth: dto.isYouth ? 1 : 0, MemberIntroduction: dto.memberIntroduction, Facebook: dto.facebook, Instagram: dto.instagram,
      LinkedIn: dto.linkedIn, Twitter: dto.twitter, Youtube: dto.youtube, Website: dto.website, RotaryId: dto.rotaryId,
      DonorRecognition: dto.donorRecognition, FamilyPhotoPath: familyOn() ? dto.familyPhotoPath : null,
      IsFamilyDetailsVisible: dto.isFamilyDetailsVisible ? 1 : 0,
    };
  }

  async getAll(page: number, pageSize: number, search: string | null, bloodGroup: string | null, gender: string | null) {
    const params = {
      Search: blankToNull(search), BloodGroup: bloodGroupOn() ? blankToNull(bloodGroup) : null, Gender: blankToNull(gender),
      PageSize: pageSize, Offset: (page - 1) * pageSize,
    };
    return this.db.session(async (conn) => {
      const countRow = (await conn.callProcedure("sp_member_get_all_count", { p_Search: params.Search, p_BloodGroup: params.BloodGroup, p_Gender: params.Gender }))[0];
      const totalCount = Number(Object.values(countRow ?? {})[0] ?? 0);
      const items = MemberListDto.mapAll(
        await conn.query(
          `SELECT
               m.pk_member_master_profile_id AS Id,
               m.MemberName,
               CASE
                   WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                   WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                   ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
               END AS ProfilePhotoPath,
               m.EmailId,
               m.PrimaryMobileNumber,
               pc.PhoneCode AS PrimaryCountryPhoneCode,
               m.BloodGroup,
               m.Gender,
               m.RotaryId,
               ba.BusinessName,
               cmd.Designation,
               ra.City AS ResCity,
               ra.State AS ResState
           FROM member_master_profile m
           LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
           LEFT JOIN member_address_details ba
               ON ba.fk_member_master_profile_id = m.pk_member_master_profile_id
               AND ba.AddressType = 'Business'
               AND ba.isdeleted = 0
           LEFT JOIN member_address_details ra
               ON ra.fk_member_master_profile_id = m.pk_member_master_profile_id
               AND ra.AddressType IN ('Residential','Residence')
               AND ra.isdeleted = 0
           LEFT JOIN (
               SELECT fk_member_master_profile_id,
                      MAX(Designation) AS Designation
               FROM club_members
               WHERE COALESCE(isdeleted, 0) = 0
               GROUP BY fk_member_master_profile_id
           ) cmd ON cmd.fk_member_master_profile_id = m.pk_member_master_profile_id
           WHERE m.isdeleted = 0
             AND (@Search IS NULL
                  OR m.MemberName LIKE CONCAT('%', @Search, '%')
                  OR m.EmailId LIKE CONCAT('%', @Search, '%')
                  OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%')
                  OR m.RotaryId LIKE CONCAT('%', @Search, '%'))
             AND (@BloodGroup IS NULL OR m.BloodGroup = @BloodGroup)
             AND (@Gender IS NULL OR m.Gender = @Gender)
           ORDER BY m.pk_member_master_profile_id DESC
           LIMIT @PageSize OFFSET @Offset`,
          params,
        ),
      );
      if (!bloodGroupOn()) for (const i of items) i.bloodGroup = null;
      return pagedResult(items, totalCount, page, pageSize);
    });
  }

  async getById(id: number, clubId: number | null = null) {
    return this.db.session(async (conn) => {
      const member = MemberDetailDto.map(
        await conn.queryFirstOrDefault(
          `SELECT
               m.pk_member_master_profile_id AS Id, m.MemberName,
               CASE
                   WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                   WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                   ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
               END AS ProfilePhotoPath,
               m.fk_primary_country_id AS FkPrimaryCountryId, pc.CountryName AS PrimaryCountry, pc.PhoneCode AS PrimaryCountryPhoneCode,
               m.PrimaryMobileNumber, m.EmailId,
               DATE_FORMAT(m.BirthDate, '%Y-%m-%dT00:00:00') AS BirthDate,
               DATE_FORMAT(m.AnniversaryDate, '%Y-%m-%dT00:00:00') AS AnniversaryDate,
               m.BloodGroup,
               m.fk_secondary_country_id AS FkSecondaryCountryId, sc.CountryName AS SecondaryCountry, sc.PhoneCode AS SecondaryCountryPhoneCode,
               m.SecondaryMobileNumber, m.IsPersonalDetailsVisible, m.Gender, m.PrimaryLanguage, m.IsYouth, m.MemberIntroduction,
               m.Facebook, m.Instagram, m.LinkedIn, m.Twitter, m.Youtube, m.Website, m.RotaryId, m.DonorRecognition,
               CASE
                   WHEN m.FamilyPhotoPath IS NULL OR m.FamilyPhotoPath = '' THEN NULL
                   WHEN m.FamilyPhotoPath LIKE '/Documents/directory/%' THEN m.FamilyPhotoPath
                   ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.FamilyPhotoPath, '/', -1))
               END AS FamilyPhotoPath,
               m.IsFamilyDetailsVisible,
               m.created_by AS CreatedBy, m.created_date AS CreatedDate, m.modified_by AS ModifiedBy, m.modified_date AS ModifiedDate
           FROM member_master_profile m
           LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
           LEFT JOIN country_master sc ON sc.pk_country_id = m.fk_secondary_country_id
           WHERE m.pk_member_master_profile_id = @Id
             AND m.isdeleted = 0`,
          { Id: id },
        ),
      );
      if (!member) return null;

      member.addresses = MemberAddressDto.mapAll(
        await conn.query(
          `SELECT a.pk_member_address_details_id AS Id, a.fk_member_master_profile_id AS FkMemberMasterProfileId, a.AddressType,
                  a.fk_country_id AS FkCountryId, c.CountryName AS Country, c.PhoneCode AS CountryPhoneCode, a.PhoneNumber,
                  a.Address, a.State, a.City, a.PinCode, a.BusinessName, a.BusinessEmailId, a.Keywords
           FROM member_address_details a
           LEFT JOIN country_master c ON c.pk_country_id = a.fk_country_id
           WHERE a.fk_member_master_profile_id = @Id
             AND a.isdeleted = 0`,
          { Id: id },
        ),
      );
      const desig = await conn.queryFirstOrDefault(
        `SELECT MAX(Designation) AS Designation, MAX(ClassificationProfession) AS ClassificationProfession
         FROM club_members
         WHERE fk_member_master_profile_id = @Id AND COALESCE(isdeleted, 0) = 0`,
        { Id: id },
      );
      if (desig) {
        member.designation = desig.Designation ?? null;
        member.classificationProfession = desig.ClassificationProfession ?? null;
      }
      member.familyMembers = familyOn()
        ? FamilyMemberDto.mapAll(
            await conn.query(
              `SELECT f.pk_member_family_details_id AS Id, f.fk_member_master_profile_id AS FkMemberMasterProfileId, f.Name, f.Relation,
                      f.BloodGroup, f.fk_country_id AS FkCountryId, c.CountryName AS Country, c.PhoneCode AS CountryPhoneCode,
                      f.PhoneNumber, f.EmailId,
                      DATE_FORMAT(f.BirthDate, '%Y-%m-%dT00:00:00') AS BirthDate,
                      DATE_FORMAT(f.AnniversaryDate, '%Y-%m-%dT00:00:00') AS AnniversaryDate,
                      CASE
                          WHEN f.PhotoPath IS NULL OR f.PhotoPath = '' THEN NULL
                          WHEN f.PhotoPath LIKE '/%' THEN f.PhotoPath
                          ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(f.PhotoPath, '/', -1))
                      END AS PhotoPath
               FROM member_family_details f
               LEFT JOIN country_master c ON c.pk_country_id = f.fk_country_id
               WHERE f.fk_member_master_profile_id = @MemberId
                 AND f.isdeleted = 0`,
              { MemberId: id },
            ),
          )
        : [];
      if (!bloodGroupOn()) {
        member.bloodGroup = null;
        for (const f of member.familyMembers as Record<string, unknown>[]) f.bloodGroup = null;
      }
      if (!familyOn()) member.familyPhotoPath = null;

      const membership = await conn.queryFirstOrDefault(
        `SELECT fk_club_id AS clubId, DATE_FORMAT(JoinedDate, '%Y-%m-%dT00:00:00') AS joinedDate
         FROM club_members
         WHERE fk_member_master_profile_id = @Id AND isdeleted = 0
           AND (@ClubId IS NULL OR fk_club_id = @ClubId)
         ORDER BY (JoinedDate IS NULL), JoinedDate ASC, pk_club_member_id ASC
         LIMIT 1`,
        { Id: id, ClubId: clubId },
      );
      if (membership && Number(membership.clubId) > 0) {
        member.clubId = Number(membership.clubId);
        member.joinedDate = membership.joinedDate;
      }
      return member;
    });
  }

  async create(dto: SaveMember): Promise<number> {
    const family = this.bindFamily(dto.familyMembers);
    const addresses = this.bindAddresses(dto.addresses);
    const clubId = dto.clubId && dto.clubId > 0 ? dto.clubId : null;
    const joinedDate = dbDateTime(dto.joinedDate) ?? new Date().toISOString().slice(0, 10);

    const id = await this.db.session(async (conn) => {
      await this.checkDuplicates(conn, dto.primaryMobileNumber, dto.emailId, dto.rotaryId);
      MemberService.checkSingleSpouse(family);

      // A deleted profile with the same mobile, email or Rotary ID comes back instead of a new one.
      const softDeletedId = (dto.primaryMobileNumber || dto.emailId || dto.rotaryId)
        ? await conn.executeScalar<number>(
            `SELECT pk_member_master_profile_id
             FROM member_master_profile
             WHERE isdeleted = 1
               AND ((PrimaryMobileNumber = @Mobile AND @Mobile <> '')
                 OR (EmailId = @Email AND @Email <> '')
                 OR (RotaryId = @RotaryId AND @RotaryId <> ''))
             ORDER BY pk_member_master_profile_id DESC
             LIMIT 1`,
            { Mobile: dto.primaryMobileNumber ?? "", Email: dto.emailId ?? "", RotaryId: dto.rotaryId ?? "" },
          )
        : null;

      if (softDeletedId !== null) {
        const reactivatedId = Number(softDeletedId);
        await conn.transaction(async (tx) => {
          await MemberService.releaseSoftDeletedMobile(tx, dto.primaryMobileNumber, reactivatedId);
          await tx.execute(
            `UPDATE member_master_profile SET
                 MemberName = @MemberName, ProfilePhotoPath = @ProfilePhotoPath, fk_primary_country_id = @FkPrimaryCountryId,
                 PrimaryMobileNumber = @PrimaryMobileNumber, EmailId = @EmailId, BirthDate = @BirthDate, AnniversaryDate = @AnniversaryDate,
                 BloodGroup = @BloodGroup, fk_secondary_country_id = @FkSecondaryCountryId, SecondaryMobileNumber = @SecondaryMobileNumber,
                 IsPersonalDetailsVisible = @IsPersonalDetailsVisible, Gender = @Gender, PrimaryLanguage = @PrimaryLanguage, IsYouth = @IsYouth,
                 MemberIntroduction = @MemberIntroduction, Facebook = @Facebook, Instagram = @Instagram, LinkedIn = @LinkedIn, Twitter = @Twitter,
                 Youtube = @Youtube, Website = @Website, RotaryId = @RotaryId, DonorRecognition = @DonorRecognition,
                 FamilyPhotoPath = @FamilyPhotoPath, IsFamilyDetailsVisible = @IsFamilyDetailsVisible,
                 isdeleted = 0, deleted_by = NULL, deleted_date = NULL, modified_date = NOW()
             WHERE pk_member_master_profile_id = @Id`,
            { ...MemberService.profileValues(dto), Id: reactivatedId },
          );
          const hasActiveMemberRole = Number(
            await tx.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 1 AND isdeleted = 0", { MemberId: reactivatedId }),
          );
          if (hasActiveMemberRole === 0) {
            const reactivated = await tx.execute(
              `UPDATE member_roles
               SET isdeleted = 0, IsActive = 1, RevokedDate = NULL, RevokedBy = NULL, modified_date = NOW()
               WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 1 AND isdeleted = 1`,
              { MemberId: reactivatedId },
            );
            if (reactivated === 0) await assignDefaultMemberRole(tx, reactivatedId);
          }
          if (clubId) {
            const existingCm = await tx.queryFirstOrDefault(
              `SELECT pk_club_member_id AS pk_id, isdeleted
               FROM club_members
               WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
               ORDER BY pk_club_member_id DESC LIMIT 1`,
              { ClubId: clubId, MemberId: reactivatedId },
            );
            if (!existingCm) {
              await tx.execute(
                `INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_by, created_date, isdeleted)
                 VALUES (@ClubId, @MemberId, @JoinedDate, 1, 0, NOW(), 0)`,
                { ClubId: clubId, MemberId: reactivatedId, JoinedDate: joinedDate },
              );
            } else if (Number(existingCm.isdeleted) === 1) {
              await tx.execute(
                `UPDATE club_members
                 SET isdeleted = 0, IsActive = 1, JoinedDate = @JoinedDate,
                     TerminationDate = NULL, TerminationReason = NULL,
                     deleted_by = NULL, deleted_date = NULL, modified_date = NOW()
                 WHERE pk_club_member_id = @Id`,
                { Id: Number(existingCm.pk_id), JoinedDate: joinedDate },
              );
            }
          }
        });
        this.log.log(`Re-activated soft-deleted member profile ${reactivatedId} on create`);
        return reactivatedId;
      }

      return conn.transaction(async (tx) => {
        await MemberService.releaseSoftDeletedMobile(tx, dto.primaryMobileNumber, 0);
        const memberId = Number(
          await tx.executeScalar(
            `INSERT INTO member_master_profile (
                 MemberName, ProfilePhotoPath, fk_primary_country_id, PrimaryMobileNumber,
                 EmailId, BirthDate, AnniversaryDate, BloodGroup,
                 fk_secondary_country_id, SecondaryMobileNumber,
                 IsPersonalDetailsVisible, Gender, PrimaryLanguage,
                 IsYouth, MemberIntroduction,
                 Facebook, Instagram, LinkedIn, Twitter, Youtube, Website,
                 RotaryId, DonorRecognition, FamilyPhotoPath, IsFamilyDetailsVisible,
                 created_by, created_date, isdeleted
             ) VALUES (
                 @MemberName, @ProfilePhotoPath, @FkPrimaryCountryId, @PrimaryMobileNumber,
                 @EmailId, @BirthDate, @AnniversaryDate, @BloodGroup,
                 @FkSecondaryCountryId, @SecondaryMobileNumber,
                 @IsPersonalDetailsVisible, @Gender, @PrimaryLanguage,
                 @IsYouth, @MemberIntroduction,
                 @Facebook, @Instagram, @LinkedIn, @Twitter, @Youtube, @Website,
                 @RotaryId, @DonorRecognition, @FamilyPhotoPath, @IsFamilyDetailsVisible,
                 0, NOW(), 0
             );
             SELECT LAST_INSERT_ID();`,
            MemberService.profileValues(dto),
          ),
        );
        for (const a of addresses ?? []) await MemberService.insertAddress(tx, memberId, a);
        for (const fm of MemberService.mergeDuplicateFamily(family ?? [])) await MemberService.insertFamilyMember(tx, memberId, fm);
        await assignDefaultMemberRole(tx, memberId);
        if (clubId) {
          await tx.executeProcedure("sp_club_add_member", { p_ClubId: clubId, p_MemberId: memberId, p_JoinedDate: joinedDate, p_CreatedBy: 0 });
          await tx.execute(
            `UPDATE club_members
             SET IsHonoraryMember = @IsHon, modified_date = NOW()
             WHERE fk_club_id = @ClubId
               AND fk_member_master_profile_id = @MemberId
               AND COALESCE(isdeleted, 0) = 0`,
            { ClubId: clubId, MemberId: memberId, IsHon: dto.isHonoraryMember ? 1 : 0 },
          );
        }
        await MemberService.updateDesignationAcrossClubs(tx, memberId, dto.designation, dto.classificationProfession);
        return memberId;
      });
    });

    if (dto.emailId && dto.emailId.trim() && clubId) void this.sendWelcome(id, dto.emailId, dto.memberName || "Member", clubId);
    // Citation points are recalculated for the club when the Zones 4-8 award programmes are on (off on ROW).
    return id;
  }

  private async sendWelcome(memberId: number, email: string, memberName: string, clubId: number) {
    try {
      await this.db.session(async (conn) => {
        const clubName = (await conn.executeScalar<string>("SELECT ClubName FROM club_master WHERE pk_club_id=@Id AND isdeleted=0", { Id: clubId })) ?? "Rotary Club";
        const ctx = await conn.queryFirstOrDefault(
          `SELECT d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
           FROM club_master c
           LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
           LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
           WHERE c.pk_club_id = @Id`,
          { Id: clubId },
        );
        const cc = await conn.query(
          `SELECT DISTINCT m.EmailId
           FROM board_of_directors bod
           JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
           JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
           WHERE bod.fk_club_id = @ClubId AND bod.fk_designation_id IN (1, 4) AND bod.isdeleted = 0
             AND m.EmailId IS NOT NULL AND m.EmailId <> ''`,
          { ClubId: clubId },
        );
        await this.email.sendNewMemberWelcomeEmail(email, memberName, clubName, ctx?.districtNumber ?? null, ctx?.zoneName ?? null, [...new Set(cc.map((r) => String(r.EmailId)))]);
      });
    } catch (e) {
      this.log.error(`Failed to send welcome email for member ${memberId}: ${(e as Error).message}`);
    }
  }

  async update(id: number, dto: SaveMember): Promise<void> {
    const family = this.bindFamily(dto.familyMembers);
    const addresses = this.bindAddresses(dto.addresses);
    await this.db.session(async (conn) => {
      await this.checkDuplicates(conn, dto.primaryMobileNumber, dto.emailId, dto.rotaryId, id);
      MemberService.checkSingleSpouse(family);
      await conn.transaction(async (tx) => {
        await MemberService.releaseSoftDeletedMobile(tx, dto.primaryMobileNumber, id);
        const values = MemberService.profileValues(dto);
        await tx.execute(
          `UPDATE member_master_profile SET
               MemberName = @MemberName, ProfilePhotoPath = @ProfilePhotoPath, fk_primary_country_id = @FkPrimaryCountryId,
               PrimaryMobileNumber = @PrimaryMobileNumber, EmailId = @EmailId, BirthDate = @BirthDate, AnniversaryDate = @AnniversaryDate,
               BloodGroup = @BloodGroup, fk_secondary_country_id = @FkSecondaryCountryId, SecondaryMobileNumber = @SecondaryMobileNumber,
               IsPersonalDetailsVisible = @IsPersonalDetailsVisible, Gender = @Gender, PrimaryLanguage = @PrimaryLanguage, IsYouth = @IsYouth,
               MemberIntroduction = @MemberIntroduction, Facebook = @Facebook, Instagram = @Instagram, LinkedIn = @LinkedIn, Twitter = @Twitter,
               Youtube = @Youtube, Website = @Website, RotaryId = @RotaryId, DonorRecognition = @DonorRecognition,
               FamilyPhotoPath = @FamilyPhotoPath, IsFamilyDetailsVisible = @IsFamilyDetailsVisible,
               modified_by = 0, modified_date = NOW()
           WHERE pk_member_master_profile_id = @Id AND isdeleted = 0`,
          { ...values, Id: id },
        );
        if (addresses) {
          await tx.executeProcedure("sp_member_address_soft_delete_by_member", { p_MemberId: id });
          for (const a of addresses) await MemberService.insertAddress(tx, id, a);
        }
        if (family) await MemberService.upsertFamilyMembers(tx, id, family);
        const joined = dbDateTime(dto.joinedDate);
        if (dto.clubId && dto.clubId > 0 && joined) {
          await tx.execute(
            `UPDATE club_members
             SET JoinedDate = @JoinedDate, modified_date = NOW()
             WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
               AND isdeleted = 0`,
            { ClubId: dto.clubId, MemberId: id, JoinedDate: joined },
          );
        }
        await MemberService.updateDesignationAcrossClubs(tx, id, dto.designation, dto.classificationProfession);
      });
    });
  }

  async delete(id: number): Promise<void> {
    await this.db.session(async (conn) => {
      await conn.executeProcedure("sp_member_soft_delete", { p_Id: id });
      await conn.execute(
        `UPDATE district_committee_group_member m
         JOIN district_committee_group g ON g.id = m.fk_group_id
         SET m.isdeleted = 1, m.modified_date = NOW()
         WHERE m.fk_member_id = @Id AND m.isdeleted = 0 AND g.isdeleted = 0
           AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
             OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')`,
        { Id: id },
      );
    });
  }

  async uploadPhoto(file: UploadedFile, type: string): Promise<string> {
    const folder = type.toLowerCase() === "familymember" ? ["Documents", "FaimilyMembersPhoto"] : ["Documents", "directory"];
    const name = await saveWithGuidName(this.config, file, ...folder);
    return "/" + folder.join("/") + "/" + name;
  }
}

/** RoleService.AssignDefaultMemberRoleAsync: every profile holds the Member role (id 1) once. */
export async function assignDefaultMemberRole(conn: DbCommands, memberId: number): Promise<void> {
  await conn.execute(
    `INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy, IsActive, isdeleted, AssignedDate)
     SELECT @MemberId, 1, @MemberId, 1, 0, NOW() FROM DUAL
     WHERE NOT EXISTS (
         SELECT 1 FROM member_roles
         WHERE fk_member_master_profile_id = @MemberId
           AND fk_role_id = 1
           AND IsActive = 1
           AND isdeleted = 0
     )`,
    { MemberId: memberId },
  );
}
