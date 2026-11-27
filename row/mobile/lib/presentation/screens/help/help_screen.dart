import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter_html/flutter_html.dart';
import 'package:go_router/go_router.dart';
import '../../../core/i18n/live_translator.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Help centre (api/public/help): published articles by category, search, and the article with
/// "Was this helpful?" and related articles. Article text comes translated into the app language by the API.
class HelpScreen extends StatefulWidget {
  const HelpScreen({super.key});

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  final _api = ApiClient();
  final _search = TextEditingController();
  Timer? _debounce;
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final q = _search.text.trim();
      _data = (await _api.get<Map<String, dynamic>>('/api/public/help',
              queryParams: {'lang': LiveTranslator.instance.language, if (q.isNotEmpty) 'q': q},
              requiresAuth: false,
              fromJson: (j) => j as Map<String, dynamic>))
          .data;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (_) {
      _error = 'Could not load the help centre.';
    }
    if (mounted) setState(() => _loading = false);
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _load);
  }

  @override
  Widget build(BuildContext context) {
    final articles = ((_data?['articles'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final categories = ((_data?['categories'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final searching = _search.text.trim().isNotEmpty;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Help'),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _search,
              onChanged: _onSearch,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _load(),
              maxLength: 200,
              decoration: InputDecoration(
                hintText: LiveTranslator.instance.lookup('Search help articles'),
                prefixIcon: const Icon(Icons.search_rounded),
                counterText: '',
                border: const OutlineInputBorder(),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 6, itemHeight: 64)
                : _error != null
                    ? EmptyStateWidget(
                        title: 'Could not load help',
                        subtitle: _error,
                        icon: Icons.cloud_off_rounded,
                        actionLabel: 'Try again',
                        actionIcon: Icons.refresh_rounded,
                        onAction: _load,
                      )
                    : articles.isEmpty
                        ? EmptyStateWidget(
                            title: searching ? 'No articles match' : 'No help articles yet',
                            subtitle: searching ? 'Try other words.' : null,
                            icon: Icons.menu_book_outlined,
                          )
                        : RowRefresh(
                            onRefresh: _load,
                            child: ListView(
                              padding: const EdgeInsets.only(bottom: 24),
                              children: searching
                                  ? [for (final a in articles) _ArticleTile(a)]
                                  : [
                                      for (final c in categories) ...[
                                        Padding(
                                          padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
                                          child: Text(c['name'] as String? ?? '', style: AppTextStyles.h4),
                                        ),
                                        for (final a in articles.where((a) => a['categorySlug'] == c['slug'])) _ArticleTile(a),
                                      ],
                                    ],
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

class _ArticleTile extends StatelessWidget {
  const _ArticleTile(this.a);
  final Map<String, dynamic> a;

  @override
  Widget build(BuildContext context) {
    final summary = a['summary'] as String?;
    return ListTile(
      // Titles come translated from the API: plain Text, not the UI-string translator.
      title: Text.rich(TextSpan(text: a['title'] as String? ?? '')),
      subtitle: summary == null ? null : Text.rich(TextSpan(text: summary), maxLines: 2, overflow: TextOverflow.ellipsis),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: () => context.push('/help/${a['slug']}'),
    );
  }
}

class HelpArticleScreen extends StatefulWidget {
  const HelpArticleScreen({super.key, required this.slug});
  final String slug;

  @override
  State<HelpArticleScreen> createState() => _HelpArticleScreenState();
}

class _HelpArticleScreenState extends State<HelpArticleScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _article;
  String? _error;
  bool _loading = true;
  bool? _rated;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _article = (await _api.get<Map<String, dynamic>>('/api/public/help/articles/${Uri.encodeComponent(widget.slug)}',
              queryParams: {'lang': LiveTranslator.instance.language},
              requiresAuth: false,
              fromJson: (j) => j as Map<String, dynamic>))
          .data;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (_) {
      _error = 'Could not load the article.';
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _rate(bool helpful) async {
    setState(() => _sending = true);
    try {
      await _api.post<Map<String, dynamic>>('/api/public/help/articles/${Uri.encodeComponent(widget.slug)}/feedback',
          body: {'helpful': helpful}, requiresAuth: false, fromJson: (j) => j as Map<String, dynamic>);
      _rated = helpful;
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
    if (mounted) setState(() => _sending = false);
  }

  @override
  Widget build(BuildContext context) {
    final a = _article;
    final related = ((a?['related'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: const CustomAppBar(title: 'Help'),
      body: _loading
          ? const ShimmerList(itemCount: 4, itemHeight: 96)
          : _error != null || a == null
              ? EmptyStateWidget(
                  title: 'Could not load the article',
                  subtitle: _error,
                  icon: Icons.cloud_off_rounded,
                  actionLabel: 'Try again',
                  actionIcon: Icons.refresh_rounded,
                  onAction: _load,
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                  children: [
                    Text.rich(TextSpan(text: a['title'] as String? ?? ''), style: AppTextStyles.h3),
                    if (a['summary'] != null) ...[
                      const SizedBox(height: 8),
                      Text.rich(TextSpan(text: a['summary'] as String), style: AppTextStyles.bodyMedium.copyWith(color: AppColors.textSecondary)),
                    ],
                    // Sanitized by the API on save and after translation.
                    Html(data: a['body'] as String? ?? ''),
                    const Divider(height: 32),
                    if (_rated != null)
                      const Text('Thank you. Your answer helps us improve this article.')
                    else ...[
                      const Text('Was this article helpful?'),
                      const SizedBox(height: 8),
                      Row(children: [
                        FilledButton(onPressed: _sending ? null : () => _rate(true), child: const Text('Yes')),
                        const SizedBox(width: 12),
                        OutlinedButton(onPressed: _sending ? null : () => _rate(false), child: const Text('No')),
                      ]),
                    ],
                    if (related.isNotEmpty) ...[
                      const SizedBox(height: 24),
                      Text('Related articles', style: AppTextStyles.h4),
                      for (final r in related)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text.rich(TextSpan(text: r['title'] as String? ?? '')),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () => context.push('/help/${r['slug']}'),
                        ),
                    ],
                  ],
                ),
    );
  }
}
