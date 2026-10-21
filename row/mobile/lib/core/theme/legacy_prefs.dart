import 'package:shared_preferences/shared_preferences.dart';

/// The theme is locked to Fellowship (2026-10-19): the palette, gold and font
/// pickers are gone, so drop what they stored on existing installs.
Future<void> clearLegacyThemePrefs(SharedPreferences prefs) async {
  for (final key in const ['paletteIndex', 'goldIndex', 'font_family']) {
    await prefs.remove(key);
  }
}
