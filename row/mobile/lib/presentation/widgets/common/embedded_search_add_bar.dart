import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Compact "search + Add" row used inside embedded list screens (e.g. the
/// district Foundation tab's Projects / Events sub-lists), mirroring the web
/// card header: a title-search field on the left and an explicit labelled
/// add button on the right (clearer than a floating "+").
///
/// Search fires on keyboard submit (Enter / the search key). A clear (✕) button
/// appears while there is text. The add button is shown only when [canAdd].
class EmbeddedSearchAddBar extends StatefulWidget {
  final TextEditingController controller;
  final String hintText;
  final String addLabel;
  final bool canAdd;
  final VoidCallback onSubmit;
  final VoidCallback onClear;
  final VoidCallback onAdd;

  const EmbeddedSearchAddBar({
    super.key,
    required this.controller,
    required this.hintText,
    required this.addLabel,
    required this.canAdd,
    required this.onSubmit,
    required this.onClear,
    required this.onAdd,
  });

  @override
  State<EmbeddedSearchAddBar> createState() => _EmbeddedSearchAddBarState();
}

class _EmbeddedSearchAddBarState extends State<EmbeddedSearchAddBar> {
  @override
  void initState() {
    super.initState();
    // Rebuild so the clear (✕) button shows/hides as the field changes.
    widget.controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final hasText = widget.controller.text.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: SizedBox(
              height: 44,
              child: TextField(
                controller: widget.controller,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => widget.onSubmit(),
                style: AppFonts.body(fontSize: 13),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: widget.hintText,
                  hintStyle: AppFonts.body(
                      fontSize: 13, color: AppColors.slate400),
                  prefixIcon:
                      const Icon(Icons.search_rounded, size: 19, color: AppColors.slate400),
                  suffixIcon: hasText
                      ? IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          color: AppColors.slate400,
                          splashRadius: 18,
                          onPressed: widget.onClear,
                        )
                      : null,
                  contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 4),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.slate200),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.slate200),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.rotaryBlue, width: 1.4),
                  ),
                ),
              ),
            ),
          ),
          if (widget.canAdd) ...[
            const SizedBox(width: 8),
            SizedBox(
              height: 44,
              child: FilledButton.icon(
                onPressed: widget.onAdd,
                icon: const Icon(Icons.add_rounded, size: 18),
                label: Text(
                  widget.addLabel,
                  style: AppFonts.body(
                      fontSize: 12.5, fontWeight: FontWeight.w700),
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.success,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
