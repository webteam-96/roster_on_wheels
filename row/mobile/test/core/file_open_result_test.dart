import 'package:flutter_test/flutter_test.dart';
import 'package:open_filex/open_filex.dart';
import 'package:rotary_flutter_app/core/utils/file_download_utils.dart';

void main() {
  test('an opened file gives no message', () {
    expect(openFailureMessage(ResultType.done), isNull);
  });

  test('no app to open the file says so', () {
    expect(openFailureMessage(ResultType.noAppToOpen),
        'No app on this phone can open this file.');
  });

  test('every other failure gives a message', () {
    for (final t in [
      ResultType.fileNotFound,
      ResultType.permissionDenied,
      ResultType.error,
    ]) {
      expect(openFailureMessage(t), isNotNull);
    }
  });

  test('the exception shows its message', () {
    expect(const FileOpenException('x').toString(), 'x');
  });
}
