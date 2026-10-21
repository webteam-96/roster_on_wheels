/// Canonicalises a project `approval_status` value.
///
/// Legacy rows in the year-wise `rotary_projects_YYYY_YY` tables stored free-text
/// variants like "Pending For Approval", "Approved", "REJECTED". The backend now
/// normalises these (one-time startup backfill) and the web does the same in its
/// `normalizeStatus`, but the mobile client must guard too — its Approve/Reject
/// buttons and status colours strict-compare against 'pending'/'approved'/
/// 'rejected', so an un-normalised legacy string would hide the action buttons
/// and render an ugly raw label.
///
/// Mirrors the web/backend rule exactly: trim + lowercase, then any value
/// containing "pending"/"reject"/"approv" maps to the canonical token; anything
/// else falls through as its lowercased self.
String normalizeApprovalStatus(String? raw) {
  if (raw == null) return 'pending';
  final v = raw.trim().toLowerCase();
  if (v.isEmpty) return 'pending';
  if (v.contains('pending')) return 'pending';
  if (v.contains('reject')) return 'rejected';
  if (v.contains('approv')) return 'approved';
  return v;
}
