import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rotary_flutter_app/presentation/providers/auth_provider.dart';
import 'package:rotary_flutter_app/presentation/screens/login/login_screen.dart';

// The sign-in screen on a 360 dp wide phone (2026-11-20: the "sign-in code" link wrapped to two ragged lines).
void main() {
  testWidgets('sign-in actions fit a 360 dp phone: one-line buttons, centred note, no overflow', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    tester.view.physicalSize = const Size(720, 1640);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(ChangeNotifierProvider(
      create: (_) => AuthProvider(),
      child: const MaterialApp(home: LoginScreen()),
    ));
    await tester.pump(const Duration(milliseconds: 500));

    // Button labels stay on one line (the test font draws every glyph a full square, wider than any real font).
    for (final text in ['Forgot password?', 'Sign In', 'Email me a code']) {
      final paragraph = tester.renderObject<RenderParagraph>(find.text(text).last);
      // One line: the caret after the last character is still on the first line.
      final end = paragraph.getOffsetForCaret(TextPosition(offset: text.length), Rect.zero);
      expect(end.dy, 0, reason: '"$text" wraps');
    }
    // The note may wrap in a long language: then it wraps centred, never ragged.
    final note = tester.widget<Text>(find.text('New here? Tap "Forgot password?" to set one.'));
    expect(note.textAlign, TextAlign.center);
    expect(tester.takeException(), isNull); // no overflow
  });
}
