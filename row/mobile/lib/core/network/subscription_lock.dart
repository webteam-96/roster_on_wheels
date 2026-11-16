import 'package:flutter/foundation.dart';

/// KIS/ROW/SUB/01 section 4.4: the member app works only for members of a club
/// with a Club subscription. The API answers 403 with this code when the
/// signed-in member has no such club; the API client raises it here and
/// `SubscriptionLockScreen` covers the app until the member signs out or the
/// club subscribes.
const String appSubscriptionRequiredCode = 'app_subscription_required';

/// The server's message while the app is locked, null otherwise.
final ValueNotifier<String?> subscriptionLock = ValueNotifier<String?>(null);
