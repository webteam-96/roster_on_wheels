// Guards the metadata-driven goal form shared by the ENTRY screen and the
// read-only OVERSIGHT viewer: a server-shaped category form must render its
// groups, labels and values, and stay fully disabled when read-only. Field
// editability is decided by FieldRole + the system-filled set, never by a
// hardcoded key — so a DISHA field rebuild flows through untouched.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/presentation/screens/goal_setting/widgets/goal_form_fields.dart';

GoalCategoryForm _form() => GoalCategoryForm.fromJson({
      'categoryId': 1,
      'categoryName': 'Membership',
      'entityType': 'District',
      'districtId': 5656,
      'entityName': 'District 5656',
      'yearId': 9,
      'yearLabel': '2026-27',
      'isEditable': false,
      'isLocked': false,
      'canLock': false,
      'fields': [
        {
          'fieldId': 11,
          'groupName': 'New Clubs',
          'fieldKey': 'total_clubs',
          'fieldLabel': 'Total No of Clubs as on July 1st',
          'dataType': 'Integer',
          'fieldRole': 'Reference',
          'numericValue': 84,
        },
        {
          'fieldId': 12,
          'groupName': 'New Clubs',
          'fieldKey': 'new_clubs',
          'fieldLabel': 'Target of the Current year',
          'dataType': 'Integer',
          'fieldRole': 'Target',
          'numericValue': 90,
        },
        {
          'fieldId': 21,
          'groupName': 'RAG Analysis',
          'fieldKey': 'rag_red',
          'fieldLabel': 'RED',
          'dataType': 'Integer',
          'fieldRole': 'Reference',
          'numericValue': 3,
        },
      ],
    });

void main() {
  testWidgets('read-only goal form renders groups, labels and values', (tester) async {
    final form = _form();
    final buffers = goalBuffersFromForm(form);
    final groups = groupGoalFields(form);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(
          children: [
            for (final g in groups)
              GoalGroupCard(
                groupName: g.key,
                fields: g.value,
                buffers: buffers,
                reloadTick: 0,
                enabled: false,
              ),
          ],
        ),
      ),
    ));

    expect(groups.length, 2);
    expect(find.text('New Clubs'), findsOneWidget);
    expect(find.text('RAG Analysis'), findsOneWidget);
    // The RAG note the web prints beside the heading.
    expect(find.textContaining('RED: 10–25'), findsOneWidget);
    expect(find.text('Target of the Current year'), findsOneWidget);
    // Values are visible even though every field is disabled.
    expect(find.text('84'), findsOneWidget);
    expect(find.text('90'), findsOneWidget);
    // Nothing is editable in read-only mode.
    for (final f in tester.widgetList<TextFormField>(find.byType(TextFormField))) {
      expect(f.enabled, isFalse);
    }
  });

  test('system-filled references are never editable, targets always are', () {
    final form = _form();
    final byKey = {for (final f in form.fields) f.fieldKey: f};
    expect(isGoalFieldEditable(byKey['total_clubs']!), isFalse); // auto-filled
    expect(isGoalFieldEditable(byKey['new_clubs']!), isTrue); // target
    expect(isGoalFieldEditable(byKey['rag_red']!), isFalse); // auto-filled
  });
}
