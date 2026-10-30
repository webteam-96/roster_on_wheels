import 'dart:async' as async_lib;
import 'dart:convert';
import 'dart:developer' as dev;
import 'dart:io';
import 'package:cupertino_http/cupertino_http.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:http_parser/http_parser.dart' show MediaType;
import 'package:mime/mime.dart' show lookupMimeType;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../constants/api_constants.dart';
import '../constants/app_constants.dart';
import 'api_exceptions.dart';
import 'api_response.dart';

class ApiClient {
  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;
  ApiClient._internal();

  // resetOnError: FALSE (intentional) — must match AuthProvider's store.
  // `true` silently DELETES an entry it can't decrypt, which could wipe the
  // auth token on a transient keystore failure (common right after an app/OS
  // update). We instead let the read throw and swallow it in [_token] so a
  // single failed request never destroys the stored token.
  // iOS accessibility: first_unlock (kSecAttrAccessibleAfterFirstUnlock). The
  // library default is `unlocked` (WhenUnlocked), which makes the token
  // UNREADABLE whenever the phone is locked — a background wake / push / resume
  // then reads null and the app logs the user out. first_unlock keeps the token
  // readable after the first unlock following a reboot, even when the phone
  // later locks. Confirmed on-device 2026-09-07 (Keychain Lock Test). Must match
  // AuthProvider's store. Existing tokens migrate to this accessibility on the
  // next write (login, or the X-Refreshed-Token daily rotation below).
  final FlutterSecureStorage _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(resetOnError: false),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  // iOS release: NSURLSession via cupertino_http — uses Apple's system trust
  // store (same as Safari), avoiding Dart/BoringSSL's bundled CA list.
  // iOS debug + Android: standard IOClient with debug-only SSL bypass so dev
  // workflow keeps working with self-signed / Plesk-quirky certs.
  final http.Client _client = _buildClient();

  static http.Client _buildClient() {
    if (Platform.isIOS && !kDebugMode) {
      return CupertinoClient.defaultSessionConfiguration();
    }
    final c = HttpClient();
    if (kDebugMode) {
      c.badCertificateCallback = (_, __, ___) => true;
    }
    return IOClient(c);
  }

  final Duration _timeout =
      const Duration(seconds: AppConstants.requestTimeoutSeconds);

  /// Called on a 401. [reason] is non-null only for a server-signalled
  /// force-relogin (the `X-Force-Relogin` header — e.g. an admin changed this
  /// member's mobile, invalidating the token), so the auth layer can show a
  /// clearer message than an ordinary expiry.
  void Function({String? reason})? onUnauthorized;

  /// Called when the server rotates the JWT via the `x-refreshed-token` header,
  /// passing the new expiry parsed from `x-refreshed-token-expires-at`. Lets the
  /// auth layer keep its in-memory idle clock in lockstep with the real token so
  /// an active user is never logged out while the rotated token is still valid.
  void Function(DateTime expiresAt)? onTokenRefreshed;

  // Swallow a transient keystore read failure (returns null) rather than
  // throwing and breaking the request. With resetOnError:false the stored
  // token is preserved through the hiccup, so a later request recovers it.
  Future<String?> get _token async {
    try {
      return await _storage.read(key: AppConstants.tokenKey);
    } catch (_) {
      return null;
    }
  }

  /// True only when a 401 rejected the token the app holds now. A request sent without a token, or
  /// with a token a newer sign-in has replaced, must not end the live session (it raced a login).
  static bool rejectsCurrentSession(String? sentAuthHeader, String? currentToken) =>
      sentAuthHeader != null && currentToken != null && sentAuthHeader == 'Bearer $currentToken';

  Future<void> _endSessionIfCurrent(String? sentAuthHeader, String? reason) async {
    if (rejectsCurrentSession(sentAuthHeader, await _token)) {
      onUnauthorized?.call(reason: reason);
    }
  }

