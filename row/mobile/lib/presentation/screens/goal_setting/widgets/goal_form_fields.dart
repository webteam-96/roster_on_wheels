import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Rendering for a Goal Setting category form — the mobile twin of the web
/// `GoalSettingPanel` field layer, used by the ENTRY screen (club / district
/// admins setting their own targets).
///
/// Everything here is metadata-driven — the server supplies each field's
/// DataType (Integer/Decimal/Percentage/Currency/Boolean/Text), FieldRole
/// (Reference/Target/Computed) and GroupName, and these widgets decide how it
/// renders. NEVER hardcode a field key here: the DISHA field rebuilds flow
/// through untouched.

/// Reference fields the SYSTEM fills automatically (from live DB counts or the
/// SuperAdmin/MCR imports) — these stay read-only even though they're
/// References. Every OTHER Reference field has no data source, so the admin
/// types it. Copied verbatim from the web `SYSTEM_FILLED_REFERENCE` set — keep
/// in sync if the web list changes.
const Set<String> kGoalSystemFilledReference = {
  // Membership — injected live in GoalSettingService.
  'total_clubs', 'new_clubs_achieved', 'total_members', 'new_members_achieved',
  'existing_women_members', 'new_women_members_achieved',
  'rag_red', 'rag_amber', 'rag_green', 'rag_super_green',
  // Foundation (district) — the 10 "Achieved" values from the SuperAdmin Excel import.
  'aks_achieved', 'endowment_achieved', 'bequest_achieved', 'directed_gift_achieved',
  'polio_plus_achieved', 'annual_fund_achieved', 'phf_achieved', 'phsm_achieved',
  'major_donors_achieved', 'csr_achieved',
  // Foundation (club) — the contribution figures from the MCR import.
  'club_af_per_capita', 'club_annual_fund_ytd', 'club_polioplus_ytd',
  'club_other_funds_ytd', 'club_endowment_ytd', 'club_total_ytd',
};

/// Editable = a Target, or a Reference the system does NOT auto-fill.
bool isGoalFieldEditable(GoalFieldWithValue f) {
  if (f.isTarget) return true;
  if (f.isReference) return !kGoalSystemFilledReference.contains(f.fieldKey);
  return false; // Computed
}

/// Format a numeric value the way the web does (`String(n)`): whole numbers
/// show with no decimals, everything else keeps its fractional part.
String goalNumToText(num? n) {
  if (n == null) return '';
  if (n is int) return n.toString();
  if (n == n.truncateToDouble()) return n.toInt().toString();
  return n.toString();
}

/// Local edit buffer for one field (text for every type but Boolean).
class GoalFieldBuffer {
  String text;
  bool bool_;
  GoalFieldBuffer({this.text = '', this.bool_ = false});
}

/// Seed one buffer per field from a freshly loaded form.
Map<int, GoalFieldBuffer> goalBuffersFromForm(GoalCategoryForm form) {
  final out = <int, GoalFieldBuffer>{};
  for (final f in form.fields) {
    final text = f.isText ? (f.textValue ?? '') : goalNumToText(f.numericValue);
    out[f.fieldId] = GoalFieldBuffer(text: text, bool_: f.boolValue ?? false);
  }
  return out;
}

/// Fields grouped by GroupName, preserving the server's field order.
List<MapEntry<String, List<GoalFieldWithValue>>> groupGoalFields(
    GoalCategoryForm form) {
  final map = <String, List<GoalFieldWithValue>>{};
  for (final f in form.fields) {
    (map[f.groupName] ??= []).add(f);
  }
  return map.entries.toList();
}

/// The extra note the web prints beside a group heading (RAG Analysis only).
String? goalGroupNote(String groupName) => groupName == 'RAG Analysis'
    ? '(Healthy Clubs by active members per club: RED: 10–25 · AMBER: 26–40 · GREEN: 41+)'
    : null;

/// One group of fields as a card: blue heading with the amber underline, then
/// a divider-separated row per field.
class GoalGroupCard extends StatelessWidget {
  final String groupName;
  final List<GoalFieldWithValue> fields;
  final Map<int, GoalFieldBuffer> buffers;

  /// Bumped by the parent on every (re)load so the rows get fresh keys and
  /// their TextFormFields re-seed from the newly-loaded values.
  final int reloadTick;

  /// Whether the form as a whole accepts edits. Per-field editability is still
  /// decided by [isGoalFieldEditable] — read-only surfaces pass false.
  final bool enabled;

  final void Function(GoalFieldWithValue field, String value)? onText;
  final void Function(GoalFieldWithValue field, bool value)? onBool;

  const GoalGroupCard({
    super.key,
    required this.groupName,
    required this.fields,
    required this.buffers,
    required this.reloadTick,
    required this.enabled,
    this.onText,
    this.onBool,
  });

  @override
  Widget build(BuildContext context) {
    final note = goalGroupNote(groupName);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Container(
              padding: const EdgeInsets.only(bottom: 6),
              decoration: const GoalGroupUnderline(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    groupName,
                    style: AppFonts.body(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.rotaryBlue,
                    ),
                  ),
                  if (note != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      note,
                      style: AppFonts.body(
                        fontSize: 10.5,
                        height: 1.35,
                        color: AppColors.slate500,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          for (int i = 0; i < fields.length; i++)
            GoalFieldRow(
              key: ValueKey('${fields[i].fieldId}_$reloadTick'),
              field: fields[i],
              buffer: buffers[fields[i].fieldId] ??= GoalFieldBuffer(),
              enabled: enabled && isGoalFieldEditable(fields[i]),
              isLast: i == fields.length - 1,
              onText: (v) => onText?.call(fields[i], v),
              onBool: (v) => onBool?.call(fields[i], v),
            ),
        ],
      ),
    );
  }
}

