# App language switch through the translation API (Phase 3b, N13) — plan 2026-10-26

Status: draft for the owner's approval.

## Goal

A member picks a language in the app and the app's text shows in that language, translated by the same machine
translation the web uses (owner decision 2026-10-22: no hand-written translation files).

## What exists

- Web: `admin/src/i18n/LiveTranslate.tsx` walks the page and sends text to the admin route `POST /api/i18n/translate`
  (`{ target, source, q: [...] } -> { translations: [...] }`). The provider is set on the server (`TRANSLATE_PROVIDER`:
  mymemory, libretranslate, google, deepl). The route caches, rate-limits per IP, and gives signed-in callers (a
  token the API accepts at `GET api/auth/session`) the full limit.
- App: about 3,950 `Text(` widgets in 386 files, no language switch. `Brand.current.adminOrigin` already holds the
  admin web address.

## Design

1. **No new server code.** The app calls the admin route with its own sign-in token. It is the same provider, cache
   and limits as the web.
2. **`LiveTranslator`** (`lib/core/i18n/live_translator.dart`, a ChangeNotifier): the chosen language, a cache per
   language saved on the device, `lookup(text)` that answers at once from the cache (or the English text) and queues
   misses. Misses are sent in batches (one request every 300 ms, up to 300 strings) and the screen redraws when they
   arrive. Failures leave English and retry on the next start. English, or no language chosen, means no calls at all.
3. **A drop-in `Text`.** `lib/core/i18n/text.dart` has the same constructors as Flutter's `Text`, `const` included, so
   existing code compiles unchanged. Its build asks `LiveTranslator` for the string. `Text.rich` passes through
   untranslated. A script changes each file's import to `import 'package:flutter/material.dart' hide Text;` plus the
   new widget: one import line per file, no change to the 3,950 call sites.
4. **Picker.** Settings > Preferences > Language: the same language list as the web's switch, saved on the device.
   Members' names, club names and other data stay as entered. Numbers and dates already follow the device locale (N12).
5. **Not translated (known limit).** Text that Flutter draws inside its own widgets without `Text` (tab labels given
   as `Tab(text:)`, form field labels and hints, tooltips) stays English. Upgrade later by passing those through
   `lookup` where it matters.

## Steps

| Step | Work | Check |
|---|---|---|
| 1 | `LiveTranslator` + cache + batching | unit test: batches, caches, falls back to English on error |
| 2 | Drop-in `Text`, import script over `lib/` | `flutter analyze` 0 errors, all tests pass |
| 3 | Language picker, saved choice, applied at start | widget test: picking a language shows translated text from a fake |
| 4 | Emulator run against the local API and admin | screenshots in two languages |

Size: about one working day.

## Questions for the owner

1. Is the app allowed to call the admin web address for translation? It needs no new server code. The other option is
   a copy of the translate route inside the .NET API: the same result, more code.
2. Production needs a real provider key (DeepL or self-hosted LibreTranslate); MyMemory's free limit is small. Which
   provider?
