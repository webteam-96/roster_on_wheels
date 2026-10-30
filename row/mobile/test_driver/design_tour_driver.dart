import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

// Saves each design-tour screenshot to build/design_tour/<name>.png and the per-route report to
// build/design_tour/report.json.
Future<void> main() async {
  final dir = Directory('build/design_tour')..createSync(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      File('${dir.path}/$name.png').writeAsBytesSync(bytes);
      return true;
    },
    responseDataCallback: (data) async {
      File('${dir.path}/report.json').writeAsStringSync(const JsonEncoder.withIndent(' ').convert(data));
    },
  );
}
