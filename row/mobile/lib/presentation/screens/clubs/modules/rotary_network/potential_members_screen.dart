import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../../core/features/feature_controller.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_response.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../core/utils/validators.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';
import '../../../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Prospect pipeline stages (N3), the same list as the admin's `PROSPECT_STAGES`.
const prospectStages = ['inquiry', 'contacted', 'invited', 'attended', 'proposed', 'approved', 'inducted'];
String stageLabel(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

class PotentialMembersScreen extends StatefulWidget {
  final int clubId;
  final bool viewOnly;
  const PotentialMembersScreen({
    super.key,
    required this.clubId,
    this.viewOnly = false,
  });

  @override
  State<PotentialMembersScreen> createState() => _PotentialMembersScreenState();
}

class _PotentialMembersScreenState extends State<PotentialMembersScreen> {
  final ApiClient _api = ApiClient();
  List<dynamic> _items = [];
  bool _loading = true;
  int _page = 1;
  int _totalPages = 1;
  final _searchCtrl = TextEditingController();

  bool get _canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch({int page = 1}) async {
    setState(() { _loading = true; _page = page; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/clubs/${widget.clubId}/potential-members',
        queryParams: {
          'page': page,
          'pageSize': 20,
          if (_searchCtrl.text.trim().isNotEmpty) 'search': _searchCtrl.text.trim(),
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => j as Map<String, dynamic>);
      setState(() { _items = paged.items; _totalPages = paged.totalPages; _loading = false; });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  Future<void> _delete(int id) async {
    final ok = await ConfirmationDialog.show(context, title: 'Delete', message: 'Delete this potential member?');
    if (ok != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/potential-members/$id');
      SnackbarUtils.showSuccess(context, 'Deleted');
      _fetch(page: _page);
    } catch (_) {
      SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  void _openForm({Map<String, dynamic>? item}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PotentialMemberForm(
        clubId: widget.clubId,
        item: item,
        onSaved: () => _fetch(page: _page),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canManage = _canManage;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Potential Members'),
      floatingActionButton: canManage
          ? FloatingActionButton(
              onPressed: () => _openForm(),
              backgroundColor: AppColors.primary,
              child: const Icon(Icons.add, color: Colors.white),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _searchCtrl,
              decoration: InputDecoration(
                hintText: 'Search potential members...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchCtrl.text.isNotEmpty
                    ? IconButton(icon: const Icon(Icons.clear), onPressed: () { _searchCtrl.clear(); _fetch(); })
                    : null,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
              ),
              onSubmitted: (_) => _fetch(),
            ),
          ),
          Expanded(
            child: _loading
                ? const LoadingWidget()
                : _items.isEmpty
                    ? const EmptyStateWidget(icon: Icons.person_add_alt_1_outlined, title: 'No Potential Members', subtitle: 'Add your first potential member.')
                    : RefreshIndicator(
                        color: AppColors.primary,
                        onRefresh: () => _fetch(page: 1),
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(12, 0, 12, 80),
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) {
                            final m = _items[i] as Map<String, dynamic>;
                            return _MemberCard(
                              item: m,
                              canManage: canManage,
                              onEdit: () => _openForm(item: m),
                              onDelete: () => _delete(m['id'] as int),
                            );
                          },
                        ),
                      ),
          ),
          if (_totalPages > 1)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.chevron_left),
                    onPressed: _page > 1 ? () => _fetch(page: _page - 1) : null,
                  ),
                  Text('$_page / $_totalPages', style: AppTextStyles.body),
                  IconButton(
                    icon: const Icon(Icons.chevron_right),
                    onPressed: _page < _totalPages ? () => _fetch(page: _page + 1) : null,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  final Map<String, dynamic> item;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  const _MemberCard({
    required this.item,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),

      ),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: AppColors.primaryLight,
            child: Text(
              (item['name'] as String? ?? '?').isNotEmpty ? (item['name'] as String)[0].toUpperCase() : '?',
              style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item['name'] as String? ?? 'Unknown', style: AppTextStyles.bodySemiBold),
                if (context.watch<FeatureController>().isOn('contacts_growth') && item['stage'] != null)
                  Text(stageLabel(item['stage'] as String), style: AppTextStyles.caption.copyWith(color: AppColors.primary)),
                if (item['email'] != null)
                  Text(item['email'] as String, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
                if (item['mobileNumber'] != null)
                  Text(item['mobileNumber'] as String, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ),
          if (canManage) ...[
            IconButton(icon: const Icon(Icons.edit_outlined, size: 20), color: AppColors.primary, onPressed: onEdit),
            IconButton(icon: const Icon(Icons.delete_outline, size: 20), color: AppColors.error, onPressed: onDelete),
          ],
        ],
      ),
    );
  }
}

// ── Add/Edit form ─────────────────────────────────────────────────────────────

class _PotentialMemberForm extends StatefulWidget {
  final int clubId;
  final Map<String, dynamic>? item;
  final VoidCallback onSaved;
  const _PotentialMemberForm({required this.clubId, this.item, required this.onSaved});

  @override
  State<_PotentialMemberForm> createState() => _PotentialMemberFormState();
}

class _PotentialMemberFormState extends State<_PotentialMemberForm> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _mobileCtrl = TextEditingController();
  final _referenceCtrl = TextEditingController();
  final _notesCtrl = TextEditingController();
  String _stage = 'inquiry';
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    if (_isEdit) {
      _nameCtrl.text = widget.item!['name'] as String? ?? '';
      _emailCtrl.text = widget.item!['email'] as String? ?? '';
      _mobileCtrl.text = widget.item!['mobileNumber'] as String? ?? '';
      _referenceCtrl.text = widget.item!['referenceDetails'] as String? ?? '';
      _notesCtrl.text = widget.item!['notes'] as String? ?? '';
      final stage = widget.item!['stage'] as String?;
      if (prospectStages.contains(stage)) _stage = stage!;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose(); _emailCtrl.dispose(); _mobileCtrl.dispose(); _referenceCtrl.dispose(); _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final pipeline = context.read<FeatureController>().isOn('contacts_growth');
    setState(() => _saving = true);
    final body = {
      'name': _nameCtrl.text.trim(),
      'email': _emailCtrl.text.trim(),
      'mobileNumber': _mobileCtrl.text.trim(),
      'referenceDetails': _referenceCtrl.text.trim(),
      if (pipeline) 'stage': _stage,
      if (pipeline) 'notes': _notesCtrl.text.trim(),
    };
    try {
      if (_isEdit) {
        await _api.put('/api/clubs/${widget.clubId}/potential-members/${widget.item!['id']}', body: body);
      } else {
        await _api.post('/api/clubs/${widget.clubId}/potential-members', body: body);
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, _isEdit ? 'Updated' : 'Added');
        Navigator.pop(context);
        widget.onSaved();
      }
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_isEdit ? 'Edit Potential Member' : 'Add Potential Member', style: AppTextStyles.h3),
              const SizedBox(height: 16),
              CustomTextField(
                controller: _nameCtrl,
                label: 'Name *',
                hint: 'Full name',
                validator: (v) => Validators.required(v, 'Name'),
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: _emailCtrl,
                label: 'Email',
                hint: 'Email address',
                keyboardType: TextInputType.emailAddress,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? null : Validators.email(v),
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: _mobileCtrl,
                label: 'Mobile Number',
                hint: '10-digit mobile number',
                keyboardType: TextInputType.phone,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? null : Validators.phone(v),
              ),
              const SizedBox(height: 12),
              CustomTextField(controller: _referenceCtrl, label: 'Reference Details', hint: 'Reference (optional)'),
              if (context.watch<FeatureController>().isOn('contacts_growth')) ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _stage,
                  decoration: const InputDecoration(labelText: 'Stage', border: OutlineInputBorder()),
                  items: [for (final s in prospectStages) DropdownMenuItem(value: s, child: Text(stageLabel(s)))],
                  onChanged: (v) => setState(() => _stage = v ?? _stage),
                ),
                const SizedBox(height: 12),
                CustomTextField(controller: _notesCtrl, label: 'Notes', hint: 'Notes (optional)'),
              ],
              const SizedBox(height: 20),
              SizedBox(width: double.infinity, child: CustomButton(label: _isEdit ? 'Update' : 'Add', isLoading: _saving, onPressed: _save)),
            ],
          ),
        ),
      ),
    );
  }
}
