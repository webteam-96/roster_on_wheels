import 'package:flutter/material.dart' hide Text;
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class DistrictSubGroupFormYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const DistrictSubGroupFormYear({
    required this.id,
    required this.yearLabel,
    required this.isCurrent,
  });
}

class DistrictSubGroupFormMember {
  final int memberId;
  final String name;
  final String mobile;
  final String email;
  const DistrictSubGroupFormMember({
    required this.memberId,
    required this.name,
    required this.mobile,
    required this.email,
  });
}

class DistrictSubGroupFormInitial {
  final int id;
  final String groupName;
  final int yearId;
  final List<int> memberIds;
  const DistrictSubGroupFormInitial({
    required this.id,
    required this.groupName,
    required this.yearId,
    required this.memberIds,
  });
}

class DistrictSubGroupFormScreen extends StatefulWidget {
  final int districtId;
  final List<DistrictSubGroupFormYear> years;
  final int? defaultYearId;
  final DistrictSubGroupFormInitial? initial;

  const DistrictSubGroupFormScreen({
    super.key,
    required this.districtId,
    required this.years,
    this.defaultYearId,
    this.initial,
  });

  @override
  State<DistrictSubGroupFormScreen> createState() =>
      _DistrictSubGroupFormScreenState();
}

class _DistrictSubGroupFormScreenState
    extends State<DistrictSubGroupFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _filterCtrl = TextEditingController();

  int? _yearId;
  bool _saving = false;
  bool _membersLoading = true;
  List<DistrictSubGroupFormMember> _members = const [];
  String _filter = '';
  final Set<int> _selectedIds = {};

  String get _base => '/api/districts/${widget.districtId}/sub-groups';
  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _nameCtrl.text = init.groupName;
      _yearId = init.yearId;
      _selectedIds.addAll(init.memberIds);
    } else {
      _yearId = widget.defaultYearId;
    }
    _loadMembers();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _filterCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMembers() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '$_base/district-members',
        fromJson: (j) => j as List<dynamic>,
      );
      // Backend returns one row per (memberId, clubName), so the same person
      // appears multiple times if they belong to multiple clubs. Keep the
      // first occurrence per memberId so the picker shows each member once.
      final seen = <int>{};
      final list = <DistrictSubGroupFormMember>[];
      for (final e in (resp.data ?? const [])) {
        final m = e as Map<String, dynamic>;
        final memberId = (m['memberId'] as int?) ?? (m['id'] as int?) ?? 0;
        if (memberId == 0 || !seen.add(memberId)) continue;
        list.add(DistrictSubGroupFormMember(
          memberId: memberId,
          name: (m['memberName'] ?? m['name'] ?? '').toString().trim(),
          mobile: (m['mobileNumber'] ?? m['mobile'] ?? '').toString(),
          email: m['email']?.toString() ?? '',
        ));
      }
      if (!mounted) return;
      setState(() {
        _members = list;
        _membersLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _members = const [];
        _membersLoading = false;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_yearId == null) return;
    final body = <String, dynamic>{
      'yearId': _yearId,
      'groupName': _nameCtrl.text.trim(),
      'memberIds': _selectedIds.toList(),
    };
    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put('$_base/${widget.initial!.id}', body: body);
      } else {
        await _api.post(_base, body: body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Save failed: $e'), backgroundColor: AppColors.error),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _members.where((m) {
      final q = _filter.trim().toLowerCase();
      if (q.isEmpty) return true;
      return m.name.toLowerCase().contains(q) ||
          m.mobile.toLowerCase().contains(q) ||
          m.email.toLowerCase().contains(q);
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Sub Group' : 'Add Sub Group',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _saving ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.primaryPrime,
                foregroundColor: AppColors.darkBg,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: const StadiumBorder(),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.black54,
                      ),
                    )
                  : Text(
                      'Save',
                      style: AppFonts.body(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            CustomTextField(
              label: 'Group Name',
              controller: _nameCtrl,
              hint: 'e.g. Membership Sub Group',
              prefixIcon: Icons.group_work_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Group name is required'
                  : null,
            ),
            const SizedBox(height: 16),
            if (widget.years.isNotEmpty)
              DropdownButtonFormField<int>(
                initialValue: _yearId,
                decoration: InputDecoration(
                  labelText: 'Rotary Year',
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
                items: widget.years
                    .map((y) => DropdownMenuItem(
                          value: y.id,
                          child: Text(
                              '${y.yearLabel}${y.isCurrent ? " (Current)" : ""}'),
                        ))
                    .toList(),
                onChanged: _saving ? null : (v) => setState(() => _yearId = v),
                validator: (v) => v == null ? 'Year is required' : null,
              ),
            const SizedBox(height: 16),
            Text('Members',
                style: AppTextStyles.bodyMedium
                    .copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            TextField(
              controller: _filterCtrl,
              onChanged: (v) => setState(() => _filter = v),
              decoration: InputDecoration(
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                hintText: 'Search members...',
                prefixIcon: const Icon(Icons.search, size: 20),
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(10),
                color: AppColors.surface,
              ),
              child: SizedBox(
                height: 380,
                child: _membersLoading
                    ? const Center(
                        child:
                            const CircularProgressIndicator(color: AppColors.primary),
                      )
                    : _members.isEmpty
                        ? Center(
                            child: Text(
                              'No district members available',
                              style: AppTextStyles.caption
                                  .copyWith(color: AppColors.textSecondary),
                            ),
                          )
                        : filtered.isEmpty
                            ? Center(
                                child: Text(
                                  'No members match search',
                                  style: AppTextStyles.caption
                                      .copyWith(color: AppColors.textSecondary),
                                ),
                              )
                            : ListView.builder(
                                itemCount: filtered.length,
                                itemBuilder: (_, i) {
                                  final m = filtered[i];
                                  final checked =
                                      _selectedIds.contains(m.memberId);
                                  return CheckboxListTile(
                                    dense: true,
                                    value: checked,
                                    onChanged: _saving
                                        ? null
                                        : (v) {
                                            setState(() {
                                              if (v == true) {
                                                _selectedIds.add(m.memberId);
                                              } else {
                                                _selectedIds.remove(m.memberId);
                                              }
                                            });
                                          },
                                    controlAffinity:
                                        ListTileControlAffinity.leading,
                                    title: Text(
                                      m.name.isEmpty ? 'Unnamed' : m.name,
                                      style: AppTextStyles.bodyMedium,
                                    ),
                                    subtitle: m.mobile.isEmpty
                                        ? null
                                        : Text(
                                            m.mobile,
                                            style: AppTextStyles.caption
                                                .copyWith(
                                                    color: AppColors
                                                        .textSecondary),
                                          ),
                                  );
                                },
                              ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '${_selectedIds.length} member(s) selected',
              style: AppTextStyles.caption
                  .copyWith(color: AppColors.textSecondary),
            ),
          ],
        ),
        ),
      ),
    );
  }
}
