import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/services/club_analytics_service.dart';
import 'package:rotary_flutter_app/core/utils/currency_symbol.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/data/models/ag_dashboard_models.dart';
import 'package:rotary_flutter_app/presentation/screens/ag/widgets/ag_format.dart';

BrandInfo _brand(String numberLocale, String currency) => BrandInfo.fromJson({
      'locale': {'numberLocale': numberLocale, 'defaultCurrency': currency},
    });

void main() {
  tearDown(() => Brand.current = BrandInfo.defaults);

  test('brand carries the number locale (default en-US)', () {
    expect(BrandInfo.fromJson({}).numberLocale, 'en-US');
    expect(_brand('fr-FR', 'EUR').numberLocale, 'fr-FR');
  });

  group('ROW defaults (en-US, USD)', () {
    setUp(() => Brand.current = _brand('en-US', 'USD'));

    test('full money uses the brand currency and thousands grouping', () {
      expect(formatMoney(1234567, null), '\$1,234,567');
      expect(formatMoney(1250.5, 'USD'), '\$1,250.50');
      expect(fmtInrFull(1655000), '\$1,655,000');
    });

    test('short money uses K / M / B, never lakh or crore', () {
      expect(shortMoney(1655000, null), '\$1.7M');
      expect(fmtInrShort(5000), '\$5K');
      expect(ClubAnalyticsService.fmtInr(23000000), '\$23M');
    });

    test('plain numbers group in thousands', () {
      expect(fmtInt(1234567), '1,234,567');
      expect(agFmtInt(1234567), '1,234,567');
    });

    test('symbol comes from the currency code, defaulting to the brand currency', () {
      expect(currencySymbolFor(null), '\$');
      expect(currencySymbolFor('EUR'), '€');
      expect(currencySymbolFor('GBP'), '£');
    });
  });

  test('an en-IN brand keeps Indian grouping and lakh / crore', () {
    Brand.current = _brand('en-IN', 'INR');
    expect(fmtInt(1655000), '16,55,000');
    expect(shortMoney(1655000, null), '₹16.6L');
  });

  test('a row without a currency takes the brand currency, never INR', () {
    Brand.current = _brand('en-US', 'EUR');
    expect(AgProjectRow.fromJson(const {}).currency, 'EUR');
    expect(AgProjectRow.fromJson(const {'currency': 'CAD'}).currency, 'CAD');
  });
}
