import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Business directory (`api/business-directory/me`, `api/districts/{id}/business-directory`): search the approved
/// businesses of the member's district, and add, edit or remove the member's own listing. A club or district admin
/// approves every new or edited listing before it shows (here, in the admin and on the club websites).
class BusinessDirectoryScreen extends StatefulWidget {
  const BusinessDirectoryScreen({super.key});

  @override
  State<BusinessDirectoryScreen> createState() => _BusinessDirectoryScreenState();
}

class _BusinessDirectoryScreenState extends State<BusinessDirectoryScreen> {
  final _api = ApiClient();
  final _q = TextEditingController();
  Map<String, dynamic>? _mine;
  List<Map<String, dynamic>>? _results;
  String? _error;

  List<Map<String, dynamic>> get _clubs => ((_mine?['clubs'] as List?) ?? const []).cast<Map<String, dynamic>>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await _api.get<Map<String, dynamic>>('/api/business-directory/me', fromJson: (j) => j as Map<String, dynamic>);
      if (!mounted) return;
      setState(() => _mine = res.data);
      await _search();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _search() async {
    if (_clubs.isEmpty) return;
    setState(() => _results = null);
    final q = _q.text.trim();
    try {
      final res = await _api.get<List<dynamic>>('/api/districts/${_clubs.first['districtId']}/business-directory',
          queryParams: q.isEmpty ? null : {'q': q}, fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _results = (res.data ?? const []).cast<Map<String, dynamic>>());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _edit() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ListingForm(api: _api, listing: _mine?['listing'] as Map<String, dynamic>?, clubs: _clubs),
    );
    if (saved == true) _load();
  }

  Future<void> _remove() async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Remove my listing', message: 'Your business will no longer show in the directory.');
    if (ok != true) return;
    try {
      await _api.delete<dynamic>('/api/business-directory/me');
      _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  static String _statusText(Map<String, dynamic> l) => switch (l['status']) {
        'approved' => 'Listed in the directory',
        'rejected' => 'Not approved${l['reviewNote'] != null ? ': ${l['reviewNote']}' : ''}',
        _ => 'Waiting for approval by your club or district',
      };

  @override
  Widget build(BuildContext context) {
    final mine = _mine;
    final listing = mine?['listing'] as Map<String, dynamic>?;
    final results = _results;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Business directory'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.error_outline, title: 'Could not load the directory', subtitle: _error!)
          : mine == null
              ? const LoadingWidget()
              : _clubs.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.storefront_outlined, title: 'No club yet', subtitle: 'The directory lists your district.')
                  : RowRefresh(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          Card(
                            child: ListTile(
                              leading: const Icon(Icons.storefront_outlined),
                              title: Text(listing == null ? 'List my business' : listing['businessName'] as String? ?? ''),
                              subtitle: Text(listing == null
                                  ? 'Members across the district and visitors to the club websites can find it.'
                                  : _statusText(listing)),
                              onTap: _edit,
                              trailing: listing == null
                                  ? const Icon(Icons.add)
                                  : IconButton(tooltip: 'Remove', icon: const Icon(Icons.delete_outline), onPressed: _remove),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _q,
                            textInputAction: TextInputAction.search,
                            onSubmitted: (_) => _search(),
                            maxLength: 100,
                            decoration: InputDecoration(
                              labelText: 'Search business, classification, member or club',
                              border: const OutlineInputBorder(),
                              suffixIcon: IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: _search),
                            ),
                          ),
                          if (results == null)
                            const SizedBox(height: 200, child: LoadingWidget())
                          else if (results.isEmpty)
                            const EmptyStateWidget(
                                icon: Icons.search_off, title: 'No businesses found', subtitle: 'Try a different search.')
                          else
                            for (final l in results) _ListingCard(l: l),
                        ],
                      ),
                    ),
    );
  }
}

class _ListingCard extends StatelessWidget {
  const _ListingCard({required this.l});
  final Map<String, dynamic> l;

  @override
  Widget build(BuildContext context) {
    final website = l['website'] as String?;
    final phone = l['phone'] as String?;
    final t = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l['businessName'] as String? ?? '', style: t.titleMedium),
            Text([l['classification'], l['memberName'], l['clubName']].whereType<String>().join(', '), style: t.bodySmall),
            if ((l['description'] as String?)?.isNotEmpty == true) ...[
              const SizedBox(height: 6),
              Text(l['description'] as String),
            ],
            Wrap(spacing: 8, children: [
              if (website != null && website.startsWith(RegExp('https?://')))
                TextButton.icon(
                  icon: const Icon(Icons.language, size: 18),
                  label: const Text('Website'),
                  onPressed: () => launchUrl(Uri.parse(website), mode: LaunchMode.externalApplication),
                ),
              if (phone != null && phone.isNotEmpty)
                TextButton.icon(
                  icon: const Icon(Icons.call_outlined, size: 18),
                  label: Text(phone),
                  onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^0-9+]'), ''))),
                ),
            ]),
          ],
        ),
      ),
    );
  }
}

class _ListingForm extends StatefulWidget {
  const _ListingForm({required this.api, required this.clubs, this.listing});
  final ApiClient api;
  final List<Map<String, dynamic>> clubs;
  final Map<String, dynamic>? listing;

  @override
  State<_ListingForm> createState() => _ListingFormState();
}

class _ListingFormState extends State<_ListingForm> {
  late final _name = TextEditingController(text: widget.listing?['businessName'] as String?);
  late final _classification = TextEditingController(text: widget.listing?['classification'] as String?);
  late final _description = TextEditingController(text: widget.listing?['description'] as String?);
  late final _website = TextEditingController(text: widget.listing?['website'] as String?);
  late final _phone = TextEditingController(text: widget.listing?['phone'] as String?);
  late int _clubId = (widget.listing?['clubId'] as int?) ?? widget.clubs.first['clubId'] as int;
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_name, _classification, _description, _website, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      SnackbarUtils.showError(context, 'Enter the business name.');
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.put<dynamic>('/api/business-directory/me', body: {
        'clubId': _clubId,
        'businessName': _name.text.trim(),
        'classification': _classification.text.trim(),
        'description': _description.text.trim(),
        'website': _website.text.trim(),
        'phone': _phone.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration d(String label, [String? hint]) =>
        InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder());
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.listing == null ? 'List my business' : 'Edit my listing', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            const Text('Shown to members of the district and on the club websites once your club or district approves it. '
                'Every change is approved again.'),
            const SizedBox(height: 12),
            if (widget.clubs.length > 1) ...[
              DropdownButtonFormField<int>(
                initialValue: _clubId,
                decoration: d('Club'),
                items: [
                  for (final c in widget.clubs)
                    DropdownMenuItem(value: c['clubId'] as int, child: Text(c['clubName'] as String? ?? '')),
                ],
                onChanged: (v) => setState(() => _clubId = v ?? _clubId),
              ),
              const SizedBox(height: 12),
            ],
            TextField(controller: _name, decoration: d('Business name'), maxLength: 200),
            TextField(controller: _classification, decoration: d('Classification', 'For example: Tea export'), maxLength: 150),
            TextField(controller: _description, decoration: d('Description'), maxLines: 3, maxLength: 2000),
            TextField(
                controller: _website,
                decoration: d('Website', 'https://'),
                keyboardType: TextInputType.url,
                maxLength: 300),
            TextField(controller: _phone, decoration: d('Business phone'), keyboardType: TextInputType.phone, maxLength: 40),
            FilledButton(onPressed: _saving ? null : _save, child: const Text('Save and send for approval')),
          ],
        ),
      ),
    );
  }
}
