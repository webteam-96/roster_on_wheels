import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class _Year {
  final int id;
  final String label;
  final bool isCurrent;
  const _Year({required this.id, required this.label, required this.isCurrent});
  factory _Year.fromJson(Map<String, dynamic> j) => _Year(
        id: j['id'] as int? ?? 0,
        label: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: j['isCurrent'] as bool? ?? false,
      );
}

class _Member {
  final int id;
  final String name;
  final String? email;
  final String? clubName;
  final String? districtNumber;
  const _Member({
    required this.id,
    required this.name,
    this.email,
    this.clubName,
    this.districtNumber,
  });
  factory _Member.fromJson(Map<String, dynamic> j) => _Member(
        id: j['id'] as int? ?? j['memberId'] as int? ?? 0,
        name: j['memberName']?.toString() ?? j['name']?.toString() ?? '',
        email: j['email']?.toString() ?? j['emailId']?.toString(),
        clubName: j['clubName']?.toString(),
        districtNumber: j['districtNumber']?.toString(),
      );
}

class RiDirectorSubGroupFormScreen extends StatefulWidget {
  final int? subGroupId;
  const RiDirectorSubGroupFormScreen({super.key, this.subGroupId});

  @override
  State<RiDirectorSubGroupFormScreen> createState() =>
      _RiDirectorSubGroupFormScreenState();
}

