import 'package:flutter/foundation.dart';

/// DEV-ONLY local bypass for route/tab maintenance.
///
/// Lets you work on a section that is flagged "Under Maintenance" on the server
/// WITHOUT turning the server flag off (which would expose the work-in-progress
/// page to every live user). Keys listed here are treated as NOT blocked — but
/// **only in a debug build**. The released app ships in release mode where
/// [kDebugMode] is `false`, so [isMaintenanceDevBypassed] always returns `false`
/// there and live users keep seeing the maintenance panel.
///
/// To work on a flagged section locally: add its key here. When the work ships,
/// remove the key AND have SuperAdmin turn the server flag off.
///
/// Keys must match exactly what the registry uses:
///   • full routes  → the GoRoute template, e.g. `/clubs/:id/membership-dues`
///   • dashboard tabs → `<route>#<tab>`, e.g. `/clubs/:id/overview#membership-dues`
const Set<String> kMaintenanceDevBypassKeys = {
  // Membership Dues — being rebuilt; live users still see the panel.
  '/clubs/:id/membership-dues',
  '/clubs/:id/overview#membership-dues',
  // My Dues (member view of the same module) — bypass locally too.
  '/my-dues',
};

/// True when [key] should be locally bypassed — debug builds only.
bool isMaintenanceDevBypassed(String? key) =>
    kDebugMode && key != null && kMaintenanceDevBypassKeys.contains(key);
