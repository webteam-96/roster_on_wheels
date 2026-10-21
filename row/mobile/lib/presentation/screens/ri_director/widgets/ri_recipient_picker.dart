import 'package:flutter/material.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Selected recipient scope for RI Director sends.
class RiRecipientValue {
  final String target; // 'all' | 'zones' | 'districts' | 'subgroups'
  final List<int> zoneIds;
  final List<int> districtIds;
  final List<int> subgroupIds;
  final int? subgroupYearId;

  const RiRecipientValue({
    this.target = 'all',
    this.zoneIds = const [],
    this.districtIds = const [],
    this.subgroupIds = const [],
    this.subgroupYearId,
  });

  RiRecipientValue copyWith({
    String? target,
    List<int>? zoneIds,
    List<int>? districtIds,
    List<int>? subgroupIds,
    int? subgroupYearId,
  }) =>
      RiRecipientValue(
        target: target ?? this.target,
        zoneIds: zoneIds ?? this.zoneIds,
        districtIds: districtIds ?? this.districtIds,
        subgroupIds: subgroupIds ?? this.subgroupIds,
        subgroupYearId: subgroupYearId ?? this.subgroupYearId,
      );
}

class RiRecipientPicker extends StatefulWidget {
  final RiRecipientValue value;
  final ValueChanged<RiRecipientValue> onChanged;
  final String channel; // 'email'
  final bool checkCredits;

  const RiRecipientPicker({
    super.key,
    required this.value,
    required this.onChanged,
    this.channel = 'email',
    this.checkCredits = false,
  });

  @override
  State<RiRecipientPicker> createState() => _RiRecipientPickerState();
}

class _RiRecipientPickerState extends State<RiRecipientPicker> {
  final _api = ApiClient();
  List<_Zone> _zones = const [];
  List<_District> _districts = const [];
  List<_Year> _years = const [];
  List<_SubGroup> _subgroups = const [];
  int? _recipientCount;
  int? _balance;
  bool _countLoading = false;

  @override
  void initState() {
    super.initState();
    _loadLists();
  }

  @override
  void didUpdateWidget(covariant RiRecipientPicker old) {
    super.didUpdateWidget(old);
    if (old.value.target != widget.value.target ||
        !_listEq(old.value.zoneIds, widget.value.zoneIds) ||
        !_listEq(old.value.districtIds, widget.value.districtIds) ||
        !_listEq(old.value.subgroupIds, widget.value.subgroupIds)) {
      _refreshCount();
    }
    if (old.value.subgroupYearId != widget.value.subgroupYearId &&
        widget.value.target == 'subgroups' &&
        widget.value.subgroupYearId != null) {
      _loadSubgroups(widget.value.subgroupYearId!);
    }
    if (old.channel != widget.channel && widget.checkCredits) _refreshBalance();
  }

