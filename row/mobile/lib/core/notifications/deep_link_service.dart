import 'dart:developer' as dev;

import '../routing/app_router.dart';
import '../routing/route_names.dart';

/// Translates a tapped push notification's FCM `data` payload into an in-app
/// route and navigates there.
///
/// Contract (see `MD_files/Firebase_Notification_DeepLink_Contract_Club.md`):
/// every notification carries a `type` discriminator plus the IDs the target
/// screen needs. All `data` values arrive as STRINGS (FCM requirement) and are
/// parsed to int here.
///
/// Timing: a tap can happen while the app is running (warm) or launch a killed
/// app (cold start). On a cold start the router/auth aren't ready yet, so the
/// route is queued in [_pending] and drained by [consumePending] once the
/// authenticated landing screen (HomeScreen) is mounted — which also covers the
/// "tapped while logged out → login → home" path.
class DeepLinkService {
  DeepLinkService._();
  static final DeepLinkService instance = DeepLinkService._();

  String? _pending;

  /// Handle a notification TAP. [coldStart] is true when the tap launched a
  /// terminated app (via getInitialMessage). Warm taps navigate immediately;
  /// cold-start taps (or taps that arrive before the router exists) are queued.
  void handleTap(Map<String, dynamic> data, {required bool coldStart}) {
    final route = routeForData(data);
    dev.log('tap type=${data['type']} -> route=${route ?? "(open app)"} '
        'cold=$coldStart', name: 'PUSH');
    if (route == null) return; // my_birthday / my_anniversary / unknown → just open the app
    if (coldStart || appRouter == null) {
      _pending = route;
      return;
    }
    _navigate(route);
  }

  /// Navigate to any route that was queued while the app wasn't ready. Called
  /// from HomeScreen once it's mounted + the user is authenticated. No-op when
  /// nothing is queued.
  void consumePending() {
    final route = _pending;
    if (route == null) return;
    _pending = null;
    _navigate(route);
  }

  /// Drop any queued deep-link. Called on logout so a stale link can't fire
  /// against a different account's session.
  void clearPending() => _pending = null;

  void _navigate(String route) {
    try {
      // push (not go) so the system Back button returns to home rather than
      // exiting the app.
      appRouter?.push(route);
    } catch (e) {
      dev.log('deep-link navigation failed for "$route": $e', name: 'PUSH');
    }
  }

  /// Map an FCM `data` payload to an in-app route. Returns null when the
  /// notification should merely open the app (my_birthday / my_anniversary) or
  /// the type is unknown / required IDs are missing.
  String? routeForData(Map<String, dynamic> data) {
    final type = (data['type'] ?? '').toString();
    int? id(String key) => int.tryParse((data[key] ?? '').toString());

    final clubId = id('clubId');

    switch (type) {
      // ── Communication ───────────────────────────────────────────────────
      case 'club_announcement':
        if (clubId == null) return null;
        final a = id('announcementId');
        return a == null
            ? RouteNames.clubAnnouncements(clubId)
            : '${RouteNames.clubAnnouncements(clubId)}?openId=$a';
      case 'club_upcoming_event':
        if (clubId == null) return null;
        final e = id('eventId');
        return e == null
            ? RouteNames.clubUpcomingEvents(clubId)
            : '${RouteNames.clubUpcomingEvents(clubId)}?openId=$e';
      case 'club_newsletter':
        if (clubId == null) return null;
        final n = id('newsletterId');
        return n == null
            ? RouteNames.clubNewsletters(clubId)
            : '${RouteNames.clubNewsletters(clubId)}?openId=$n';
      case 'club_greeting':
        if (clubId == null) return null;
        return RouteNames.clubGreetings(clubId);

      // ── Birthday / Anniversary ──────────────────────────────────────────
      // Personal — just open the app (no deep-link).
      case 'my_birthday':
      case 'my_anniversary':
        return null;
      // Broadcast digest → the user's calendars. Must be the combined list
      // (clubs AND districts) — `clubCalendar` on its own lists clubs only, so
      // a district birthday/anniversary digest opened onto a screen that could
      // never show it. No IDs are needed; the list screen scopes each entry.
      case 'celebrations_digest':
        return RouteNames.myCalendars;

      // ── Projects (6 avenues) ────────────────────────────────────────────
      case 'club_project_club_service':
      case 'club_project_community_service':
      case 'club_project_vocational_service':
      case 'club_project_international_service':
      case 'club_project_new_generation_service':
      case 'club_project_public_image_initiative':
        if (clubId == null) return null;
        return _projectRoute(type, clubId, id('projectId'), id('yearId'));

      default:
        return null;
    }
  }

  /// Build a project avenue route, appending the optional open-detail params.
  String _projectRoute(String type, int clubId, int? projectId, int? yearId) {
    String base;
    var hasQuery = false;
    switch (type) {
      case 'club_project_club_service':
        base = RouteNames.clubService(clubId);
        break;
      case 'club_project_community_service':
        base = '${RouteNames.clubProjects(clubId)}?module=community_service';
        hasQuery = true;
        break;
      case 'club_project_vocational_service':
        base = RouteNames.vocationalService(clubId);
        break;
      case 'club_project_international_service':
        base = RouteNames.internationalService(clubId);
        break;
      case 'club_project_new_generation_service':
        base = RouteNames.newGenerationService(clubId);
        break;
      case 'club_project_public_image_initiative':
        base = RouteNames.publicImageInitiative(clubId);
        break;
      default:
        base = RouteNames.clubProjects(clubId);
    }
    if (projectId == null) return base;
    base = '$base${hasQuery ? '&' : '?'}openProjectId=$projectId';
    if (yearId != null) base = '$base&openYearId=$yearId';
    return base;
  }
}
