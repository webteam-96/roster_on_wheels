import 'package:flutter/material.dart' hide Text;
import 'package:rotary_flutter_app/core/i18n/live_translator.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import '../../widgets/common/custom_app_bar.dart';

/// Languages offered in the app, each under its own name.
// shortcut: 30 widely used languages of the web's 110+ (admin/src/i18n/worldLanguages.ts); Flutter has no
// Intl.DisplayNames, so widen this list with a names table if members ask for others.
const appLanguages = <(String, String)>[
  ('en', 'English'), ('es', 'Español'), ('fr', 'Français'), ('de', 'Deutsch'), ('it', 'Italiano'),
  ('pt', 'Português'), ('nl', 'Nederlands'), ('sv', 'Svenska'), ('pl', 'Polski'), ('ro', 'Română'),
  ('el', 'Ελληνικά'), ('ru', 'Русский'), ('uk', 'Українська'), ('tr', 'Türkçe'), ('ar', 'العربية'),
  ('he', 'עברית'), ('fa', 'فارسی'), ('ur', 'اردو'), ('hi', 'हिन्दी'), ('bn', 'বাংলা'),
  ('ta', 'தமிழ்'), ('si', 'සිංහල'), ('ne', 'नेपाली'), ('zh', '中文'), ('ja', '日本語'),
  ('ko', '한국어'), ('id', 'Bahasa Indonesia'), ('vi', 'Tiếng Việt'), ('sw', 'Kiswahili'), ('am', 'አማርኛ'),
];

/// Settings > Language: the app's text in the member's language, translated by machine (N13).
class LanguageScreen extends StatelessWidget {
  const LanguageScreen({super.key, this.translator});
  final LiveTranslator? translator;

  @override
  Widget build(BuildContext context) {
    final t = translator ?? LiveTranslator.instance;
    return ListenableBuilder(
      listenable: t,
      builder: (context, _) => Scaffold(
        appBar: const CustomAppBar(title: 'Language'),
        body: ListView(
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text('The app is translated by machine. Names, club names and what members write stay as entered.'),
            ),
            for (final (code, name) in appLanguages)
              ListTile(
                // Language names are shown as written in that language, never translated.
                title: Directionality(textDirection: TextDirection.ltr, child: _Name(name)),
                trailing: t.language == code ? const Icon(Icons.check) : null,
                onTap: () => t.setLanguage(code),
              ),
          ],
        ),
      ),
    );
  }
}

/// A language's own name: Flutter's Text, so it is not sent for translation.
class _Name extends StatelessWidget {
  const _Name(this.name);
  final String name;

  @override
  Widget build(BuildContext context) => RichText(text: TextSpan(text: name, style: DefaultTextStyle.of(context).style));
}
