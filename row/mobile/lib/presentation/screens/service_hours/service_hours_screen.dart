import 'package:flutter/material.dart' hide Text;
import 'package:image_picker/image_picker.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/service_hours_api.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

String _hours(num? h) {
  final v = (h ?? 0).toDouble();
  return v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2).replaceFirst(RegExp(r'0$'), '');
}

/// The member's service hours (feature `service_hours`): totals per Rotary year, every entry with its review
/// state (hours recorded on volunteer sheets included), and a button to log new hours.
class ServiceHoursScreen extends StatefulWidget {
  const ServiceHoursScreen({super.key, this.api});
  final ServiceHoursApi? api;

  @override
  State<ServiceHoursScreen> createState() => _ServiceHoursScreenState();
}

class _ServiceHoursScreenState extends State<ServiceHoursScreen> {
  late final ServiceHoursApi _api = widget.api ?? ServiceHoursApi();
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await _api.mine();
      if (mounted) setState(() { _data = data; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _log() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => LogServiceHoursScreen(api: _api)),
    );
    if (saved == true) await _load();
  }

  Future<void> _remove(Map<String, dynamic> e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Remove this entry?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Remove')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.remove(e['id'] as int);
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Entry removed');
      await _load();
    } on ApiException catch (err) {
      if (mounted) SnackbarUtils.showError(context, err.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final entries = ((data?['entries'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final years = ((data?['years'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: const CustomAppBar(title: 'My service hours'),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _log,
        icon: const Icon(Icons.add),
        label: const Text('Log hours'),
      ),
      body: _error != null && data == null
          ? ErrorStateWidget(message: _error!, onRetry: _load)
          : data == null
              ? const LoadingWidget()
              : entries.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.handshake_outlined,
                      title: 'No service hours yet',
                      subtitle: 'Log the hours you give to club projects and other service. Your club officers approve them.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                        children: [
                          for (final y in years) _yearCard(y),
                          const SizedBox(height: 4),
                          for (final e in entries) _entryTile(e),
                        ],
                      ),
                    ),
    );
  }

  Widget _yearCard(Map<String, dynamic> y) {
    final volunteer = (y['volunteerHours'] as num? ?? 0) > 0;
    final pending = (y['pendingHours'] as num? ?? 0) > 0;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text('Rotary year ${y['yearLabel'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text([
          '${_hours(y['approvedHours'] as num?)} hours approved',
          if (pending) '${_hours(y['pendingHours'] as num?)} waiting for review',
          if (volunteer) '${_hours(y['volunteerHours'] as num?)} on volunteer sheets',
        ].join('  ·  ')),
      ),
    );
  }

  Widget _entryTile(Map<String, dynamic> e) {
    final volunteer = e['source'] == 'volunteer';
    final status = e['status'] as String? ?? 'pending';
    final label = volunteer
        ? 'Volunteer sheet'
        : switch (status) { 'approved' => 'Approved', 'rejected' => 'Not approved', _ => 'Waiting for review' };
    final color = switch (status) { 'approved' => Colors.green.shade700, 'rejected' => Colors.red.shade700, _ => Colors.orange.shade800 };
    final photo = e['photoPath'] as String?;
    final what = (e['projectTitle'] as String?) ?? (e['otherService'] as String?) ?? '';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: photo != null && photo.isNotEmpty
            ? ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.network('${ApiConstants.baseUrl}$photo', width: 48, height: 48, fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(Icons.image_not_supported_outlined)),
              )
            : const Icon(Icons.handshake_outlined),
        title: Text(what),
        subtitle: Text([
          '${DateFormatter.toDisplay(DateTime.tryParse(e['serviceDate']?.toString() ?? ''))}  ·  ${_hours(e['hours'] as num?)} h  ·  ${e['clubName'] ?? ''}',
          if ((e['note'] as String?)?.trim().isNotEmpty == true) e['note'] as String,
          if ((e['reviewNote'] as String?)?.trim().isNotEmpty == true) 'Officer: ${e['reviewNote']}',
        ].join('\n')),
        isThreeLine: true,
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(label, style: TextStyle(color: volunteer ? null : color, fontSize: 12, fontWeight: FontWeight.w600)),
            if (!volunteer && status != 'approved')
              InkWell(
                onTap: () => _remove(e),
                child: const Padding(padding: EdgeInsets.only(top: 4), child: Text('Remove', style: TextStyle(fontSize: 12))),
              ),
          ],
        ),
      ),
    );
  }
}

/// Logs service hours: date, club, project (or other service), hours, note and an optional photo.
class LogServiceHoursScreen extends StatefulWidget {
  const LogServiceHoursScreen({super.key, required this.api});
  final ServiceHoursApi api;

  @override
  State<LogServiceHoursScreen> createState() => _LogServiceHoursScreenState();
}

