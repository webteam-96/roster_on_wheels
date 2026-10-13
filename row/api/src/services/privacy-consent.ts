import { Brand } from "../brand/brand";

/**
 * Consent filter for broadcast messages (master plan WS7-05 step 3): announcements, events, newsletters
 * and the other content items sent by email or push go only to members who accepted the current policy.
 * Transactional messages (one-time codes, receipts, a member's own dues) do not use this filter.
 *
 * Returns "" (no filter) unless privacy.enabled is on, a policy version is set and "announcement" is in
 * Brand:Privacy:ConsentRequiredFor. The table member_consents is created by PrivacyService at start-up.
 */
export function broadcastConsentFilter(memberIdColumn = "m.pk_member_master_profile_id"): string {
  if (!Brand.feature("privacy.enabled")) return "";
  const version = (Brand.Current.legal.policyVersion ?? "").trim();
  const required = Brand.Current.privacy?.consentRequiredFor ?? [];
  if (!version || !required.includes("announcement")) return "";
  // The version is configuration, not input; keep it to a safe literal all the same.
  const safe = version.replace(/[^A-Za-z0-9._-]/g, "");
  return ` AND EXISTS (SELECT 1 FROM member_consents mc WHERE mc.fk_member_id = ${memberIdColumn}
      AND mc.withdrawn_at_utc IS NULL AND mc.policy_version = '${safe}')`;
}
