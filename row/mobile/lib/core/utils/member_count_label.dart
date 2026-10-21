/// Shared formatter for a club's roster counts, used across the club/district
/// directories, the district clubs list, and the Find-a-Club detail tabs so
/// every surface reads identically.
///
/// The displayed "member count" is the REGULAR count (excludes honorary),
/// matching the web — the `ClubDto` contract states: "the regular member count
/// the UI shows is TotalMembers − HonoraryMembers". The honorary count is
/// appended as "· N honorary" only when there is at least one honorary member,
/// so clubs with none stay uncluttered.
///
/// - [total]: the roster size INCLUDING honorary (as `ClubDto` / `ClubListDto`
///   report `totalMembers`). Set [alreadyNet] = true when the source already
///   excludes honorary (e.g. the club-finder members endpoint's `memberCount`).
/// - [honorary]: the honorary count (null → 0).
String memberCountLabel({
  required int total,
  int? honorary,
  bool alreadyNet = false,
}) {
  final hon = (honorary ?? 0) < 0 ? 0 : (honorary ?? 0);
  final regular = alreadyNet ? total : (total - hon).clamp(0, total);
  final base = '$regular member${regular == 1 ? '' : 's'}';
  return hon > 0 ? '$base · $hon honorary' : base;
}
