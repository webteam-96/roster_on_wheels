/**
 * Creates ROW's first SuperAdmin in an empty database, or repairs one (adds the
 * missing credential or role). Nothing is hard-coded: the account comes from
 *   ROW_SUPERADMIN_EMAIL, ROW_SUPERADMIN_NAME, ROW_SUPERADMIN_PASSWORD
 * plus ConnectionStrings__DefaultConnection. The password must meet the
 * portal's rules and is stored as a bcrypt hash, marked temporary so it is
 * changed at first sign-in.
 *
 *   npm run build && npm run bootstrap:superadmin
 */
import bcrypt from "bcryptjs";
import { AppConfig } from "../config/app-config";
import { Brand, loadBrand } from "../brand/brand";
import { Db } from "../database/db.service";
import { validatePasswordComplexity } from "../modules/auth/auth.service";

async function main() {
  const email = process.env.ROW_SUPERADMIN_EMAIL?.trim();
  const name = process.env.ROW_SUPERADMIN_NAME?.trim();
  const password = process.env.ROW_SUPERADMIN_PASSWORD ?? "";
  if (!email || !name || !password) throw new Error("Set ROW_SUPERADMIN_EMAIL, ROW_SUPERADMIN_NAME and ROW_SUPERADMIN_PASSWORD.");
  validatePasswordComplexity(password);

  const config = new AppConfig();
  Brand.initialise(loadBrand(config));
  const db = new Db(config);
  try {
    await db.transaction(async (tx) => {
      let memberId = Number(
        (await tx.executeScalar("SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId = @Email AND isdeleted = 0 LIMIT 1", { Email: email })) ?? 0,
      );
      if (!memberId) {
        memberId = Number(
          await tx.executeScalar(
            `INSERT INTO member_master_profile (MemberName, EmailId, isdeleted, created_by)
             VALUES (@Name, @Email, 0, 0);
             SELECT LAST_INSERT_ID();`,
            { Name: name, Email: email },
          ),
        );
        console.log(`member created: ${memberId}`);
      }

      const hasCred = Number(await tx.executeScalar("SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND isdeleted = 0", { Id: memberId }));
      if (!hasCred) {
        await tx.execute(
          `INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, isdeleted, created_by)
           VALUES (@Id, @Hash, 1, 1, 0, 0)`,
          { Id: memberId, Hash: bcrypt.hashSync(password, 11) },
        );
        console.log("credential created (temporary password)");
      }

      const roleId = Number(await tx.executeScalar("SELECT pk_role_id FROM roles WHERE RoleName = 'SuperAdmin' AND isdeleted = 0"));
      if (!roleId) throw new Error("The SuperAdmin role is missing: load database/seed-master.sql first.");
      const hasRole = Number(
        await tx.executeScalar("SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role AND isdeleted = 0", { Id: memberId, Role: roleId }),
      );
      if (!hasRole) {
        await tx.execute(
          "INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, IsActive, isdeleted, created_by) VALUES (@Id, @Role, 1, 0, 0)",
          { Id: memberId, Role: roleId },
        );
        console.log("SuperAdmin role assigned");
      }
      console.log(`SuperAdmin ready: ${email} (member ${memberId})`);
    });
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
