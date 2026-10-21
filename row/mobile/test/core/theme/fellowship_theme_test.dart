import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/theme/legacy_prefs.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('colours are locked to Fellowship', () {
    expect(AppColors.primary, const Color(0xFF17458F));
    expect(AppColors.secondary, const Color(0xFFF7A81B));
    expect(AppColors.background, const Color(0xFFF7F9FC));
    expect(AppColors.surface, const Color(0xFFFCFDFE));
    expect(AppColors.textPrimary, const Color(0xFF1B2C42));
    expect(AppColors.rotaryBlue, const Color(0xFF17458F));
  });

  test('tone pairs follow design.md', () {
    expect(RowTone.azure.fill, const Color(0xFF17458F));
    expect(RowTone.azure.onFill, const Color(0xFFF7F9FC));
    expect(RowTone.marigold.onFill, const Color(0xFF1B2C42));
    expect(RowRadii.panel, 24);
    expect(RowMotion.ui, const Duration(milliseconds: 320));
  });

  test('old palette and font picks are cleared at start-up', () async {
    SharedPreferences.setMockInitialValues({'paletteIndex': 1, 'goldIndex': 2, 'font_family': 'lexend', 'keep': true});
    final prefs = await SharedPreferences.getInstance();
    await clearLegacyThemePrefs(prefs);
    expect(prefs.containsKey('paletteIndex'), isFalse);
    expect(prefs.containsKey('goldIndex'), isFalse);
    expect(prefs.containsKey('font_family'), isFalse);
    expect(prefs.getBool('keep'), isTrue);
  });

  test('body uses Figtree, display uses Bricolage Grotesque with tight tracking', () {
    final body = AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.red);
    expect(body.fontFamily, 'Figtree');
    expect(body.fontWeight, FontWeight.w600);
    expect(body.fontVariations, [const FontVariation('wght', 600)]);
    expect(body.color, Colors.red);
    final display = AppFonts.display(fontSize: 20);
    expect(display.fontFamily, 'BricolageGrotesque');
    expect(display.fontWeight, FontWeight.w600);
    expect(display.letterSpacing, closeTo(-0.7, 0.001));
    expect(AppFonts.body(textStyle: const TextStyle(fontSize: 9)).fontSize, 9);
  });
}
