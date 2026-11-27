import 'package:flutter/material.dart' hide Text;
import 'package:flutter_html/flutter_html.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Archive of the club's sent email bulletins (gap #6, `api/clubs/{id}/bulletins`). Members of the club read past
/// issues here; managers build and send them on the web admin. Drafts are not listed.
class ClubBulletinsScreen extends StatefulWidget {
  const ClubBulletinsScreen({super.key, required this.clubId, this.embedded = false});
  final int clubId;
  final bool embedded;

  @override
  State<ClubBulletinsScreen> createState() => _ClubBulletinsScreenState();
}

class _ClubBulletinsScreenState extends State<ClubBulletinsScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _items;
  String? _error;

  String get _base => '/api/clubs/${widget.clubId}/bulletins';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await _api.get<List<dynamic>>(_base, fromJson: (j) => j as List<dynamic>);
      final all = (res.data ?? const []).cast<Map<String, dynamic>>();
      if (mounted) setState(() => _items = all.where((b) => b['status'] == 'Sent').toList());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'The bulletins could not be loaded.');
    }
  }

  Widget _body() {
    final items = _items;
    if (_error != null && items == null) {
      return EmptyStateWidget(
        icon: Icons.error_outline,
        title: 'Could not load bulletins',
        subtitle: _error,
        actionLabel: 'Try again',
        onAction: _load,
      );
    }
    if (items == null) return const LoadingWidget();
    if (items.isEmpty) {
      return const EmptyStateWidget(
          icon: Icons.mark_email_read_outlined,
          title: 'No bulletins yet',
          subtitle: 'Bulletins the club sends by email appear here.');
    }
    return RowRefresh(
      onRefresh: _load,
      child: RowListView.separated(
        padding: const EdgeInsets.only(bottom: 24),
        itemCount: items.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          final b = items[i];
          return ListTile(
            leading: const Icon(Icons.mark_email_read_outlined),
            title: Text(b['title'] as String? ?? ''),
            subtitle: Text(DateFormatter.toDisplay(DateTime.tryParse(b['sentDate']?.toString() ?? ''))),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => _BulletinReader(api: _api, path: '$_base/${b['id']}', title: b['title'] as String? ?? ''))),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.embedded) return _body();
    return Scaffold(appBar: const CustomAppBar(title: 'Bulletins'), body: _body());
  }
}

/// One sent bulletin, as members received it (the archived HTML, sanitised by the API when it was composed).
class _BulletinReader extends StatefulWidget {
  const _BulletinReader({required this.api, required this.path, required this.title});
  final ApiClient api;
  final String path;
  final String title;

  @override
  State<_BulletinReader> createState() => _BulletinReaderState();
}

class _BulletinReaderState extends State<_BulletinReader> {
  String? _html;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await widget.api.get<Map<String, dynamic>>(widget.path, fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _html = res.data?['html'] as String? ?? '');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'The bulletin could not be loaded.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final html = _html;
    return Scaffold(
      appBar: CustomAppBar(title: widget.title),
      body: _error != null
          ? EmptyStateWidget(
              icon: Icons.error_outline,
              title: 'Could not load the bulletin',
              subtitle: _error,
              actionLabel: 'Try again',
              onAction: _load)
          : html == null
              ? const LoadingWidget()
              : SingleChildScrollView(padding: const EdgeInsets.all(12), child: Html(data: html)),
    );
  }
}