  bool _listEq(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) { if (a[i] != b[i]) return false; }
    return true;
  }

  Future<void> _loadLists() async {
    try {
      final zResp = await _api.get<Map<String, dynamic>>(
        '/api/zones',
        queryParams: {'page': 1, 'pageSize': 1000, 'isActive': 1},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final zItems = (zResp.data?['items'] as List<dynamic>? ?? const []);
      if (mounted) setState(() {
        _zones = zItems.map((e) => _Zone.fromJson(e as Map<String, dynamic>)).toList();
      });
    } catch (_) {}
    try {
      final dResp = await _api.get<Map<String, dynamic>>(
        '/api/districts',
        queryParams: {'page': 1, 'pageSize': 1000, 'isActive': 1},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final dItems = (dResp.data?['items'] as List<dynamic>? ?? const []);
      if (mounted) setState(() {
        _districts = dItems.map((e) => _District.fromJson(e as Map<String, dynamic>)).toList();
      });
    } catch (_) {}
    try {
      final yResp = await _api.get<List<dynamic>>(
        '/api/ri-director/sub-groups/years',
        fromJson: (j) => j as List<dynamic>,
      );
      if (mounted) setState(() {
        _years = (yResp.data ?? const [])
            .map((e) => _Year.fromJson(e as Map<String, dynamic>))
            .toList();
      });
    } catch (_) {}
    if (widget.value.target == 'subgroups' && widget.value.subgroupYearId != null) {
      await _loadSubgroups(widget.value.subgroupYearId!);
    }
    _refreshCount();
    if (widget.checkCredits) _refreshBalance();
  }

  Future<void> _loadSubgroups(int yearId) async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/ri-director/sub-groups',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      if (mounted) setState(() {
        _subgroups = (resp.data ?? const [])
            .map((e) => _SubGroup.fromJson(e as Map<String, dynamic>))
            .toList();
      });
    } catch (_) {
      if (mounted) setState(() => _subgroups = const []);
    }
  }

  Future<void> _refreshCount() async {
    final v = widget.value;
    setState(() => _countLoading = true);
    try {
      // ApiClient's _uri joins queryParams via Uri.replace which only supports
      // single-value lists. Serialize multi-ids ourselves into the path.
      final buffer = StringBuffer('/api/ri-director/recipients/count?channel=${widget.channel}&target=${v.target}');
      for (final id in v.zoneIds) { buffer.write('&zoneIds=$id'); }
      for (final id in v.districtIds) { buffer.write('&districtIds=$id'); }
      for (final id in v.subgroupIds) { buffer.write('&subgroupIds=$id'); }
      final resp = await _api.get<Map<String, dynamic>>(
        buffer.toString(),
        queryParams: null,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _recipientCount = resp.data?['count'] as int?;
        _countLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() { _recipientCount = null; _countLoading = false; });
    }
  }

  Future<void> _refreshBalance() async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/credits/balance',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        final d = resp.data ?? const <String, dynamic>{};
        _balance = d['emailBalance'] as int?;
      });
    } catch (_) {
      if (mounted) setState(() => _balance = null);
    }
  }

  void _setTarget(String target) {
    if (widget.value.target == target) return;
    if (target == 'subgroups') {
      final currentYear = _years.where((y) => y.isCurrent).map((y) => y.id).firstOrNull
          ?? (_years.isNotEmpty ? _years.first.id : null);
      widget.onChanged(widget.value.copyWith(
        target: target,
        zoneIds: const [],
        districtIds: const [],
        subgroupIds: const [],
        subgroupYearId: widget.value.subgroupYearId ?? currentYear,
      ));
    } else {
      widget.onChanged(widget.value.copyWith(
        target: target,
        zoneIds: target == 'zones' ? widget.value.zoneIds : const [],
        districtIds: target == 'districts' ? widget.value.districtIds : const [],
        subgroupIds: const [],
      ));
    }
  }

  void _toggleZone(int id) {
    final list = List<int>.from(widget.value.zoneIds);
    if (list.contains(id)) {
      list.remove(id);
    } else {
      list.add(id);
    }
    widget.onChanged(widget.value.copyWith(zoneIds: list));
  }

  void _toggleDistrict(int id) {
    final list = List<int>.from(widget.value.districtIds);
    if (list.contains(id)) {
      list.remove(id);
    } else {
      list.add(id);
    }
    widget.onChanged(widget.value.copyWith(districtIds: list));
  }

  void _toggleSubgroup(int id) {
    final list = List<int>.from(widget.value.subgroupIds);
    if (list.contains(id)) {
      list.remove(id);
    } else {
      list.add(id);
    }
    widget.onChanged(widget.value.copyWith(subgroupIds: list));
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.value;
    final insufficient = widget.checkCredits &&
        _recipientCount != null && _balance != null && _recipientCount! > _balance!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8, runSpacing: 8,
          children: [
            _targetChip('all', 'All Members', Icons.people_outline),
            _targetChip('zones', 'By Zones', Icons.public),
            _targetChip('districts', 'By Districts', Icons.location_on_outlined),
            _targetChip('subgroups', 'By Sub Groups', Icons.groups_outlined),
          ],
        ),
        const SizedBox(height: 10),
        if (v.target == 'zones') _buildZones(),
        if (v.target == 'districts') _buildDistricts(),
        if (v.target == 'subgroups') _buildSubgroups(),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppColors.primaryLight,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Icon(Icons.people, size: 16, color: AppColors.primary),
                const SizedBox(width: 6),
                Text('Recipients: ', style: AppTextStyles.caption),
                Text(
                  _countLoading ? '…' : (_recipientCount?.toString() ?? '–'),
                  style: AppTextStyles.caption.copyWith(
                    color: AppColors.primary, fontWeight: FontWeight.w700,
                  ),
                ),
              ]),
              if (widget.checkCredits) ...[
                const SizedBox(height: 4),
                Row(children: [
                  const SizedBox(width: 6),
                  Text(
                    'Email balance: ',
                    style: AppTextStyles.caption,
                  ),
                  Text(
                    _balance?.toString() ?? '–',
                    style: AppTextStyles.caption.copyWith(
                      color: insufficient ? AppColors.error : AppColors.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ]),
                if (insufficient) ...[
                  const SizedBox(height: 4),
                  Text(
                    '⚠ Insufficient: need ${_recipientCount! - _balance!} more.',
                    style: AppTextStyles.caption.copyWith(
                      color: AppColors.error, fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _targetChip(String value, String label, IconData icon) {
    final selected = widget.value.target == value;
    return InkWell(
      onTap: () => _setTarget(value),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryLight : AppColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? AppColors.primary : AppColors.border),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: selected ? AppColors.primary : AppColors.textSecondary),
          const SizedBox(width: 6),
          Text(label, style: AppFonts.body(
            fontSize: 12,
            color: selected ? AppColors.primary : AppColors.textSecondary,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          )),
        ]),
      ),
    );
  }

  Widget _buildZones() {
    if (_zones.isEmpty) {
      return Padding(padding: const EdgeInsets.all(10),
          child: Text('Loading zones…', style: AppTextStyles.caption));
    }
    return _multiSelectBox(
      child: Wrap(spacing: 6, runSpacing: 6, children: [
        for (final z in _zones)
          _CheckChip(
            label: z.name,
            selected: widget.value.zoneIds.contains(z.id),
            onTap: () => _toggleZone(z.id),
          ),
      ]),
    );
  }

  Widget _buildDistricts() {
    if (_districts.isEmpty) {
      return Padding(padding: const EdgeInsets.all(10),
          child: Text('Loading districts…', style: AppTextStyles.caption));
    }
    return _multiSelectBox(
      child: Wrap(spacing: 6, runSpacing: 6, children: [
        for (final d in _districts)
          _CheckChip(
            label: 'D${d.number}',
            selected: widget.value.districtIds.contains(d.id),
            onTap: () => _toggleDistrict(d.id),
          ),
      ]),
    );
  }

  Widget _buildSubgroups() {
    if (_years.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppColors.warning.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text('No sub groups created yet. Create sub groups first.',
            style: AppTextStyles.caption.copyWith(color: AppColors.warning)),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('Year: ', style: AppTextStyles.caption.copyWith(
            color: AppColors.textSecondary, fontWeight: FontWeight.w600,
          )),
          const SizedBox(width: 6),
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.border),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<int>(
                  isExpanded: true,
                  value: widget.value.subgroupYearId,
                  items: [
                    for (final y in _years)
                      DropdownMenuItem(
                        value: y.id,
                        child: Text('${y.label}${y.isCurrent ? " (Current)" : ""}',
                            style: AppTextStyles.body),
                      ),
                  ],
                  onChanged: (v) {
                    if (v == null) return;
                    widget.onChanged(widget.value.copyWith(
                      subgroupYearId: v,
                      subgroupIds: const [],
                    ));
                    _loadSubgroups(v);
                  },
                ),
              ),
            ),
          ),
        ]),
        const SizedBox(height: 8),
        if (_subgroups.isEmpty)
          Padding(padding: const EdgeInsets.all(10),
              child: Text('No sub groups for this year.',
                  style: AppTextStyles.caption))
        else
          _multiSelectBox(
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final sg in _subgroups)
                _CheckChip(
                  label: '${sg.groupName} (${sg.memberCount})',
                  selected: widget.value.subgroupIds.contains(sg.id),
                  onTap: () => _toggleSubgroup(sg.id),
                ),
            ]),
          ),
      ],
    );
  }

  Widget _multiSelectBox({required Widget child}) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 200),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.all(10),
      child: SingleChildScrollView(child: child),
    );
  }
}

