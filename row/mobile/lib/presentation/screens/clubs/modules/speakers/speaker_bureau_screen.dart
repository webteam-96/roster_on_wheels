import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// The district speaker bureau for a club (feature `volunteers`, `api/clubs/{id}/speaker-bureau`). Members find
/// speakers by topic and how they talk, and read their ratings and contact. Club managers book a speaker for a meeting,
/// rate the talk afterwards and cancel a booking (the API refuses others and says why).
class SpeakerBureauScreen extends StatefulWidget {
  const SpeakerBureauScreen({super.key, required this.clubId});
  final int clubId;

  @override
  State<SpeakerBureauScreen> createState() => _SpeakerBureauScreenState();
}

String _ratingText(Map<String, dynamic> e) {
  final avg = (e['averageRating'] as num?)?.toDouble();
  final count = e['ratingCount'] as int? ?? 0;
  if (avg == null || count == 0) return 'Not rated yet';
  return '${avg.toStringAsFixed(1)} of 5 ($count)';
}

String _tags(Object? s) =>
    (s as String? ?? '').split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).join(', ');

class _SpeakerBureauScreenState extends State<SpeakerBureauScreen> {
  final _api = ApiClient();
  final _topic = TextEditingController();
  String _mode = '';
  List<Map<String, dynamic>>? _speakers;
  List<Map<String, dynamic>>? _bookings;
  String? _error;

  String get _base => '/api/clubs/${widget.clubId}/speaker-bureau';

  @override
  void initState() {
    super.initState();
    _load();
    _loadBookings();
  }

  @override
  void dispose() {
    _topic.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _speakers = null;
      _error = null;
    });
    try {
      final res = await _api.get<List<dynamic>>(_base,
          queryParams: {
            if (_topic.text.trim().isNotEmpty) 'topic': _topic.text.trim(),
            if (_mode.isNotEmpty) 'mode': _mode,
          },
          fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _speakers = (res.data ?? const []).cast<Map<String, dynamic>>());
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _speakers = const [];
          _error = e.message;
        });
      }
    }
  }

  Future<void> _loadBookings() async {
    try {
      final res = await _api.get<List<dynamic>>('$_base/bookings', fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _bookings = (res.data ?? const []).cast<Map<String, dynamic>>());
    } catch (_) {
      if (mounted) setState(() => _bookings = const []);
    }
  }

  Future<void> _refresh() async {
    await Future.wait([_load(), _loadBookings()]);
  }

  Future<void> _book(Map<String, dynamic> e) async {
    final now = DateTime.now();
    final date = await showDatePicker(
        context: context,
        helpText: 'Meeting date',
        initialDate: now,
        firstDate: DateTime(now.year - 1, now.month, now.day),
        lastDate: DateTime(now.year + 2, now.month, now.day));
    if (date == null) return;
    try {
      await _api.post<dynamic>('$_base/${e['id']}/bookings', body: {'talkDate': DateFormatter.toApiFormat(date)});
      if (mounted) SnackbarUtils.showSuccess(context, '${e['name']} is booked and added to your club\'s speakers.');
      _refresh();
    } on ApiException catch (err) {
      if (mounted) SnackbarUtils.showError(context, err.message);
    }
  }

  Future<void> _cancel(Map<String, dynamic> b) async {
    final ok = await ConfirmationDialog.show(context,
        title: 'Cancel booking', message: 'Cancel the booking of ${b['name']}?');
    if (ok != true) return;
    try {
      await _api.delete<dynamic>('$_base/bookings/${b['id']}');
      _refresh();
    } on ApiException catch (err) {
      if (mounted) SnackbarUtils.showError(context, err.message);
    }
  }

  Future<void> _rate(Map<String, dynamic> b) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _RateSheet(api: _api, base: _base, booking: b),
    );
    if (saved == true) _refresh();
  }

  Future<void> _profile(Map<String, dynamic> e) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ProfileSheet(api: _api, base: _base, id: e['id'] as int, onBook: () => _book(e)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: const CustomAppBar(title: 'Speaker bureau'),
        body: Column(
          children: [
            const TabBar(tabs: [Tab(child: Text('Find a speaker')), Tab(child: Text('Our bookings'))]),
            Expanded(child: TabBarView(children: [_findTab(), _bookingsTab()])),
          ],
        ),
      ),
    );
  }

  Widget _findTab() {
    final speakers = _speakers;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            controller: _topic,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _load(),
            decoration: InputDecoration(
              labelText: 'Topic',
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: _load),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(spacing: 8, children: [
            for (final m in const [('', 'Any'), ('online', 'Online'), ('in_person', 'In person')])
              ChoiceChip(
                label: Text(m.$2),
                selected: _mode == m.$1,
                onSelected: (_) {
                  setState(() => _mode = m.$1);
                  _load();
                },
              ),
          ]),
        ),
        Expanded(
          child: speakers == null
              ? const LoadingWidget()
              : speakers.isEmpty
                  ? EmptyStateWidget(
                      icon: Icons.record_voice_over_outlined,
                      title: _error == null ? 'No speakers found' : 'Could not load the bureau',
                      subtitle: _error ?? 'Try another topic, or ask your district to add speakers.')
                  : RefreshIndicator(
                      onRefresh: _refresh,
                      child: ListView.separated(
                        padding: const EdgeInsets.only(bottom: 24),
                        itemCount: speakers.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, i) {
                          final e = speakers[i];
                          return ListTile(
                            title: Text(e['name'] as String? ?? ''),
                            subtitle: Text([_tags(e['topics']), _ratingText(e)].where((t) => t.isNotEmpty).join('  ·  ')),
                            onTap: () => _profile(e),
                            trailing: TextButton(onPressed: () => _book(e), child: const Text('Book')),
                          );
                        },
                      ),
                    ),
        ),
      ],
    );
  }

  Widget _bookingsTab() {
    final bookings = _bookings;
    if (bookings == null) return const LoadingWidget();
    if (bookings.isEmpty) {
      return const EmptyStateWidget(
          icon: Icons.event_available_outlined,
          title: 'No bookings yet',
          subtitle: 'Find a speaker and book them for a meeting.');
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.separated(
        padding: const EdgeInsets.only(bottom: 24),
        itemCount: bookings.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          final b = bookings[i];
          final rating = b['rating'] as int?;
          return ListTile(
            title: Text(b['name'] as String? ?? ''),
            subtitle: Text([
              DateFormatter.toDisplay(DateTime.tryParse(b['talkDate']?.toString() ?? '')),
              rating != null ? 'Rated $rating of 5' : (b['canRate'] == true ? 'Not rated yet' : 'Coming'),
            ].join('  ·  ')),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              if (b['canRate'] == true) TextButton(onPressed: () => _rate(b), child: const Text('Rate')),
              if (rating == null)
                IconButton(tooltip: 'Cancel booking', icon: const Icon(Icons.event_busy_outlined), onPressed: () => _cancel(b)),
            ]),
          );
        },
      ),
    );
  }
}

