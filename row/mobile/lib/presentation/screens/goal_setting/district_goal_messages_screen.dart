import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/district_admin_dashboard_api.dart';
import '../../../core/services/goal_setting_api.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../../data/models/goal_setting_models.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// District Goal Messages for the current Rotary year (`api/goal-setting/district-messages`): the district's Admin or
/// District Governor writes about one goal category; SuperAdmins read. Same thread as the web's Goal Setting popup.
class DistrictGoalMessagesScreen extends StatefulWidget {
  const DistrictGoalMessagesScreen({super.key, required this.districtId});
  final int districtId;

  @override
  State<DistrictGoalMessagesScreen> createState() => _DistrictGoalMessagesScreenState();
}

class _DistrictGoalMessagesScreenState extends State<DistrictGoalMessagesScreen> {
  final _api = ApiClient();
  final _input = TextEditingController();
  List<GoalCategory> _categories = const [];
  int? _categoryId;
  int? _yearId;
  Map<String, dynamic>? _thread;
  String? _error;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    try {
      final years = await DistrictAdminDashboardApi().getRotaryYears();
      final cats = await GoalSettingApi().getCategories();
      final current = years.where((y) => y.isCurrent).toList();
      if (current.isEmpty || cats.isEmpty) {
        if (mounted) setState(() => _error = 'No current Rotary year or goal categories.');
        return;
      }
      _yearId = current.first.id;
      _categories = cats;
      _categoryId = cats.first.id;
      await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the messages.');
    }
  }

  String get _path => '/api/goal-setting/district-messages/$_categoryId/${widget.districtId}';

  Future<void> _load() async {
    setState(() => _thread = null);
    try {
      final res = await _api.get<Map<String, dynamic>>(_path,
          queryParams: {'yearId': _yearId}, fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) setState(() => _thread = res.data ?? const {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      await _api.post<dynamic>('$_path?yearId=$_yearId', body: {'commentText': text});
      _input.clear();
      await _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final thread = _thread;
    final messages = ((thread?['messages'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: const CustomAppBar(title: 'Goal messages'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.forum_outlined, title: 'Not available', subtitle: _error!)
          : _categoryId == null
              ? const LoadingWidget()
              : Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: DropdownButtonFormField<int>(
                        initialValue: _categoryId,
                        decoration: const InputDecoration(labelText: 'Goal category', border: OutlineInputBorder()),
                        items: [for (final c in _categories) DropdownMenuItem(value: c.id, child: Text(c.name))],
                        onChanged: (v) {
                          _categoryId = v;
                          _load();
                        },
                      ),
                    ),
                    Expanded(
                      child: thread == null
                          ? const LoadingWidget()
                          : messages.isEmpty
                              ? const EmptyStateWidget(
                                  icon: Icons.forum_outlined, title: 'No messages yet', subtitle: '')
                              : ListView.builder(
                                  padding: const EdgeInsets.symmetric(horizontal: 12),
                                  itemCount: messages.length,
                                  itemBuilder: (_, i) {
                                    final m = messages[i];
                                    return ListTile(
                                      title: Text(m['commentText'] as String? ?? ''),
                                      subtitle: Text([m['postedByName'], m['postedByRoleLabel'], m['createdDate']]
                                          .whereType<String>()
                                          .where((t) => t.isNotEmpty)
                                          .join('  ·  ')),
                                    );
                                  },
                                ),
                    ),
                    if (thread?['canPost'] == true)
                      SafeArea(
                        top: false,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 4, 4, 8),
                          child: Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _input,
                                  minLines: 1,
                                  maxLines: 4,
                                  decoration: InputDecoration(
                                      hintText: 'Message as ${thread?['posterRole'] ?? 'the district'}',
                                      border: const OutlineInputBorder()),
                                ),
                              ),
                              IconButton(
                                  onPressed: _sending ? null : _send, tooltip: 'Send', icon: const Icon(Icons.send)),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
    );
  }
}