/// Amber underline under a group header (matches the web's `border-amber-400`).
class GoalGroupUnderline extends Decoration {
  const GoalGroupUnderline();
  @override
  BoxPainter createBoxPainter([VoidCallback? onChanged]) => _UnderlinePainter();
}

class _UnderlinePainter extends BoxPainter {
  @override
  void paint(Canvas canvas, Offset offset, ImageConfiguration cfg) {
    final size = cfg.size ?? Size.zero;
    final paint = Paint()
      ..color = AppColors.goldPrime
      ..strokeWidth = 2;
    final y = offset.dy + size.height;
    canvas.drawLine(Offset(offset.dx, y), Offset(offset.dx + size.width, y), paint);
  }
}

/// The category tab used above a goal form (Membership / TRF / …).
class GoalCategoryPill extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback? onTap;
  const GoalCategoryPill({
    super.key,
    required this.label,
    required this.active,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? AppColors.rotaryBlue : AppColors.surface,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: active ? AppColors.rotaryBlue : AppColors.slate200),
          ),
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: active ? Colors.white : AppColors.slate500,
            ),
          ),
        ),
      ),
    );
  }
}

/// One field row: label on the left, value control on the right. The control
/// switches on DataType — a YES/NO toggle for Boolean, a multi-line box for
/// Text, and a right-aligned number box (with $ / % affixes) for the numeric
/// types. A disabled row still shows its value, which is what makes this
/// reusable as the read-only viewer.
class GoalFieldRow extends StatelessWidget {
  final GoalFieldWithValue field;
  final GoalFieldBuffer buffer;
  final bool enabled;
  final bool isLast;
  final ValueChanged<String> onText;
  final ValueChanged<bool> onBool;

  const GoalFieldRow({
    super.key,
    required this.field,
    required this.buffer,
    required this.enabled,
    required this.isLast,
    required this.onText,
    required this.onBool,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(bottom: BorderSide(color: AppColors.slate100)),
      ),
      child: Row(
        crossAxisAlignment:
            field.isText ? CrossAxisAlignment.start : CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Text(
              field.fieldLabel,
              style: AppFonts.body(
                fontSize: 13,
                height: 1.3,
                color: AppColors.slate700,
              ),
            ),
          ),
          const SizedBox(width: 12),
          _control(),
        ],
      ),
    );
  }

  Widget _control() {
    if (field.isBoolean) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _YesNo(
              label: 'YES',
              selected: buffer.bool_,
              enabled: enabled,
              onTap: () => onBool(true)),
          const SizedBox(width: 6),
          _YesNo(
              label: 'NO',
              selected: !buffer.bool_,
              enabled: enabled,
              onTap: () => onBool(false)),
        ],
      );
    }

    if (field.isText) {
      return SizedBox(
        width: 190,
        child: TextFormField(
          initialValue: buffer.text,
          enabled: enabled,
          minLines: 2,
          maxLines: 4,
          keyboardType: TextInputType.multiline,
          textInputAction: TextInputAction.newline,
          onChanged: onText,
          style: AppFonts.body(fontSize: 13, color: AppColors.textPrimary),
          decoration: _boxDecoration(hint: enabled ? 'Enter text…' : ''),
        ),
      );
    }

    // Integer / Decimal / Percentage / Currency
    return SizedBox(
      width: 150,
      child: TextFormField(
        initialValue: buffer.text,
        enabled: enabled,
        textAlign: TextAlign.right,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
        onChanged: onText,
        style: AppFonts.body(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: enabled ? AppColors.textPrimary : AppColors.slate500,
        ),
        decoration: _boxDecoration(
          hint: enabled ? '0' : '',
          prefixText: field.isCurrency ? '${field.unit ?? '\$'} ' : null,
          suffixText: field.isPercentage ? ' %' : null,
        ),
      ),
    );
  }

  InputDecoration _boxDecoration({String? hint, String? prefixText, String? suffixText}) {
    return InputDecoration(
      isDense: true,
      hintText: hint,
      hintStyle: AppFonts.body(fontSize: 13, color: AppColors.slate400),
      prefixText: prefixText,
      suffixText: suffixText,
      prefixStyle: AppFonts.body(fontSize: 13, color: AppColors.slate500),
      suffixStyle: AppFonts.body(fontSize: 13, color: AppColors.slate500),
      filled: true,
      fillColor: enabled ? AppColors.surface : AppColors.slate50,
      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: AppColors.slate200),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: AppColors.rotaryBlue, width: 1.5),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: AppColors.slate200),
      ),
    );
  }
}

class _YesNo extends StatelessWidget {
  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;
  const _YesNo({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.6,
      child: Material(
        color: selected ? AppColors.rotaryBlue : AppColors.slate100,
        borderRadius: BorderRadius.circular(7),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(7),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
            child: Text(
              label,
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: selected ? Colors.white : AppColors.slate500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