class _CheckChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _CheckChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryLight : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? AppColors.primary : AppColors.border),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(
            selected ? Icons.check_box : Icons.check_box_outline_blank,
            size: 14,
            color: selected ? AppColors.primary : AppColors.textSecondary,
          ),
          const SizedBox(width: 4),
          Text(label, style: AppTextStyles.caption.copyWith(
            color: selected ? AppColors.primary : AppColors.textPrimary,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
          )),
        ]),
      ),
    );
  }
}

class _Zone {
  final int id;
  final String name;
  const _Zone(this.id, this.name);
  factory _Zone.fromJson(Map<String, dynamic> j) => _Zone(
        j['id'] as int? ?? 0,
        j['zoneName']?.toString() ?? j['name']?.toString() ?? '',
      );
}

class _District {
  final int id;
  final String number;
  const _District(this.id, this.number);
  factory _District.fromJson(Map<String, dynamic> j) => _District(
        j['id'] as int? ?? 0,
        j['districtNumber']?.toString() ?? '',
      );
}

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

class _SubGroup {
  final int id;
  final String groupName;
  final int memberCount;
  const _SubGroup({required this.id, required this.groupName, required this.memberCount});
  factory _SubGroup.fromJson(Map<String, dynamic> j) => _SubGroup(
        id: j['id'] as int? ?? 0,
        groupName: j['groupName']?.toString() ?? '',
        memberCount: j['memberCount'] as int? ?? 0,
      );
}

extension _FirstOrNullExt<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
