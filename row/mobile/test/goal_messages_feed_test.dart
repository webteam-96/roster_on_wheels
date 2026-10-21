// Guards the RI Director's message roster model.
//
// The roster is per (member, CATEGORY) — the same person can appear twice under
// two categories, so a list keyed on member alone would silently collapse rows.
// Messages also carry a district, and a zone-wide message carries none, which is
// how "All districts" is told apart from a specific one.
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/goal_setting_models.dart';

void main() {
  group('message roster', () {
    test('parses a District Assistant with their covered districts', () {
      final o = GoalMessageOwner.fromJson({
        'memberId': 5,
        'categoryId': 1,
        'name': 'A Person',
        'roleLabel': 'District Assistant',
        'categoryName': 'Membership',
        'districts': '3141, 3142',
        'messageCount': 3,
      });
      expect(o.roleLabel, 'District Assistant');
      expect(o.districts, '3141, 3142');
      expect(o.messageCount, 3);
    });

    test('a Zone Co-ordinator covers the zone, so carries no districts', () {
      final o = GoalMessageOwner.fromJson({
        'memberId': 6,
        'categoryId': 1,
        'name': 'Another Person',
        'roleLabel': 'Zone Co-ordinator',
        'districts': null,
        'messageCount': 0,
      });
      expect(o.districts, isNull);
      expect(o.messageCount, 0);
    });

    test('the same member under two categories is two distinct rows', () {
      final a = GoalMessageOwner.fromJson(
          {'memberId': 5, 'categoryId': 1, 'name': 'A Person'});
      final b = GoalMessageOwner.fromJson(
          {'memberId': 5, 'categoryId': 2, 'name': 'A Person'});
      // Keying on memberId alone would lose one of these.
      expect(a.memberId, b.memberId);
      expect(a.categoryId == b.categoryId, isFalse);
    });
  });

  group('message district tags', () {
    test('a message about one district carries its number', () {
      final c = GoalComment.fromJson({
        'id': 1,
        'commentText': 'hello',
        'postedByName': 'A Person',
        'postedByTier': 3,
        'districtId': 77,
        'districtNumber': '3141',
      });
      expect(c.districtId, 77);
      expect(c.districtNumber, '3141');
    });

    test('a zone-wide message carries no district at all', () {
      final c = GoalComment.fromJson({
        'id': 2,
        'commentText': 'zone wide',
        'postedByName': 'A Person',
        'postedByTier': 2,
      });
      expect(c.districtId, isNull);
      expect(c.districtNumber, isNull);
      // Tier 2 is the Zone Co-ordinator — that is what makes it read as
      // "All districts" rather than as a missing value.
      expect(c.postedByTier, 2);
    });
  });
}
