/**
 * Port of DistrictGovernorSql.cs: SQL fragments that read a district governor
 * from the linked member when there is one, else from the governor row itself.
 * Use with `district_governors g` and JOIN_MEMBER.
 */
export const DG_PHOTO_FOLDER = "/Documents/WebsiteData/District_Governor/";

export const DG_JOIN_MEMBER = `LEFT JOIN member_master_profile m
                ON m.pk_member_master_profile_id = g.fk_member_id
               AND COALESCE(m.isdeleted, 0) = 0`;

export const DG_NAME = "CASE WHEN m.pk_member_master_profile_id IS NULL THEN g.member_name ELSE m.MemberName END";
export const DG_EMAIL = "CASE WHEN m.pk_member_master_profile_id IS NULL THEN g.email ELSE m.EmailId END";
export const DG_MOBILE = "CASE WHEN m.pk_member_master_profile_id IS NULL THEN g.mobile_number ELSE m.PrimaryMobileNumber END";
export const DG_PHOTO = `CASE
                    WHEN m.pk_member_master_profile_id IS NOT NULL THEN
                        CASE
                            WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                            WHEN m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                            WHEN m.ProfilePhotoPath LIKE '/Documents/%' THEN m.ProfilePhotoPath
                            ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                        END
                    WHEN g.profile_photo IS NULL OR g.profile_photo = '' THEN NULL
                    WHEN g.profile_photo LIKE 'http%' THEN g.profile_photo
                    WHEN g.profile_photo LIKE '/Documents/%' THEN g.profile_photo
                    ELSE CONCAT('${DG_PHOTO_FOLDER}', g.profile_photo)
                END`;
