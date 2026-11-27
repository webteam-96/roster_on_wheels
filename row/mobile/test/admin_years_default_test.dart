import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/presentation/widgets/common/admin_years_dialog.dart';

/// YWAR-MOBILE-MAKE-ADMIN-YEARS
///
/// The Make Admin year picker must never open with a year ticked that the
/// caller cannot grant. The web twin does exactly that, and it makes the
/// feature impossible to complete: the row renders locked AND ticked, the
/// submit carries it anyway, and the server answers "You can only grant Rotary
/// years you hold yourself." Found on the RIZones app, 2026-11-18.
///
/// Ids below are years as the options endpoint returns them — StartDate DESC.
const y2627 = 7; // current
const y2526 = 6;
const y2425 = 5;
const y2324 = 4;
const allYearsNewestFirst = [y2627, y2526, y2425, y2324];

void main() {
  group('initialAdminYearSelection', () {
    test('a past-year admin never pre-ticks the ungrantable current year', () {
      // The exact reported case: caller holds 2025-26 only, target holds
      // nothing. Ticking 2026-27 here is what made the dialog unsaveable.
      final picked = initialAdminYearSelection(
        heldYearIds: const [],
        heldAllYears: false,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: y2627,
        grantableYearIds: const [y2526],
      );

      expect(picked, {y2526});
      expect(picked.contains(y2627), isFalse,
          reason: "the current year is not this caller's to grant");
    });

    test('falls back to the MOST RECENT grantable year, not the oldest', () {
      final picked = initialAdminYearSelection(
        heldYearIds: const [],
        heldAllYears: false,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: y2627,
        // Deliberately out of order — the year LIST decides recency, not this.
        grantableYearIds: const [y2324, y2526, y2425],
      );

      expect(picked, {y2526});
    });

    test('a sitting admin still gets the current year — unchanged behaviour',
        () {
      final picked = initialAdminYearSelection(
        heldYearIds: const [],
        heldAllYears: false,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: y2627,
        grantableYearIds: const [y2627, y2526],
      );

      expect(picked, {y2627});
    });

    test('a SuperAdmin (null grantable = every year) gets the current year',
        () {
      final picked = initialAdminYearSelection(
        heldYearIds: const [],
        heldAllYears: false,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: y2627,
        grantableYearIds: null,
      );

      expect(picked, {y2627});
    });

    test('what the target already holds wins over any default', () {
      // Even a year the caller cannot grant stays ticked — it is a fact about
      // the target, not a default, and unticking it is not on offer.
      final picked = initialAdminYearSelection(
        heldYearIds: const [y2627, y2425],
        heldAllYears: false,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: y2627,
        grantableYearIds: const [y2526],
      );

      expect(picked, {y2627, y2425});
    });

    test('an all-years target pre-ticks nothing individually', () {
      final picked = initialAdminYearSelection(
        heldYearIds: const [],
        heldAllYears: true,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: y2627,
        grantableYearIds: null,
      );

      expect(picked, isEmpty,
          reason: 'the All Years checkbox carries it instead');
    });

    test('a caller holding nothing ticks nothing rather than something locked',
        () {
      final picked = initialAdminYearSelection(
        heldYearIds: const [],
        heldAllYears: false,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: y2627,
        grantableYearIds: const [],
      );

      expect(picked, isEmpty);
    });

    test('no current year configured still yields a saveable default', () {
      final picked = initialAdminYearSelection(
        heldYearIds: const [],
        heldAllYears: false,
        yearIdsNewestFirst: allYearsNewestFirst,
        currentYearId: null,
        grantableYearIds: const [y2425],
      );

      expect(picked, {y2425});
    });

    test('whatever it picks is always grantable', () {
      // The invariant the bug broke, over every shape above.
      const cases = <List<int>?>[
        [y2526],
        [y2324, y2526, y2425],
        [y2627, y2526],
        [],
        null,
      ];
      for (final grantable in cases) {
        final picked = initialAdminYearSelection(
          heldYearIds: const [],
          heldAllYears: false,
          yearIdsNewestFirst: allYearsNewestFirst,
          currentYearId: y2627,
          grantableYearIds: grantable,
        );
        for (final id in picked) {
          expect(grantable == null || grantable.contains(id), isTrue,
              reason: 'picked $id which $grantable does not allow');
        }
      }
    });
  });

  group('AdminYearsResult.toBody', () {
    test('sends the chosen years when not all-years', () {
      const r = AdminYearsResult(yearIds: [y2526], allYears: false);
      expect(r.toBody(), {
        'yearIds': [y2526],
        'allYears': false,
      });
    });

    test('an all-years grant sends an EMPTY year list', () {
      // The server ignores yearIds when allYears is true; sending both invites
      // them to disagree.
      const r = AdminYearsResult(yearIds: [y2526, y2425], allYears: true);
      expect(r.toBody(), {
        'yearIds': <int>[],
        'allYears': true,
      });
    });
  });
}