class _LogServiceHoursScreenState extends State<LogServiceHoursScreen> {
  static const _other = -1;
  final _form = GlobalKey<FormState>();
  final _hoursCtl = TextEditingController();
  final _otherCtl = TextEditingController();
  final _noteCtl = TextEditingController();
  DateTime _date = DateTime.now();
  List<Map<String, dynamic>>? _clubs;
  String? _error;
  int? _clubId;
  int? _projectId;
  XFile? _photo;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadOptions();
  }

  @override
  void dispose() {
    _hoursCtl.dispose();
    _otherCtl.dispose();
    _noteCtl.dispose();
    super.dispose();
  }

  Future<void> _loadOptions() async {
    setState(() { _clubs = null; _error = null; });
    try {
      final clubs = await widget.api.options(_date);
      if (!mounted) return;
      setState(() {
        _clubs = clubs;
        if (!clubs.any((c) => c['clubId'] == _clubId)) _clubId = clubs.isNotEmpty ? clubs.first['clubId'] as int : null;
        if (_projectId != _other && !_projects.any((p) => p['id'] == _projectId)) _projectId = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  List<Map<String, dynamic>> get _projects =>
      ((_clubs?.firstWhere((c) => c['clubId'] == _clubId, orElse: () => const {})['projects'] as List?) ?? const [])
          .cast<Map<String, dynamic>>();

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 2, now.month, now.day + 1),
      lastDate: now,
    );
    if (picked == null || picked == _date) return;
    setState(() => _date = picked);
    await _loadOptions(); // projects belong to the Rotary year of the date
  }

  Future<void> _pickPhoto(ImageSource source) async {
    final picked = await ImagePicker().pickImage(source: source, maxWidth: 2048, maxHeight: 2048, imageQuality: 85);
    if (picked != null && mounted) setState(() => _photo = picked);
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false) || _clubId == null) return;
    setState(() => _saving = true);
    try {
      final other = _projectId == _other;
      final entry = await widget.api.log(
        clubId: _clubId!,
        projectId: other ? null : _projectId,
        otherService: other ? _otherCtl.text.trim() : null,
        date: _date,
        hours: double.parse(_hoursCtl.text.trim().replaceAll(',', '.')),
        note: _noteCtl.text.trim().isEmpty ? null : _noteCtl.text.trim(),
      );
      final photo = _photo;
      if (photo != null && entry['id'] is int) {
        try {
          await widget.api.photo(entry['id'] as int, photo.path);
        } on ApiException catch (e) {
          if (mounted) SnackbarUtils.showError(context, 'Hours saved, but the photo was not: ${e.message}');
        }
      }
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Hours logged. Your club officers will review them.');
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final clubs = _clubs;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Log service hours'),
      body: _error != null
          ? ErrorStateWidget(message: _error!, onRetry: _loadOptions)
          : clubs == null
              ? const LoadingWidget()
              : clubs.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.groups_outlined,
                      title: 'No club to log hours for',
                      subtitle: 'You can log hours for the clubs you are an active member of.')
                  : Form(
                      key: _form,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.event_outlined),
                            title: const Text('Date of service'),
                            subtitle: Text(DateFormatter.toDisplay(_date)),
                            trailing: TextButton(onPressed: _pickDate, child: const Text('Change')),
                          ),
                          if (clubs.length > 1)
                            DropdownButtonFormField<int>(
                              value: _clubId,
                              decoration: const InputDecoration(labelText: 'Club'),
                              items: [
                                for (final c in clubs)
                                  DropdownMenuItem(value: c['clubId'] as int, child: Text(c['clubName'] as String? ?? '')),
                              ],
                              onChanged: (v) => setState(() { _clubId = v; _projectId = null; }),
                            ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<int>(
                            value: _projectId,
                            isExpanded: true,
                            decoration: const InputDecoration(labelText: 'Project'),
                            items: [
                              for (final p in _projects)
                                DropdownMenuItem(value: p['id'] as int, child: Text(p['title'] as String? ?? '', overflow: TextOverflow.ellipsis)),
                              const DropdownMenuItem(value: _other, child: Text('Other service')),
                            ],
                            validator: (v) => v == null ? 'Pick a project or Other service' : null,
                            onChanged: (v) => setState(() => _projectId = v),
                          ),
                          if (_projectId == _other) ...[
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: _otherCtl,
                              maxLength: 200,
                              decoration: const InputDecoration(labelText: 'What was the service?'),
                              validator: (v) => (v ?? '').trim().isEmpty ? 'Say what the service was' : null,
                            ),
                          ],
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _hoursCtl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: const InputDecoration(labelText: 'Hours', hintText: '2.5'),
                            validator: (v) {
                              final h = double.tryParse((v ?? '').trim().replaceAll(',', '.'));
                              return h == null || h <= 0 || h > 24 ? 'Enter hours between 0 and 24' : null;
                            },
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _noteCtl,
                            maxLength: 1000,
                            maxLines: 3,
                            decoration: const InputDecoration(labelText: 'Note (optional)'),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              if (_photo != null)
                                Expanded(child: Text('Photo: ${_photo!.name}', overflow: TextOverflow.ellipsis))
                              else
                                const Expanded(child: Text('Add a service photo (optional)')),
                              IconButton(
                                tooltip: 'Take a photo',
                                onPressed: () => _pickPhoto(ImageSource.camera),
                                icon: const Icon(Icons.photo_camera_outlined),
                              ),
                              IconButton(
                                tooltip: 'Choose a photo',
                                onPressed: () => _pickPhoto(ImageSource.gallery),
                                icon: const Icon(Icons.photo_library_outlined),
                              ),
                              if (_photo != null)
                                IconButton(
                                  tooltip: 'Remove the photo',
                                  onPressed: () => setState(() => _photo = null),
                                  icon: const Icon(Icons.close),
                                ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          FilledButton(
                            onPressed: _saving ? null : _save,
                            child: _saving
                                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Text('Save'),
                          ),
                        ],
                      ),
                    ),
    );
  }
}
