# ROW mobile app (Flutter)

The ROW app, converted from the RIZones app: it talks to the ROW API (NestJS, `row/api`) and takes its
name, logos, support contacts and links from the instance brand (`GET api/public/brand`, cached on the device).

## Build and run

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=https://api.example.org      # the ROW API root, no trailing slash
```

- Without `API_BASE_URL` the app uses `http://localhost:5000` (a local `row/api`; from an Android emulator use `http://10.0.2.2:5000`).
- **Firebase** (push notifications, analytics): each instance supplies its own `android/app/google-services.json` and
  `ios/Runner/GoogleService-Info.plist` (gitignored). Android builds need the JSON file (the Google Services Gradle
  plugin requires it); without the files on iOS the app runs with push off.
- App ids: Android `com.SampleApp.row`, iOS `com.kaizen.row`. Launcher icon: a placeholder until the ROW icon exists
  (`assets/images/row-app-icon.png`, then `dart run flutter_launcher_icons`).

## Checks

```bash
flutter analyze
flutter test
```

See `row/STATUS.md` (section 6) for what is converted and what is pending.
