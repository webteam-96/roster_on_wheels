// Guards the login-announcement payload parsing.
//
// The server sends BOTH shapes deliberately — items[] for the ◀ ▶ popup, and
// the legacy show/id/content (= first item) so older builds keep working. The
// app must read correctly against either, and must never surface a half-formed
// row as a blank page the reader has to arrow past.
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/login_announcement_model.dart';

void main() {
  test('reads items[] and keeps their order', () {
    final a = ActiveLoginAnnouncement.fromJson({
      'show': true,
      'id': 7,
      'content': '<p>first</p>',
      'items': [
        {'id': 7, 'content': '<p>first</p>', 'roles': ['ClubAdmin']},
        {'id': 9, 'content': '<p>second</p>', 'roles': ['ALL']},
      ],
    });
    expect(a.hasContent, isTrue);
    expect(a.items.length, 2);
    expect(a.items.first.id, 7);
    expect(a.items.last.content, '<p>second</p>');
    // Legacy accessors still point at the first item.
    expect(a.id, 7);
    expect(a.content, '<p>first</p>');
  });

  test('falls back to the legacy single fields when items[] is absent', () {
    // An older API — or a payload whose items[] we could not use.
    final a = ActiveLoginAnnouncement.fromJson({
      'show': true,
      'id': 3,
      'content': '<p>only one</p>',
    });
    expect(a.items.length, 1);
    expect(a.items.single.id, 3);
    expect(a.hasContent, isTrue);
  });

  test('show:false is nothing to display, even with items present', () {
    final a = ActiveLoginAnnouncement.fromJson({
      'show': false,
      'items': [
        {'id': 1, 'content': '<p>x</p>'},
      ],
    });
    expect(a.hasContent, isFalse);
  });

  test('rows with no id or no content are dropped, not shown blank', () {
    final a = ActiveLoginAnnouncement.fromJson({
      'show': true,
      'items': [
        {'id': 1, 'content': ''},          // empty body
        {'content': '<p>no id</p>'},       // no id to acknowledge
        {'id': 4, 'content': '<p>ok</p>'},
      ],
    });
    expect(a.items.length, 1);
    expect(a.items.single.id, 4);
  });

  test('an id arriving as a string or number still parses', () {
    final a = ActiveLoginAnnouncement.fromJson({
      'show': true,
      'items': [
        {'id': '11', 'content': '<p>a</p>'},
        {'id': 12.0, 'content': '<p>b</p>'},
      ],
    });
    expect(a.items.map((i) => i.id), [11, 12]);
  });

  group('role labels', () {
    test('known keys read as words', () {
      expect(LoginAnnouncementItem.roleLabel('RIDirector'), 'RI Director');
      expect(LoginAnnouncementItem.roleLabel('ClubAdmin'), 'Club Admin');
      expect(LoginAnnouncementItem.roleLabel('ALL'), 'All roles');
    });

    test('an unknown key falls back to itself rather than vanishing', () {
      // A role added on the server later must still read sensibly.
      expect(LoginAnnouncementItem.roleLabel('SomeNewRole'), 'SomeNewRole');
    });
  });
}
