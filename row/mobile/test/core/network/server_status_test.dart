import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/network/api_client.dart';
import 'package:rotary_flutter_app/core/network/api_exceptions.dart';

// OMS ROW-56: a 501 (no AI key on the server) reached the project form as 500, so it showed
// "AI unavailable" instead of "AI suggestions are not set up".
class _ToLocalServer extends HttpOverrides {
  _ToLocalServer(this.port);
  final int port;

  @override
  HttpClient createHttpClient(SecurityContext? context) => super.createHttpClient(context)
    ..connectionFactory =
        (_, __, ___) => Socket.startConnect(InternetAddress.loopbackIPv4, port);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized(); // the time-zone header reads a platform channel
  late HttpServer server;

  setUpAll(() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((r) async {
      await r.drain<void>();
      r.response.statusCode = int.parse(r.uri.pathSegments.last);
      r.response.write('{"message":"from server"}');
      await r.response.close();
    });
    HttpOverrides.global = _ToLocalServer(server.port);
  });

  tearDownAll(() async {
    HttpOverrides.global = null;
    await server.close(force: true);
  });

  for (final status in [500, 501, 502, 503, 504, 507]) {
    test('a $status keeps its status code and the server message', () async {
      await expectLater(
        ApiClient().post<dynamic>('/x/$status', requiresAuth: false),
        throwsA(isA<ApiException>()
            .having((e) => e.statusCode, 'statusCode', status)
            .having((e) => e.message, 'message', 'from server')),
      );
    });
  }
}
