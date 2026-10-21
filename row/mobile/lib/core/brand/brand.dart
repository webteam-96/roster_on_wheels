import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../constants/api_constants.dart';
import '../network/api_client.dart';

/// The instance brand (name, logos, support contacts, domains, legal links, feature
/// flags) from `GET api/public/brand`, cached on the device. Screens read
/// [Brand.current] instead of hard-coding an organisation.
class BrandInfo {
  final String productName;
  final String shortName;
  final String logoUrl;
  final String logoDarkUrl;
  final String supportEmail;
  final List<String> supportPhones;
  final String supportHours;
  final String legalName;
  final String adminOrigin;
  final String clubSiteParent;
  final String termsUrl;
  final String privacyUrl;
  final String defaultCurrency;
  /// BCP 47 locale for numbers and money ("en-US", "en-IN"), as the web `brand.locale.numberLocale`.
  final String numberLocale;
  /// ISO codes this instance offers, as the web `brand.locale.currencies`.
  final List<String> currencies;
  final Map<String, bool> features;

  const BrandInfo({
    required this.productName,
    required this.shortName,
    this.logoUrl = '',
    this.logoDarkUrl = '',
    this.supportEmail = '',
    this.supportPhones = const [],
    this.supportHours = '',
    this.legalName = '',
    this.adminOrigin = '',
    this.clubSiteParent = '',
    this.termsUrl = '',
    this.privacyUrl = '',
    this.defaultCurrency = 'USD',
    this.numberLocale = 'en-US',
    this.currencies = const ['USD'],
    this.features = const {},
  });

  /// ROW's defaults (the same as the API's) until the brand has been fetched once.
  static const BrandInfo defaults = BrandInfo(productName: 'Roster On Wheels', shortName: 'ROW');

  factory BrandInfo.fromJson(Map<String, dynamic> j) {
    Map<String, dynamic> obj(String k) => (j[k] is Map) ? Map<String, dynamic>.from(j[k] as Map) : <String, dynamic>{};
    String s(Map<String, dynamic> m, String k, [String fallback = '']) => (m[k] ?? fallback).toString();
    final support = obj('support'), domains = obj('domains'), legal = obj('legal'), locale = obj('locale');
    final productName = s(j, 'productName');
    return BrandInfo(
      productName: productName.isEmpty ? defaults.productName : productName,
      shortName: s(j, 'shortName').isEmpty ? defaults.shortName : s(j, 'shortName'),
      logoUrl: s(j, 'logoUrl'),
      logoDarkUrl: s(j, 'logoDarkUrl'),
      supportEmail: s(support, 'email'),
      supportPhones: ((support['phones'] as List?) ?? const []).map((e) => e.toString()).where((e) => e.isNotEmpty).toList(),
      supportHours: s(support, 'hours'),
      legalName: s(support, 'legalName'),
      adminOrigin: s(domains, 'adminOrigin').replaceAll(RegExp(r'/+$'), ''),
      clubSiteParent: s(domains, 'clubSiteParent'),
      termsUrl: s(legal, 'termsUrl'),
      privacyUrl: s(legal, 'privacyUrl'),
      defaultCurrency: s(locale, 'defaultCurrency', 'USD'),
      numberLocale: s(locale, 'numberLocale', 'en-US'),
      currencies: ((locale['currencies'] as List?) ?? const ['USD']).map((e) => e.toString().toUpperCase()).toList(),
      features: ((j['features'] as Map?) ?? const {}).map((k, v) => MapEntry(k.toString(), v == true)),
    );
  }

  /// A brand path ("/terms") on the admin web origin; an absolute URL is returned as is; '' when unknown.
  String webUrl(String pathOrUrl) {
    if (pathOrUrl.isEmpty) return '';
    if (pathOrUrl.startsWith('http')) return pathOrUrl;
    if (adminOrigin.isEmpty) return '';
    return '$adminOrigin${pathOrUrl.startsWith('/') ? '' : '/'}$pathOrUrl';
  }

  /// The logo for a dark background (else the normal one), as an absolute URL; '' when none.
  String logoFor({bool dark = false}) {
    final path = dark && logoDarkUrl.isNotEmpty ? logoDarkUrl : logoUrl;
    if (path.isEmpty) return '';
    return path.startsWith('http') ? path : (webUrl(path).isNotEmpty ? webUrl(path) : '${ApiConstants.baseUrl}$path');
  }

  bool feature(String key) => features[key] ?? false;
}

class Brand {
  static const _cacheKey = 'brand_cache_v1';
  static BrandInfo current = BrandInfo.defaults;

  /// Start-up: the cached brand at once, then the API's (waits at most a few seconds; offline keeps the cache).
  static Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString(_cacheKey);
      if (cached != null) current = BrandInfo.fromJson(jsonDecode(cached) as Map<String, dynamic>);
      final res = await ApiClient()
          .get<dynamic>('/api/public/brand', requiresAuth: false, fromJson: (j) => j)
          .timeout(const Duration(seconds: 4));
      if (res.isSuccess && res.data is Map) {
        final map = Map<String, dynamic>.from(res.data as Map);
        current = BrandInfo.fromJson(map);
        await prefs.setString(_cacheKey, jsonEncode(map));
      }
    } catch (_) {
      // Offline or the API is down: keep the cached brand or the defaults.
    }
  }
}
