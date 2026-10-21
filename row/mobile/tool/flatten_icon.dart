// One-off helper: flatten the transparent app-icon PNG onto a solid white
// background so both iOS and Android icons get a clean white field instead of
// transparency. Run with: dart run tool/flatten_icon.dart
import 'dart:io';
import 'package:image/image.dart' as img;

void main() {
  const src = 'assets/images/rotary-zone-45678-app-icon.png';
  const out = 'assets/images/rotary-zone-45678-app-icon-white.png';

  final bytes = File(src).readAsBytesSync();
  final decoded = img.decodePng(bytes);
  if (decoded == null) {
    stderr.writeln('Could not decode $src');
    exit(1);
  }

  // Solid white canvas, then composite the (possibly transparent) logo on top.
  final canvas = img.Image(width: decoded.width, height: decoded.height);
  img.fill(canvas, color: img.ColorRgb8(255, 255, 255));
  img.compositeImage(canvas, decoded);

  File(out).writeAsBytesSync(img.encodePng(canvas));
  stdout.writeln('Wrote $out (${canvas.width}x${canvas.height}, white bg)');
}
