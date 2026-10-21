/// Helpers for opening addresses in Google Maps.
///
/// Hand-typed Indian addresses are frequently smushed — no space after commas
/// or periods (e.g. `Nr.Tikuji-Ni-Wadi,Thane W.`) and littered with
/// abbreviations. Google Maps tokenizes its search query on spaces, so a
/// smushed run like `Nr.Tikuji-Ni-Wadi,Thane` collapses into one giant
/// unmatchable token and Maps returns "no results" even when it knows the
/// place. Normalizing spacing + a few common abbreviations lets Maps' fuzzy
/// matcher resolve the locality/society/pincode.
library;

/// Normalize a raw address into a Maps-friendly query string.
/// Returns an empty string if [raw] is blank.
String normalizeAddressForMaps(String raw) {
  var s = raw.trim();
  if (s.isEmpty) return '';

  // Expand common Indian address abbreviations (case-insensitive, dot
  // optional) into full words so each becomes its own searchable token.
  const expansions = <String, String>{
    r'\bNr\.?\s*': 'Near ',
    r'\bOpp\.?\s*': 'Opposite ',
    r'\bBldg\.?\s*': 'Building ',
    r'\bRd\.?\b': 'Road',
  };
  expansions.forEach((pattern, replacement) {
    s = s.replaceAll(RegExp(pattern, caseSensitive: false), replacement);
  });

  // Insert a space after any comma/period immediately followed by a
  // non-space character ("Wadi,Thane" -> "Wadi, Thane").
  s = s.replaceAllMapped(RegExp(r'([,.])(?=\S)'), (m) => '${m[1]} ');

  // Collapse runs of whitespace and trim stray spaces before punctuation.
  s = s.replaceAll(RegExp(r'\s+'), ' ').replaceAll(RegExp(r'\s+([,.])'), r'$1');

  return s.trim();
}

/// Build the universal cross-platform Google Maps search URL for [address]
/// (opens the Maps app if installed, otherwise the browser). Returns null
/// when [address] is blank.
String? googleMapsSearchUrl(String address) {
  final q = normalizeAddressForMaps(address);
  if (q.isEmpty) return null;
  return 'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(q)}';
}
