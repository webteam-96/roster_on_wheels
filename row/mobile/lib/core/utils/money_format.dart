import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import '../theme/app_colors.dart';
import 'currency_symbol.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// Money and number formatting in the brand's number locale and currency, mirroring the
// web `createFormat` (row/admin/src/lib/format.ts): whole amounts print without
// decimals, compact money uses the locale's K/M/B, and Cr/L/K only for an en-IN brand.

bool _indianLocale() => brandNumberLocale().toLowerCase() == 'en_in';

/// Compact money in the brand currency (kept under its old name for existing callers).
String fmtInrShort(num v) => shortMoney(v, null);

/// Full money in the brand currency (kept under its old name for existing callers).
String fmtInrFull(num v) => formatMoney(v.round(), null);

/// Compact money with the currency's symbol ("$1.7M", "€3.4K"). Mirrors web `moneyShort`.
String shortMoney(num? value, String? code) {
  final n = (value ?? 0).toDouble();
  final cur = currencyCodeOr(code);
  if (_indianLocale()) {
    final sym = currencySymbolFor(cur);
    final sep = sym.length > 1 ? ' ' : '';
    for (final (size, unit) in const [(10000000, 'Cr'), (100000, 'L'), (1000, 'K')]) {
      if (n.abs() >= size) return '$sym$sep${(n / size).toStringAsFixed(1)}$unit';
    }
    return '$sym$sep${n.round()}';
  }
  final f = NumberFormat.compactSimpleCurrency(locale: brandNumberLocale(), name: cur)
    ..significantDigitsInUse = false
    ..minimumFractionDigits = 0
    ..maximumFractionDigits = 1; // as the web `maximumFractionDigits: 1`
  return f.format(n);
}

/// Full money with grouping ("$105", "€1,250.50"). Mirrors web `money`.
String formatMoney(num? value, String? code) {
  final n = (value ?? 0).toDouble();
  return NumberFormat.simpleCurrency(
    locale: brandNumberLocale(),
    name: currencyCodeOr(code),
    decimalDigits: n == n.roundToDouble() ? 0 : null,
  ).format(n);
}

/// Integer with the brand locale's grouping (1,234,567; 12,34,567 for en-IN).
String fmtInt(int v) => NumberFormat.decimalPattern(brandNumberLocale()).format(v);

/// One-line footnote decoding the short-INR suffixes. Place under any card
/// that uses [fmtInrShort].
class CurrencyLegend extends StatelessWidget {
  const CurrencyLegend({super.key});

  @override
  Widget build(BuildContext context) {
    // Only lakh / crore need decoding; K / M / B read on their own.
    if (!_indianLocale()) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Text(
        'L = lakh  ·  Cr = crore  ·  K = thousand',
        style: AppFonts.body(
          fontSize: 9.5,
          color: AppColors.slate400,
        ),
      ),
    );
  }
}
