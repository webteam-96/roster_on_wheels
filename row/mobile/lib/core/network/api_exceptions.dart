/// The one user-facing wording for "the request never left the device".
/// Every transport failure (no signal, airplane mode, DNS, TLS, dropped
/// socket) funnels into this so the UI never shows platform error text.
const String kOfflineMessage =
    'You appear to be offline. Please check your internet connection and try again.';

/// True when a server message is the zone/district/club kill-switch response
/// ("This club, its district, or its zone is inactive. Reactivate it first…").
/// The backend now returns this as a 403 on ~170 data endpoints, so a logged-in
/// user whose chain is deactivated mid-session hits it on reads/writes — it is
/// NOT an auth failure and retrying won't help until the chain is reactivated.
bool isInactiveChainMessage(String? message) {
  if (message == null) return false;
  final m = message.toLowerCase();
  return (m.contains('inactive') &&
          (m.contains('zone') || m.contains('district') || m.contains('club'))) ||
      m.contains('reactivate it first');
}

class ApiException implements Exception {
  final String message;
  final int? statusCode;

  const ApiException(this.message, {this.statusCode});

  /// True for the kill-switch 403 (zone/district/club inactive). Screens can use
  /// this to show a neutral "inactive" state instead of a retryable error.
  bool get isInactiveChain =>
      statusCode == 403 && isInactiveChainMessage(message);

  /// Clean, user-facing message. Previously included the class name and
  /// status code which leaked into snackbars ("ApiException(500): ...").
  @override
  String toString() => message;
}

class UnauthorizedException extends ApiException {
  const UnauthorizedException([String message = 'Unauthorized. Please log in again.'])
      : super(message, statusCode: 401);
}

class ForbiddenException extends ApiException {
  const ForbiddenException([String message = 'Access denied.'])
      : super(message, statusCode: 403);
}

class NotFoundException extends ApiException {
  const NotFoundException([String message = 'Resource not found.'])
      : super(message, statusCode: 404);
}

class ConflictException extends ApiException {
  const ConflictException([String message = 'This conflicts with the current state.'])
      : super(message, statusCode: 409);
}

class PayloadTooLargeException extends ApiException {
  const PayloadTooLargeException([String message = 'File is too large. Please choose a smaller file.'])
      : super(message, statusCode: 413);
}

class ValidationException extends ApiException {
  final Map<String, List<String>>? fieldErrors;

  const ValidationException(String message, {this.fieldErrors})
      : super(message, statusCode: 422);
}

class TooManyRequestsException extends ApiException {
  /// Seconds the server asked the client to wait before retrying.
  /// Parsed from the `Retry-After` response header (integer seconds or
  /// HTTP-date). Null when absent or unparseable.
  final int? retryAfterSeconds;

  const TooManyRequestsException({
    String message = 'Too many requests. Please wait a moment and try again.',
    this.retryAfterSeconds,
  }) : super(message, statusCode: 429);
}

class ServerException extends ApiException {
  const ServerException([String message = 'Something went wrong on the server. Please try again.'])
      : super(message, statusCode: 500);
}

class BadGatewayException extends ApiException {
  const BadGatewayException([String message = 'Server unreachable. Please try again.'])
      : super(message, statusCode: 502);
}

class ServiceUnavailableException extends ApiException {
  /// Seconds the server asked the client to wait before retrying.
  final int? retryAfterSeconds;

  const ServiceUnavailableException({
    String message = 'The service is temporarily unavailable. Please try again shortly.',
    this.retryAfterSeconds,
  }) : super(message, statusCode: 503);
}

class GatewayTimeoutException extends ApiException {
  const GatewayTimeoutException(
      [String message = 'The server took too long to respond. Please try again.'])
      : super(message, statusCode: 504);
}

class NetworkException extends ApiException {
  const NetworkException([String message = kOfflineMessage]) : super(message);
}

/// Thrown when a request exceeds the configured client-side timeout.
/// Distinct from `dart:async`'s `TimeoutException` — this is the
/// user-facing form.
class TimeoutException extends ApiException {
  const TimeoutException(
      [String message = 'Request timed out. Please check your connection and try again.'])
      : super(message);
}


/// Sanitises anything caught in a `catch (e)` into text that is safe to put on
/// screen. Our own [ApiException]s are already user-facing and pass through;
/// raw platform/Dart errors (which carry class names, error codes and request
/// URIs) are replaced with a plain-English equivalent.
String friendlyErrorMessage(Object? error, {String? fallback}) {
  if (error == null) return fallback ?? 'Something went wrong. Please try again.';
  if (error is ApiException) return error.message;
  final raw = error.toString();
  final low = raw.toLowerCase();
  if (low.contains('nsurlerrordomain') ||
      low.contains('connection appears to be offline') ||
      low.contains('socketexception') ||
      low.contains('clientexception') ||
      low.contains('failed host lookup') ||
      low.contains('network is unreachable') ||
      low.contains('handshakeexception') ||
      low.contains('connection refused') ||
      low.contains('connection closed')) {
    return kOfflineMessage;
  }
  if (low.contains('timeout')) {
    return 'Request timed out. Please check your connection and try again.';
  }
  // Never surface a Dart exception/stack-ish string.
  if (raw.contains('Exception') || raw.contains('Error') || raw.contains('#0')) {
    return fallback ?? 'Something went wrong. Please try again.';
  }
  return raw;
}

/// True when [message] is the offline wording, so screens can swap in a
/// "no connection" icon/title instead of the generic error look.
bool isOfflineMessage(String? message) {
  if (message == null) return false;
  final m = message.toLowerCase();
  return m.contains('offline') ||
      m.contains('no internet') ||
      m.contains('internet connection');
}
