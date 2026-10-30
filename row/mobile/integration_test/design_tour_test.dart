// Design tour: signs in, opens every app route and records layout overflows and exceptions per route,
// with a screenshot of each (saved by test_driver/design_tour_driver.dart). Local test data only.
//
//   flutter drive --driver=test_driver/design_tour_driver.dart \
//     --target=integration_test/design_tour_test.dart -d <device> \
//     --dart-define=API_BASE_URL=http://10.0.2.2:5000 \
//     --dart-define=TOUR_EMAIL=<local test email> --dart-define=TOUR_PASSWORD=<local test password>
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';

import 'package:rotary_flutter_app/main.dart' as app;
import 'package:rotary_flutter_app/presentation/providers/auth_provider.dart';

const _club = 143, _district = 3, _member = 84;

// Every screen reachable by a plain path (route_names.dart), with local ids filled in. Payment flows, web
// views, maintenance and the sign-in screens (checked separately) are left out.
final _routes = <String>[
  '/home', '/profile', '/profile/edit', '/notifications', '/calendar', '/club-calendar', '/district-calendar',
  '/club-finder', '/find-rotarian', '/members', '/members/new', '/members/$_member/edit', '/directory/$_member',
  '/me/foundation-designations', '/chat', '/volunteers', '/volunteers/duties', '/invite-guest', '/planning',
  '/helpline', '/my-club-websites', '/my-district-websites', '/settings', '/settings/language',
  '/settings/text-size', '/settings/privacy-notifications', '/settings/my-data', '/settings/security',
  '/settings/communication', '/settings/designations', '/settings/area-of-focus', '/settings/rotary-years',
  '/settings/event-masters', '/settings/credit-management', '/settings/themes', '/settings/website-data-modules',
  '/clubs', '/clubs/new', '/districts', '/districts/new', '/zones', '/zones/new', '/agdashboard', '/ag-reports',
  '/admin/login-logs', '/club-website-manage', '/unified/$_district',
  for (final m in [
    'dashboard', 'overview', 'edit', 'goal-setting', 'announcements', 'attendance', 'board-of-directors',
    'citation', 'club-monthly-report', 'club-service', 'documents', 'greetings', 'international-service',
    'mass-emails', 'members', 'new-generation-service', 'newsletters', 'ocv-gov', 'past-presidents', 'projects',
    'public-image-initiative', 'reports', 'rotary-network', 'rotary-network/potential-members',
    'rotary-network/terminated-members', 'sub-groups', 'trf', 'upcoming-events', 'vocational-service',
    'weblinks', 'website-data',
  ])
    '/clubs/$_club/$m',
  for (final m in [
    'dashboard', 'overview', 'edit', 'goal-setting', 'ag', 'announcements', 'club-monthly-report', 'clubs',
    'district-citation', 'district-committee', 'district-events', 'documents', 'greetings', 'mass-emails',
    'members', 'newsletters', 'online-event-link', 'projects', 'reports', 'sub-groups', 'upcoming-events',
    'weblinks', 'website-data',
  ])
    '/districts/$_district/$m',
];

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('design tour', (tester) async {
    final report = <String, Map<String, Object>>{};
    var current = 'startup';
    final testHandler = FlutterError.onError; // the test framework wants this back at the end

    app.main();
    await tester.pumpAndSettle(const Duration(seconds: 8));
    await binding.convertFlutterSurfaceToImage();

    // Installed after app.main() so the app's own handler cannot replace it.
    FlutterError.onError = (details) {
      final text = details.exceptionAsString();
      final entry = report.putIfAbsent(current, () => {'overflow': <String>[], 'errors': <String>[]});
      final key = text.contains('overflowed') ? 'overflow' : 'errors';
      final list = entry[key] as List<String>;
      if (list.length < 5) list.add(text.split('\n').first);
    };
    try {
    final ctx = tester.element(find.byType(Scaffold).first);
    final auth = Provider.of<AuthProvider>(ctx, listen: false);
    if (!auth.isLoggedIn) {
      await auth.login(
        email: const String.fromEnvironment('TOUR_EMAIL'),
        password: const String.fromEnvironment('TOUR_PASSWORD'),
      );
    }
    await tester.pumpAndSettle(const Duration(seconds: 3));
    // Taken once: some screens have no Scaffold of their own while they load.
    final router = GoRouter.of(tester.element(find.byType(Scaffold).first));

    for (var i = 0; i < _routes.length; i++) {
      current = _routes[i];
      router.go(current);
      // Data screens load over the network; give them time but never hang on a spinner.
      try {
        await tester.pumpAndSettle(const Duration(milliseconds: 200), EnginePhase.sendSemanticsUpdate,
            const Duration(seconds: 12));
      } catch (_) {
        await tester.pump(const Duration(seconds: 2));
      }
      await binding.takeScreenshot('${i.toString().padLeft(3, '0')}${current.replaceAll('/', '_')}');
    }

    } finally {
      FlutterError.onError = testHandler;
      // Merge: the driver reads the screenshots it saved from this same map.
      binding.reportData = {...?binding.reportData, 'routes': _routes, 'report': report};
    }
  });
}