  Future<Map<String, String>> _headers({bool requiresAuth = true}) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (requiresAuth) {
      final token = await _token;
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
      }
    }
    return headers;
  }

  Uri _uri(String path, [Map<String, dynamic>? queryParams]) {
    final uri = Uri.parse('${ApiConstants.baseUrl}$path');
    if (queryParams == null || queryParams.isEmpty) return uri;
    final filtered = queryParams.map((k, v) => MapEntry(k, v?.toString() ?? ''))
      ..removeWhere((_, v) => v.isEmpty);
    return uri.replace(queryParameters: filtered.isEmpty ? null : filtered);
  }

  // Field names whose values should be redacted in log output.
  // Match is case-insensitive and substring-based — `currentPassword`,
  // `confirmNewPassword`, `accessToken`, `refreshToken` etc. are all caught.
  static final RegExp _sensitiveKey =
      RegExp(r'password|otp|pin|token|secret', caseSensitive: false);

  // Fields whose names match `_sensitiveKey` but don't actually carry secrets
  // (debug-only echo, expiry counters). Exempted so logs stay readable.
  static final Set<String> _nonSensitiveAllowlist = {
    'debugotp',
    'otpexpiresinseconds',
    'devicetoken',
    'token'
  };

  static const String _redacted = '***';

  /// Walks a decoded JSON tree and replaces any sensitive field's value with
  /// '***'. Returns a new structure — never mutates the original.
  static dynamic _maskSensitive(dynamic node) {
    if (node is Map) {
      final masked = <String, dynamic>{};
      node.forEach((k, v) {
        if (k is String &&
            _sensitiveKey.hasMatch(k) &&
            !_nonSensitiveAllowlist.contains(k.toLowerCase())) {
          masked[k] = _redacted;
        } else {
          masked[k.toString()] = _maskSensitive(v);
        }
      });
      return masked;
    }
    if (node is List) {
      return node.map(_maskSensitive).toList();
    }
    return node;
  }

  /// Returns the URL with any sensitive query params (otp, token, password)
  /// redacted. Used so URLs in logs never carry secrets.
  static String _maskedUrl(Uri url) {
    if (url.queryParameters.isEmpty) return url.toString();
    final masked = <String, String>{};
    url.queryParameters.forEach((k, v) {
      final isSensitive = _sensitiveKey.hasMatch(k) &&
          !_nonSensitiveAllowlist.contains(k.toLowerCase());
      masked[k] = isSensitive ? _redacted : v;
    });
    return url.replace(queryParameters: masked).toString();
  }

  /// Pretty-print a JSON-encoded body string for logging, with sensitive
  /// fields redacted. Falls back to a length placeholder for non-JSON.
  String _formatBodyForLog(String body) {
    try {
      final masked = _maskSensitive(jsonDecode(body));
      return const JsonEncoder.withIndent('  ').convert(masked);
    } catch (_) {
      return '<${body.length} bytes, non-JSON>';
    }
  }

  void _logRequest(String method, Uri url, {String? body}) {
    dev.log('┌─ $method ${_maskedUrl(url)}', name: 'API');
    if (body != null && body != 'null' && body.isNotEmpty) {
      dev.log('├─ BODY: ${_formatBodyForLog(body)}', name: 'API');
    }
  }

  void _logError(String method, Uri url, Object error) {
    dev.log('└─ ❌ $method ${_maskedUrl(url)}: $error', name: 'API');
  }

  void _logResponse(http.Response response) {
    final status = response.statusCode;
    final emoji = status >= 200 && status < 300 ? '✅' : '❌';
    final url = response.request?.url;
    final urlStr = url != null ? _maskedUrl(url) : '';
    dev.log('└─ $emoji $status $urlStr', name: 'API');
    if (response.body.isNotEmpty) {
      dev.log('   RESPONSE: ${_formatBodyForLog(response.body)}', name: 'API');
    }
  }

  /// Last-resort check for connectivity failures that arrive as an untyped
  /// platform error (iOS/macOS surface these through the native URL loading
  /// system rather than as a `SocketException`).
  static bool _looksOffline(Object error) {
    final s = error.toString().toLowerCase();
    return s.contains('nsurlerrordomain') ||
        s.contains('connection appears to be offline') ||
        s.contains('failed host lookup') ||
        s.contains('network is unreachable') ||
        s.contains('connection refused') ||
        s.contains('connection closed') ||
        s.contains('software caused connection abort');
  }

  /// Central mapper from raw transport errors to user-facing exceptions.
  /// Used by every HTTP method so SSL / HTTP / Format / Timeout failures
  /// never leak raw Dart error strings into the UI.
  Never _throwFromTransportError(String method, Uri url, Object error) {
    _logError(method, url, error);
    if (error is ApiException) throw error;
    // Anything that means "the request never reached the server" gets ONE
    // plain-English message. The raw OS/platform text (SocketException,
    // NSErrorClientException with NSURLErrorDomain codes and the request URI,
    // …) is developer detail and must never reach the screen.
    if (error is SocketException ||
        error is HandshakeException ||
        error is HttpException ||
        error is http.ClientException ||
        _looksOffline(error)) {
      throw const NetworkException(kOfflineMessage);
    }
    if (error is async_lib.TimeoutException) {
      throw const TimeoutException();
    }
    if (error is FormatException) {
      throw const ApiException('Invalid response format.');
    }
    throw const ApiException(
        'Something went wrong. Please try again in a moment.');
  }

  Future<ApiResponse<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParams,
    T Function(dynamic)? fromJson,
    bool requiresAuth = true,
  }) async {
    final url = _uri(path, queryParams);
    _logRequest('GET', url);
    try {
      final response = await _client
          .get(url, headers: await _headers(requiresAuth: requiresAuth))
          .timeout(_timeout);
      return _handleResponse<T>(response, fromJson: fromJson);
    } catch (e) {
      _throwFromTransportError('GET', url, e);
    }
  }

  /// GET a binary payload (Excel, PDF, image bytes). Bypasses the JSON
  /// envelope decoder — returns the response bytes verbatim. Auth and
  /// transport error handling match the regular `get` path.
  Future<Uint8List> downloadBytes(
    String path, {
    Map<String, dynamic>? queryParams,
    bool requiresAuth = true,
  }) async {
    final url = _uri(path, queryParams);
    _logRequest('GET', url);
    try {
      final headers = await _headers(requiresAuth: requiresAuth);
      headers['Accept'] = '*/*';
      final response =
          await _client.get(url, headers: headers).timeout(_timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        dev.log('└─ ❌ ${response.statusCode} ${_maskedUrl(url)}', name: 'API');
        throw ApiException(
          'Download failed (HTTP ${response.statusCode})',
          statusCode: response.statusCode,
        );
      }
      dev.log(
        '└─ ✅ ${response.statusCode} ${_maskedUrl(url)} '
        '(${response.bodyBytes.length} bytes)',
        name: 'API',
      );
      return response.bodyBytes;
    } catch (e) {
      _throwFromTransportError('GET', url, e);
    }
  }

  Future<ApiResponse<T>> post<T>(
    String path, {
    Object? body,
    T Function(dynamic)? fromJson,
    bool requiresAuth = true,
  }) async {
    final url = _uri(path);
    final encoded = body != null ? jsonEncode(body) : null;
    _logRequest('POST', url, body: encoded);
    try {
      final response = await _client
          .post(url,
              headers: await _headers(requiresAuth: requiresAuth),
              body: encoded)
          .timeout(_timeout);
      return _handleResponse<T>(response, fromJson: fromJson);
    } catch (e) {
      _throwFromTransportError('POST', url, e);
    }
  }

  Future<ApiResponse<T>> put<T>(
    String path, {
    Object? body,
    T Function(dynamic)? fromJson,
    bool requiresAuth = true,
  }) async {
    final url = _uri(path);
    final encoded = body != null ? jsonEncode(body) : null;
    _logRequest('PUT', url, body: encoded);
    try {
      final response = await _client
          .put(url,
              headers: await _headers(requiresAuth: requiresAuth),
              body: encoded)
          .timeout(_timeout);
      return _handleResponse<T>(response, fromJson: fromJson);
    } catch (e) {
      _throwFromTransportError('PUT', url, e);
    }
  }

  Future<ApiResponse<T>> patch<T>(
    String path, {
    Object? body,
    T Function(dynamic)? fromJson,
    bool requiresAuth = true,
  }) async {
    final url = _uri(path);
    final encoded = body != null ? jsonEncode(body) : null;
    _logRequest('PATCH', url, body: encoded);
    try {
      final response = await _client
          .patch(url,
              headers: await _headers(requiresAuth: requiresAuth),
              body: encoded)
          .timeout(_timeout);
      return _handleResponse<T>(response, fromJson: fromJson);
    } catch (e) {
      _throwFromTransportError('PATCH', url, e);
    }
  }

  Future<ApiResponse<T>> delete<T>(
    String path, {
    T Function(dynamic)? fromJson,
    bool requiresAuth = true,
  }) async {
    final url = _uri(path);
    _logRequest('DELETE', url);
    try {
      final response = await _client
          .delete(url, headers: await _headers(requiresAuth: requiresAuth))
          .timeout(_timeout);
      return _handleResponse<T>(response, fromJson: fromJson);
    } catch (e) {
      _throwFromTransportError('DELETE', url, e);
    }
  }

  Future<ApiResponse<T>> uploadFile<T>(
    String path, {
    required String filePath,
    required String fieldName,
    Map<String, String>? fields,
    T Function(dynamic)? fromJson,
  }) async {
    final url = _uri(path);
    _logRequest('UPLOAD', url, body: fields?.toString());
    try {
      final token = await _token;
      final request = http.MultipartRequest('POST', url);
      if (token != null) {
        request.headers['Authorization'] = 'Bearer $token';
      }
      request.files.add(await http.MultipartFile.fromPath(
        fieldName,
        filePath,
        contentType: _contentTypeFor(filePath),
      ));
      if (fields != null) request.fields.addAll(fields);

      // Route through the shared IOClient so the SSL-bypass HttpClient is used;
      // otherwise MultipartRequest.send() creates its own HttpClient and the
      // self-signed cert fails with CERTIFICATE_VERIFY_FAILED.
      final streamed = await _client.send(request).timeout(_timeout);
      final response =
          await http.Response.fromStream(streamed).timeout(_timeout);
      return _handleResponse<T>(response, fromJson: fromJson);
    } catch (e) {
      _throwFromTransportError('UPLOAD', url, e);
    }
  }

  /// Send a multipart request (POST or PUT) with optional text fields and
  /// optional file parts. Each entry in [files] maps a field name to a
  /// local file path; multiple files with distinct field names are supported.
  /// If [files] is null/empty, a text-only multipart request is sent.
  Future<ApiResponse<T>> sendMultipart<T>(
    String path, {
    String method = 'POST',
    Map<String, dynamic>? queryParams,
    Map<String, String>? fields,
    Map<String, String>? files,
    T Function(dynamic)? fromJson,
  }) async {
    final url = _uri(path, queryParams);
    _logRequest('MULTIPART $method', url, body: fields?.toString());
    try {
      final token = await _token;
      final request = http.MultipartRequest(method.toUpperCase(), url);
      if (token != null) {
        request.headers['Authorization'] = 'Bearer $token';
      }
      if (fields != null && fields.isNotEmpty) {
        request.fields.addAll(fields);
      }
      if (files != null) {
        for (final entry in files.entries) {
          if (entry.value.isEmpty) continue;
          request.files.add(await http.MultipartFile.fromPath(
            entry.key,
            entry.value,
            contentType: _contentTypeFor(entry.value),
          ));
        }
      }
      // Route through shared IOClient so SSL-bypass HttpClient is used.
      final streamed = await _client.send(request).timeout(_timeout);
      final response =
          await http.Response.fromStream(streamed).timeout(_timeout);
      return _handleResponse<T>(response, fromJson: fromJson);
    } catch (e) {
      _throwFromTransportError('MULTIPART $method', url, e);
    }
  }

  /// Resolves the MIME [MediaType] for a local file from its extension so the
  /// multipart part is not sent as application/octet-stream. The backend
  /// validates uploads by content-type (e.g. "Logo must be an image file"), so
  /// an octet-stream part is rejected. Returns null when the type is unknown,
  /// letting the http package fall back to its default.
  MediaType? _contentTypeFor(String filePath) {
    final mime = lookupMimeType(filePath);
    if (mime == null) return null;
    final parts = mime.split('/');
    if (parts.length != 2) return null;
    return MediaType(parts[0], parts[1]);
  }

  /// Parse the server body for a top-level message string (title/message/error).
  String? _extractBodyMessage(dynamic decoded) {
    if (decoded is! Map<String, dynamic>) return null;
    var msg = decoded['message'] as String? ??
        decoded['error'] as String? ??
        decoded['title'] as String?;
    // Customize specific error messages to be friendlier.
    if (msg == 'No rotarian found with this mobile/email.') {
      msg = 'No rotarian found with this mobile number';
    }
    return msg;
  }

  /// ASP.NET Core returns validation failures as:
  ///   { "errors": { "FieldName": ["msg1", "msg2"], ... }, "title": "..." }
  /// Pull that map out for [ValidationException.fieldErrors].
  Map<String, List<String>>? _extractFieldErrors(dynamic decoded) {
    if (decoded is! Map<String, dynamic>) return null;
    final errors = decoded['errors'];
    if (errors is! Map<String, dynamic>) return null;
    final out = <String, List<String>>{};
    errors.forEach((key, value) {
      if (value is List) {
        out[key] = value.map((e) => e.toString()).toList();
      } else if (value is String) {
        out[key] = [value];
      }
    });
    return out.isEmpty ? null : out;
  }

  /// Parse the `Retry-After` response header: either an integer number of
  /// seconds or an HTTP-date. Returns null when absent or unparseable.
  int? _parseRetryAfter(http.Response response) {
    final raw = response.headers['retry-after'];
    if (raw == null || raw.isEmpty) return null;
    final asInt = int.tryParse(raw.trim());
    if (asInt != null) return asInt >= 0 ? asInt : null;
    try {
      final when = HttpDate.parse(raw);
      final diff = when.difference(DateTime.now()).inSeconds;
      return diff > 0 ? diff : null;
    } catch (_) {
      return null;
    }
  }

  ApiResponse<T> _handleResponse<T>(
    http.Response response, {
    T Function(dynamic)? fromJson,
  }) {
    _logResponse(response);

    // Transparently store refreshed JWT when server rotates it (sliding window
    // — the backend re-issues a fresh 30-day token in the last 7 days). Also
    // adopt the new expiry so the client idle clock tracks the real token.
    final refreshedToken = response.headers['x-refreshed-token'];
    if (refreshedToken != null && refreshedToken.isNotEmpty) {
      _storage.write(key: AppConstants.tokenKey, value: refreshedToken);
      final refreshedExpiry =
          DateTime.tryParse(response.headers['x-refreshed-token-expires-at'] ?? '');
      if (refreshedExpiry != null) {
        _storage.write(
            key: AppConstants.sessionExpiryKey,
            value: refreshedExpiry.toIso8601String());
        onTokenRefreshed?.call(refreshedExpiry);
      }
    }

    final statusCode = response.statusCode;

    // Decode the body once; reuse for body-message extraction and validation
    // errors. Track decode failure separately so a 2xx with malformed body
    // surfaces as a FormatException (mapped to 'Invalid response format.' by
    // _throwFromTransportError) instead of silently calling fromJson(null).
    dynamic decoded;
    bool decodeFailed = false;
    if (response.body.isNotEmpty) {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decodeFailed = true;
      }
    }
    final bodyMessage = _extractBodyMessage(decoded);

    // ── Success ──────────────────────────────────────────────────────────
    if (statusCode >= 200 && statusCode < 300) {
      if (response.body.isEmpty || statusCode == 204) {
        return ApiResponse.success(null, statusCode: statusCode);
      }
      if (decodeFailed) {
        throw const FormatException('Server returned a non-JSON 2xx body.');
      }
      if (fromJson != null) {
        return ApiResponse.success(fromJson(decoded), statusCode: statusCode);
      }
      return ApiResponse.success(decoded as T, statusCode: statusCode);
    }

    // ── 4xx ──────────────────────────────────────────────────────────────
    if (statusCode == 401) {
      // A force-relogin is flagged via X-Force-Relogin: 1. Several producers
      // raise it for different reasons — an admin changed this member's mobile
      // (plain-text body, nothing to extract), or the member no longer has a
      // live club membership (JSON body carrying the real reason). Prefer the
      // server's message; the mobile-number wording is only the fallback for
      // the one producer that sends no readable body.
      final forced = response.headers['x-force-relogin'] == '1';
      final reason = forced
          ? (bodyMessage ??
              'Your mobile number was updated by an admin. Please log in again.')
          : null;
      async_lib.unawaited(_endSessionIfCurrent(
          response.request?.headers['Authorization'], reason));
      throw UnauthorizedException(
          reason ?? bodyMessage ?? 'Unauthorized. Please log in again.');
    }
    if (statusCode == 403) {
      throw ForbiddenException(bodyMessage ?? 'Access denied.');
    }
    if (statusCode == 404) {
      throw NotFoundException(bodyMessage ?? 'Resource not found.');
    }
    if (statusCode == 408) {
      throw const TimeoutException(
          'The server took too long to respond. Please try again.');
    }
    if (statusCode == 409) {
      throw ConflictException(
          bodyMessage ?? 'This conflicts with the current state.');
    }
    if (statusCode == 413) {
      throw PayloadTooLargeException(
          bodyMessage ?? 'File is too large. Please choose a smaller file.');
    }
    if (statusCode == 422) {
      final fieldErrors = _extractFieldErrors(decoded);
      final msg = bodyMessage ??
          (fieldErrors != null && fieldErrors.isNotEmpty
              ? fieldErrors.values.first.first
              : 'Please check your input and try again.');
      throw ValidationException(msg, fieldErrors: fieldErrors);
    }
    if (statusCode == 429) {
      throw TooManyRequestsException(
        message: bodyMessage ??
            'Too many requests. Please wait a moment and try again.',
        retryAfterSeconds: _parseRetryAfter(response),
      );
    }

    // ── 5xx ──────────────────────────────────────────────────────────────
    if (statusCode == 500) {
      throw ServerException(bodyMessage ??
          'Something went wrong on the server. Please try again.');
    }
    if (statusCode == 502) {
      throw BadGatewayException(
          bodyMessage ?? 'Server unreachable. Please try again.');
    }
    if (statusCode == 503) {
      throw ServiceUnavailableException(
        message: bodyMessage ??
            'The service is temporarily unavailable. Please try again shortly.',
        retryAfterSeconds: _parseRetryAfter(response),
      );
    }
    if (statusCode == 504) {
      throw GatewayTimeoutException(bodyMessage ??
          'The server took too long to respond. Please try again.');
    }
    if (statusCode >= 500) {
      throw ServerException(
          bodyMessage ?? 'Something went wrong. Please try again.');
    }

    // ── Anything else ────────────────────────────────────────────────────
    throw ApiException(bodyMessage ?? 'Something went wrong.',
        statusCode: statusCode);
  }
}
