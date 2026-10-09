import type { AppConfig } from "../config/app-config";
import type { DbCommands } from "../database/db.service";
import { UnauthorizedAccessException } from "../common/exceptions";

/**
 * Port of LoginAllowlistHelper.cs. TEMPORARY login restriction: only mobile
 * numbers listed in LoginAllowlist:Mobiles may log in while
 * LoginAllowlist:Enabled is true. Email logins are resolved to the member's
 * PrimaryMobileNumber so the gate cannot be bypassed.
 *
 * Applied to AuthService.login (web) and MobileAuthService.requestOtp (mobile).
 */
export async function ensureMobileAllowed(config: AppConfig, conn: DbCommands, mobile: string | null | undefined, email: string | null | undefined): Promise<void> {
  if (!config.getBool("LoginAllowlist:Enabled")) return; // allowlist disabled -> everyone allowed

  const allowed = config.getArray("LoginAllowlist:Mobiles");
  if (allowed.length === 0) return; // empty allowlist -> no restriction

  let mobileToCheck = mobile?.trim() || null;
  if (!mobileToCheck && email && email.trim()) {
    mobileToCheck = await conn.executeScalar<string>(
      "SELECT PrimaryMobileNumber FROM member_master_profile WHERE EmailId = @Email AND isdeleted = 0 LIMIT 1",
      { Email: email.trim() },
    );
  }

  if (!mobileToCheck || !allowed.includes(mobileToCheck.trim())) {
    throw new UnauthorizedAccessException(
      "Login is temporarily restricted to authorised testers during live verification. Please contact support if you believe this is in error.",
    );
  }
}
