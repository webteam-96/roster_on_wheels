import 'package:intl/intl.dart';
import '../brand/brand.dart';

/// Number locale for `intl` from the brand's BCP 47 tag ("en-US" -> "en_US").
String brandNumberLocale() => Brand.current.numberLocale.replaceAll('-', '_');

/// ISO code to use: the given one, else the brand's default currency.
String currencyCodeOr(String? code) =>
    (code == null || code.trim().isEmpty ? Brand.current.defaultCurrency : code).toUpperCase();

/// Symbol for an ISO currency code ("$", "€", "₹"), in the brand's number locale.
/// Mirrors the web `currencySymbol`; null/unknown falls back to the brand currency.
String currencySymbolFor(String? code) =>
    NumberFormat.simpleCurrency(locale: brandNumberLocale(), name: currencyCodeOr(code)).currencySymbol;