class _RiDirectorSubGroupFormScreenState extends State<RiDirectorSubGroupFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _groupNameCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();

  List<_Year> _years = const [];
  int? _yearId;
  List<_Member> _members = const [];
  final Set<int> _selectedIds = <int>{};
  bool _loading = false;
  bool _loadingMembers = false;
  bool _saving = false;
  String? _loadError;

  bool get _isEdit => widget.subGroupId != null;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _groupNameCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    setState(() => _loading = _isEdit);
    try {
      final yResp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      final years = (yResp.data ?? const [])
          .map((e) => _Year.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _years = years;
        if (_yearId == null) {
          final current = years.where((y) => y.isCurrent).toList();
          _yearId = current.isNotEmpty ? current.first.id : (years.isNotEmpty ? years.first.id : null);
        }
      });
    } catch (_) {}
    if (_isEdit) {
      await _loadExisting();
    }
    await _loadMembers('');
  }

  Future<void> _loadExisting() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/sub-groups/${widget.subGroupId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final d = resp.data ?? const {};
      if (!mounted) return;
      setState(() {
        _groupNameCtrl.text = d['groupName']?.toString() ?? '';
        _yearId = d['yearId'] as int?;
        final members = d['members'] as List<dynamic>? ?? const [];
        _selectedIds.clear();
        for (final m in members) {
          final mm = m as Map<String, dynamic>;
          final id = mm['memberId'] as int? ?? mm['id'] as int? ?? 0;
          if (id > 0) _selectedIds.add(id);
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _loadError = e.toString(); _loading = false; });
    }
  }

  Future<void> _loadMembers(String q) async {
    setState(() => _loadingMembers = true);
    try {
      final qp = <String, dynamic>{};
      if (q.isNotEmpty) qp['search'] = q;
      final resp = await _api.get<List<dynamic>>(
        '/api/ri-director/sub-groups/available-members',
        queryParams: qp,
        fromJson: (j) => j as List<dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _members = (resp.data ?? const [])
            .map((e) => _Member.fromJson(e as Map<String, dynamic>))
            .toList();
        _loadingMembers = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() { _members = const []; _loadingMembers = false; });
    }
  }

  void _toggle(int id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
    });
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_yearId == null) { _snack('Year is required.'); return; }
    if (_selectedIds.isEmpty) { _snack('Select at least one member.'); return; }

    setState(() => _saving = true);
    try {
      final payload = <String, dynamic>{
        'yearId': _yearId,
        'groupName': _groupNameCtrl.text.trim(),
        'memberIds': _selectedIds.toList(),
      };
      if (_isEdit) {
        await _api.put('/api/ri-director/sub-groups/${widget.subGroupId}', body: payload);
      } else {
        await _api.post('/api/ri-director/sub-groups', body: payload);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEdit ? 'Sub group updated' : 'Sub group created'),
          backgroundColor: AppColors.success,
        ),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: AppColors.error),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: _isEdit ? 'Edit Sub Group' : 'Add Sub Group'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _loadError != null
              ? Center(child: Padding(padding: const EdgeInsets.all(20),
                  child: Text(_loadError!, style: AppTextStyles.body)))
              : _buildForm(),
    );
  }

  Widget _buildForm() {
    return Form(
      key: _formKey,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(children: [
            _buildYearPicker(),
            const SizedBox(height: 14),
            CustomTextField(
              label: 'Group Name *',
              controller: _groupNameCtrl,
              maxLength: 100,
              hint: 'e.g., Past Governors',
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Group name is required' : null,
            ),
            const SizedBox(height: 14),
            _buildSearchBar(),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(children: [
            const Icon(Icons.people, size: 14, color: AppColors.primary),
            const SizedBox(width: 4),
            Text('Selected: ', style: AppTextStyles.caption),
            Text('${_selectedIds.length}',
                style: AppTextStyles.caption.copyWith(color: AppColors.primary, fontWeight: FontWeight.w700)),
          ]),
        ),
        Expanded(child: _buildMembersList()),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: _buildSaveButton(),
          ),
        ),
      ]),
    );
  }

  Widget _buildYearPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Year *', style: AppTextStyles.caption.copyWith(
          color: AppColors.textSecondary, fontWeight: FontWeight.w600,
        )),
        const SizedBox(height: 6),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<int>(
              isExpanded: true,
              value: _yearId,
              items: [
                for (final y in _years)
                  DropdownMenuItem(
                    value: y.id,
                    child: Text(
                      '${y.label}${y.isCurrent ? " (Current)" : ""}',
                      style: AppTextStyles.body,
                    ),
                  ),
              ],
              onChanged: (v) { if (v != null) setState(() => _yearId = v); },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSearchBar() {
    return SizedBox(
      height: 44,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(children: [
                const Icon(Icons.search, size: 18, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _searchCtrl,
                    decoration: const InputDecoration(
                      hintText: 'Search members...',
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      errorBorder: InputBorder.none,
                      disabledBorder: InputBorder.none,
                      isCollapsed: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                    onSubmitted: (q) => _loadMembers(q.trim()),
                  ),
                ),
              ]),
            ),
          ),
          const SizedBox(width: 8),
          ElevatedButton(
            onPressed: () => _loadMembers(_searchCtrl.text.trim()),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary, foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('Search'),
          ),
        ],
      ),
    );
  }

  Widget _buildMembersList() {
    if (_loadingMembers) {
      return const Center(child: const CircularProgressIndicator(color: AppColors.primary));
    }
    if (_members.isEmpty) {
      return Center(child: Text('No members found.', style: AppTextStyles.body));
    }
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _members.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final m = _members[i];
        final selected = _selectedIds.contains(m.id);
        return InkWell(
          onTap: () => _toggle(m.id),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(children: [
              Icon(
                selected ? Icons.check_box : Icons.check_box_outline_blank,
                color: selected ? AppColors.primary : AppColors.textSecondary,
              ),
              const SizedBox(width: 10),
              CircleAvatar(
                radius: 18, backgroundColor: AppColors.primaryLight,
                child: Text(
                  m.name.isNotEmpty ? m.name[0].toUpperCase() : '?',
                  style: AppFonts.body(
                    color: AppColors.primary, fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m.name, style: AppTextStyles.bodyMedium, overflow: TextOverflow.ellipsis),
                    if ((m.clubName ?? '').isNotEmpty || (m.districtNumber ?? '').isNotEmpty)
                      Text(
                        [
                          if ((m.clubName ?? '').isNotEmpty) m.clubName,
                          if ((m.districtNumber ?? '').isNotEmpty) 'D${m.districtNumber}',
                        ].whereType<String>().join(' · '),
                        style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
            ]),
          ),
        );
      },
    );
  }

  Widget _buildSaveButton() {
    return ElevatedButton.icon(
      onPressed: _saving ? null : _save,
      icon: _saving
          ? const SizedBox(width: 16, height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation(Colors.white)))
          : Icon(_isEdit ? Icons.save : Icons.add),
      label: Text(_isEdit ? 'Update' : 'Create'),
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 14),
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }
}
