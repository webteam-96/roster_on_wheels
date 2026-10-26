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

/// The club's meeting speakers (N4, feature `volunteers`, `api/clubs/{id}/speakers`): add, edit, remove.
/// Club managers only (the API refuses others). Speaker photos are uploaded on the web.
class ClubSpeakersScreen extends StatefulWidget {
  const ClubSpeakersScreen({super.key, required this.clubId});
  final int clubId;

  @override
  State<ClubSpeakersScreen> createState() => _ClubSpeakersScreenState();
}

class _ClubSpeakersScreenState extends State<ClubSpeakersScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _speakers;

  String get _base => '/api/clubs/${widget.clubId}/speakers';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.get<List<dynamic>>(_base, fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _speakers = (res.data ?? const []).cast<Map<String, dynamic>>());
    } catch (_) {
      if (mounted) setState(() => _speakers = const []);
    }
  }

  Future<void> _edit([Map<String, dynamic>? s]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _SpeakerForm(base: _base, speaker: s, api: _api),
    );
    if (saved == true) _load();
  }

  Future<void> _delete(Map<String, dynamic> s) async {
    final ok = await ConfirmationDialog.show(context, title: 'Remove speaker', message: 'Remove ${s['name']}?');
    if (ok != true) return;
    try {
      await _api.delete<dynamic>('$_base/${s['id']}');
      _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final speakers = _speakers;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Speakers'),
      floatingActionButton: FloatingActionButton(onPressed: _edit, tooltip: 'Add speaker', child: const Icon(Icons.add)),
      body: speakers == null
          ? const LoadingWidget()
          : speakers.isEmpty
              ? const EmptyStateWidget(
                  icon: Icons.record_voice_over_outlined,
                  title: 'No speakers yet',
                  subtitle: 'Add the speakers for your coming meetings.')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.only(bottom: 80),
                    itemCount: speakers.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final s = speakers[i];
                      return ListTile(
                        title: Text(s['name'] as String? ?? ''),
                        subtitle: Text([
                          DateFormatter.toDisplay(DateTime.tryParse(s['meetingDate']?.toString() ?? '')),
                          s['topic'],
                          if (s['showOnWebsite'] != true) 'not on the website',
                        ].whereType<String>().where((t) => t.isNotEmpty).join('  ·  ')),
                        onTap: () => _edit(s),
                        trailing: IconButton(
                            tooltip: 'Remove', icon: const Icon(Icons.delete_outline), onPressed: () => _delete(s)),
                      );
                    },
                  ),
                ),
    );
  }
}

class _SpeakerForm extends StatefulWidget {
  const _SpeakerForm({required this.base, required this.api, this.speaker});
  final String base;
  final ApiClient api;
  final Map<String, dynamic>? speaker;

  @override
  State<_SpeakerForm> createState() => _SpeakerFormState();
}

class _SpeakerFormState extends State<_SpeakerForm> {
  late final _name = TextEditingController(text: widget.speaker?['name'] as String?);
  late final _topic = TextEditingController(text: widget.speaker?['topic'] as String?);
  late final _bio = TextEditingController(text: widget.speaker?['bio'] as String?);
  late final _email = TextEditingController(text: widget.speaker?['email'] as String?);
  late final _phone = TextEditingController(text: widget.speaker?['phone'] as String?);
  late DateTime? _date = DateTime.tryParse(widget.speaker?['meetingDate']?.toString() ?? '');
  late bool _onWebsite = widget.speaker?['showOnWebsite'] as bool? ?? true;
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_name, _topic, _bio, _email, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _date == null) {
      SnackbarUtils.showError(context, 'Enter the name and the meeting date.');
      return;
    }
    setState(() => _saving = true);
    final body = {
      'meetingDate': DateFormatter.toApiFormat(_date),
      'name': _name.text.trim(),
      'topic': _topic.text.trim(),
      'bio': _bio.text.trim(),
      'email': _email.text.trim(),
      'phone': _phone.text.trim(),
      'showOnWebsite': _onWebsite,
    };
    try {
      final id = widget.speaker?['id'];
      id == null
          ? await widget.api.post<dynamic>(widget.base, body: body)
          : await widget.api.put<dynamic>('${widget.base}/$id', body: body);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    InputDecoration d(String label) => InputDecoration(labelText: label, border: const OutlineInputBorder());
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.speaker == null ? 'Add speaker' : 'Edit speaker', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              icon: const Icon(Icons.event_outlined),
              label: Text(_date == null ? 'Meeting date' : DateFormatter.toDisplay(_date)),
              onPressed: () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                    context: context,
                    initialDate: _date ?? now,
                    firstDate: DateTime(now.year - 1),
                    lastDate: DateTime(now.year + 2));
                if (picked != null) setState(() => _date = picked);
              },
            ),
            const SizedBox(height: 12),
            TextField(controller: _name, decoration: d('Name')),
            const SizedBox(height: 12),
            TextField(controller: _topic, decoration: d('Topic')),
            const SizedBox(height: 12),
            TextField(controller: _bio, decoration: d('Short bio'), maxLines: 3),
            const SizedBox(height: 12),
            TextField(controller: _email, decoration: d('Email'), keyboardType: TextInputType.emailAddress),
            const SizedBox(height: 12),
            TextField(controller: _phone, decoration: d('Phone'), keyboardType: TextInputType.phone),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show on the club website'),
              subtitle: const Text('Name, topic and bio only, never the contact details'),
              value: _onWebsite,
              onChanged: (v) => setState(() => _onWebsite = v),
            ),
            FilledButton(onPressed: _saving ? null : _save, child: const Text('Save')),
          ],
        ),
      ),
    );
  }
}