class _ProfileSheet extends StatefulWidget {
  const _ProfileSheet({required this.api, required this.base, required this.id, required this.onBook});
  final ApiClient api;
  final String base;
  final int id;
  final VoidCallback onBook;

  @override
  State<_ProfileSheet> createState() => _ProfileSheetState();
}

class _ProfileSheetState extends State<_ProfileSheet> {
  Map<String, dynamic>? _profile;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.api
        .get<Map<String, dynamic>>('${widget.base}/${widget.id}', fromJson: (j) => j as Map<String, dynamic>)
        .then((r) {
      if (mounted) setState(() => _profile = r.data);
    }).catchError((Object e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not load the speaker.');
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    if (_error != null) return Padding(padding: const EdgeInsets.all(24), child: Text(_error!));
    if (p == null) return const SizedBox(height: 240, child: LoadingWidget());
    final e = p['entry'] as Map<String, dynamic>;
    final ratings = (p['ratings'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
    final theme = Theme.of(context).textTheme;
    final how = [if (e['availableInPerson'] == true) 'In person', if (e['availableOnline'] == true) 'Online'].join(', ');
    Widget row(String label, String? value) => value == null || value.isEmpty
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text('$label: $value', style: theme.bodyMedium),
          );
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      builder: (_, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.all(16),
        children: [
          Text(e['name'] as String? ?? '', style: theme.titleLarge),
          const SizedBox(height: 4),
          Text(_ratingText(e), style: theme.bodyMedium),
          const SizedBox(height: 12),
          if ((e['bio'] as String?)?.isNotEmpty == true) ...[Text(e['bio'] as String), const SizedBox(height: 12)],
          row('Topics', _tags(e['topics'])),
          row('Languages', _tags(e['languages'])),
          row('Area', e['city'] as String?),
          row('Talks', how),
          row('Email', e['email'] as String?),
          row('Phone', e['phone'] as String?),
          const SizedBox(height: 8),
          FilledButton(
              onPressed: () {
                Navigator.pop(context);
                widget.onBook();
              },
              child: const Text('Book for a meeting')),
          const SizedBox(height: 16),
          Text('Ratings from clubs', style: theme.titleMedium),
          if (ratings.isEmpty) const Padding(padding: EdgeInsets.only(top: 8), child: Text('No club has rated this speaker yet.')),
          for (final r in ratings)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('${r['rating']} of 5  ·  ${r['clubName'] ?? ''}'),
              subtitle: (r['comment'] as String?)?.isNotEmpty == true ? Text(r['comment'] as String) : null,
              trailing: Text(DateFormatter.toDisplay(DateTime.tryParse(r['talkDate']?.toString() ?? ''))),
            ),
        ],
      ),
    );
  }
}

class _RateSheet extends StatefulWidget {
  const _RateSheet({required this.api, required this.base, required this.booking});
  final ApiClient api;
  final String base;
  final Map<String, dynamic> booking;

  @override
  State<_RateSheet> createState() => _RateSheetState();
}

class _RateSheetState extends State<_RateSheet> {
  final _comment = TextEditingController();
  int _score = 0;
  bool _saving = false;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_score == 0) {
      SnackbarUtils.showError(context, 'Choose a rating from 1 to 5.');
      return;
    }
    setState(() => _saving = true);
    final b = widget.booking;
    try {
      await widget.api.post<dynamic>('${widget.base}/${b['entryId']}/ratings', body: {
        'talkDate': b['talkDate'].toString().substring(0, 10),
        'rating': _score,
        'comment': _comment.text.trim(),
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
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Rate ${widget.booking['name']}', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 1; i <= 5; i++)
                IconButton(
                  tooltip: '$i of 5',
                  iconSize: 36,
                  icon: Icon(i <= _score ? Icons.star : Icons.star_border),
                  onPressed: () => setState(() => _score = i),
                ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _comment,
            maxLength: 500,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Comment for other clubs (optional)', border: OutlineInputBorder()),
          ),
          FilledButton(onPressed: _saving ? null : _save, child: const Text('Save rating')),
        ],
      ),
    );
  }
}
