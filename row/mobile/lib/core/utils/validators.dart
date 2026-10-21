import 'package:phone_numbers_parser/phone_numbers_parser.dart';

class Validators {
  static String? required(String? value, [String fieldName = 'This field']) {
    if (value == null || value.trim().isEmpty) return '$fieldName is required.';
    return null;
  }

  static String? email(String? value) {
    if (value == null || value.trim().isEmpty) return 'Email is required.';
    final regex = RegExp(r'^[\w.+-]+@[\w-]+\.[a-z]{2,}$', caseSensitive: false);
    if (!regex.hasMatch(value.trim())) return 'Enter a valid email address.';
    return null;
  }

  /// Country-AGNOSTIC phone check. Use ONLY where no country is selected
  /// alongside the field (e.g. admin contact forms). Was hardcoded to exactly
  /// 10 digits (India) which wrongly rejected every foreign number; now accepts
  /// any plausible international length (E.164: up to 15 digits). For inputs
  /// that have a country picker, use [phoneForCountry] instead so the country's
  /// own rules apply.
  static String? phone(String? value) {
    if (value == null || value.trim().isEmpty) return 'Phone number is required.';
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 5 || digits.length > 15) {
      return 'Enter a valid phone number.';
    }
    return null;
  }

  /// Country-AWARE phone validation. Pass the selected country's ISO code
  /// (e.g. "IN", "HR") and/or its dial code (e.g. "+91"); the number's own
  /// country LENGTH rules are applied via libphonenumber data (India 10 digits,
  /// Croatia 8–9, etc.). When the country can't be resolved it falls back to a
  /// permissive international length check so a valid number is never blocked.
  ///
  /// Uses `isValidLength()` (length-only), NOT `isValid()` (full numbering-plan
  /// pattern match), on purpose: this gates the LOGIN form, and full pattern
  /// matching could reject a real but newly-allocated number the bundled
  /// metadata doesn't know yet — locking a legitimate user out. Length checks
  /// still fix the original "always 10 digits" bug without that risk.
  static String? phoneForCountry(
    String? value, {
    String? isoCode,
    String? dialCode,
    bool required = true,
  }) {
    final raw = (value ?? '').trim();
    if (raw.isEmpty) return required ? 'Phone number is required.' : null;
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return 'Enter a valid phone number.';

    final iso = _isoFromCode(isoCode);
    try {
      final PhoneNumber phone;
      if (iso != null) {
        phone = PhoneNumber.parse(digits, destinationCountry: iso);
      } else {
        final dc = (dialCode ?? '').replaceAll(RegExp(r'\D'), '');
        phone = PhoneNumber.parse(dc.isNotEmpty ? '+$dc$digits' : digits);
      }
      if (!phone.isValidLength()) {
        return 'Enter a valid phone number.';
      }
      return null;
    } catch (_) {
      // Couldn't resolve a country (unknown ISO/dial code) — fall back to a
      // permissive range so we never wrongly block a plausible number.
      if (digits.length < 5 || digits.length > 15) {
        return 'Enter a valid phone number.';
      }
      return null;
    }
  }

  /// Maps an ISO country-code string (e.g. "in", "HR") to the package's
  /// [IsoCode] enum; null if blank or unrecognised.
  static IsoCode? _isoFromCode(String? code) {
    final c = (code ?? '').trim().toUpperCase();
    if (c.isEmpty) return null;
    try {
      return IsoCode.values.byName(c);
    } catch (_) {
      return null;
    }
  }

  static String? password(String? value) {
    if (value == null || value.isEmpty) return 'Password is required.';
    if (value.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  static String? confirmPassword(String? value, String original) {
    if (value == null || value.isEmpty) return 'Please confirm your password.';
    if (value != original) return 'Passwords do not match.';
    return null;
  }

  static String? minLength(String? value, int min, [String fieldName = 'This field']) {
    if (value == null || value.trim().isEmpty) return '$fieldName is required.';
    if (value.trim().length < min) return '$fieldName must be at least $min characters.';
    return null;
  }

  static String? maxLength(String? value, int max, [String fieldName = 'This field']) {
    if (value != null && value.trim().length > max) {
      return '$fieldName must be at most $max characters.';
    }
    return null;
  }

  static String? url(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final regex = RegExp(r'^https?://.+\..+', caseSensitive: false);
    if (!regex.hasMatch(value.trim())) return 'Enter a valid URL (e.g. https://example.com).';
    return null;
  }

  static String? positiveNumber(String? value, [String fieldName = 'Value']) {
    if (value == null || value.trim().isEmpty) return null;
    final num = double.tryParse(value.trim());
    if (num == null) return 'Enter a valid number.';
    if (num < 0) return '$fieldName must be a positive number.';
    return null;
  }
}
