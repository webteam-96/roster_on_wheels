import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum FontScale { system, small, medium, large, extraLarge }

class FontScaleController extends ChangeNotifier {
  static const _prefsKey = 'font_scale';

  FontScale _scale = FontScale.system;
  FontScale get scale => _scale;

  FontScaleController() {
    _loadFromPrefs();
  }

  TextScaler get textScaler {
    switch (_scale) {
      case FontScale.system:
        return TextScaler.noScaling;
      case FontScale.small:
        return const TextScaler.linear(0.9);
      case FontScale.medium:
        return const TextScaler.linear(1.0);
      case FontScale.large:
        return const TextScaler.linear(1.2);
      case FontScale.extraLarge:
        return const TextScaler.linear(1.4);
    }
  }

  Future<void> _loadFromPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw != null) {
      _scale = FontScale.values.firstWhere(
        (e) => e.name == raw,
        orElse: () => FontScale.system,
      );
    }
    notifyListeners();
  }

  Future<void> setScale(FontScale s) async {
    if (s == _scale) return;
    _scale = s;
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, s.name);
  }
}
