namespace RotaryApi.Services;

/// <summary>
/// Shared SQL fragments for reading a District Governor's name, photo and contacts.
///
/// A DG is normally a member, and then the member record is the single source of truth —
/// the legacy district_governors.member_name / profile_photo columns are ignored, exactly as
/// before. Some districts have a DG who is not a member of any club; that row is saved with
/// fk_member_id = NULL and carries its own name, photo, email and mobile, so every read falls
/// back to those columns instead of returning blanks.
///
/// Every fragment expects the DG table aliased as <c>g</c> and the member table joined with
/// <see cref="JoinMember"/> as <c>m</c>. Use a LEFT JOIN everywhere: an INNER JOIN silently
/// drops the non-member governors.
/// </summary>
public static class DistrictGovernorSql
{
    /// <summary>Folder under wwwroot that holds photos uploaded for non-member governors.</summary>
    public const string PhotoFolder = "/Documents/WebsiteData/District_Governor/";

    public const string JoinMember = @"LEFT JOIN member_master_profile m
                ON m.pk_member_master_profile_id = g.fk_member_id
               AND COALESCE(m.isdeleted, 0) = 0";

    public const string Name =
        "CASE WHEN m.pk_member_master_profile_id IS NULL THEN g.member_name ELSE m.MemberName END";

    public const string Email =
        "CASE WHEN m.pk_member_master_profile_id IS NULL THEN g.email ELSE m.EmailId END";

    public const string Mobile =
        "CASE WHEN m.pk_member_master_profile_id IS NULL THEN g.mobile_number ELSE m.PrimaryMobileNumber END";

    /// <summary>
    /// Servable photo URL. Member photos keep their existing /Documents/directory/ handling;
    /// a non-member photo is stored filename-only and is prefixed with <see cref="PhotoFolder"/>.
    /// Values already rooted or absolute pass through untouched.
    /// </summary>
    public const string Photo = @"CASE
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
                    ELSE CONCAT('" + PhotoFolder + @"', g.profile_photo)
                END";
}
