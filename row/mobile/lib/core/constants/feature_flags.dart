/// Temporary launch feature flags.
///
/// Use these to hide a feature that isn't production-ready yet WITHOUT deleting
/// its code — flip the flag back to `true` to re-enable everything at once.
library;

/// Membership-dues **offline-payment flow**. Gates, as one unit:
///   • the home-page "offline payments pending approval" nudge
///     (`_checkPendingOfflineApprovals` in `home_screen.dart`), and
///   • the dues-roster offline actions — "Update/View Offline" (the
///     `DuesOfflinePaymentDialog`) and the Approve / Reject buttons.
///
/// Online "Pay Now", the member dues view, reminders, receipts and reports are
/// unaffected by this flag. Set `false` to hide the whole offline-payment flow
/// again (e.g. for a launch where dues isn't finalised); `true` keeps it live.
const bool kOfflinePaymentsEnabled = true;

/// Member **Privacy** settings entry (Settings → Preferences).
///
/// The 4 contact-visibility flags (`Show{Phone,Email}In{My,All}Club`) are now
/// LIVE end-to-end: `MemberPrivacyHelper` on the backend enforces them across the
/// club-finder, find-rotarian, district-directory, members, clubs and public
/// club-website reads, so toggling actually hides your phone/email. The flags
/// layer UNDER the existing `IsPersonalDetailsVisible` master switch (never
/// overriding it). Enabled 2026-07-31 once that read-gating shipped.
const bool kPrivacySettingsEnabled = true;

/// The **Notifications** half of the member settings screen (4 `Notify*` module
/// toggles). Kept hidden: the backend PERSISTS these flags but no push
/// dispatcher honors them yet (push-suppression is still Phase 2), so exposing
/// them would ship toggles that don't stop any notification. Flip to `true` once
/// the backend filters recipients by these flags in the FCM dispatch, and the
/// settings screen's Notifications section + entry label light up together.
const bool kNotificationPrefsEnabled = false;

/// "Near Me" club search in **Find a Club** (`club_finder_search_screen.dart`).
/// The GPS / nearby-clubs endpoint isn't working yet, so the Near Me tab shows
/// a "Coming Soon" placeholder and its bottom Search button is hidden. The Any
/// Club tab is unaffected. Flip to `true` once Near Me works to restore the real
/// form + search with no other change (the form / `_runNearMeSearch` / results
/// code is retained, just gated).
const bool kNearMeEnabled = true;

/// The **Goal Setting** feature as a whole. Hidden for the App Store / Play Store
/// release on 2026-09-10 because the module is not fully done on mobile (month-wise
/// goal collection and the Excel/goal reports are backend-blocked — no mobile
/// routes yet). While `false`, every Goal Setting entry point is suppressed:
///   • the "Goal Setting" module tile + route on the club and district dashboards,
///   • the club Foundation "Collection Goals" card (gated together with
///     `kFoundationGoalsEnabled`),
///   • the "Goal Setting" export row on the Club Report screen.
/// (The AG "Goals & Club Excellence" tab and the district Foundation/Membership
/// goal editors are already unmounted/unwired, so nothing extra is needed there.)
/// Flip to `true` to bring the whole Goal Setting feature back at once.
/// 2026-09-11: RE-ENABLED after the Goal-Setting-free build was shipped to the
/// App Store / Play Store. (Month-wise + Excel reports are still backend-blocked;
/// re-hide before the next store release if they haven't shipped.)
const bool kGoalSettingEnabled = true;
