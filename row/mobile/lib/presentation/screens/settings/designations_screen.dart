import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_button.dart';
import '../../widgets/common/custom_text_field.dart';
import '../../widgets/common/confirmation_dialog.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/custom_drawer.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _Designation {
  final int id;
  final String designationName;
  final int? sortOrder;

  const _Designation({
    required this.id,
    required this.designationName,
    this.sortOrder,
  });

  factory _Designation.fromJson(Map<String, dynamic> j) => _Designation(
        id: j['id'] as int? ?? 0,
        designationName: j['designationName'] as String? ?? j['name'] as String? ?? '',
        sortOrder: j['sortOrder'] as int?,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class DesignationsScreen extends StatefulWidget {
  const DesignationsScreen({super.key});

  @override
  State<DesignationsScreen> createState() => _DesignationsScreenState();
}

class _DesignationsScreenState extends State<DesignationsScreen> {
  final _api = ApiClient();

  List<_Designation> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/designations',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data ?? {};
      final rawItems = data['items'] as List<dynamic>? ?? (data['data'] as List<dynamic>?) ?? [];
      setState(() {
        _items = rawItems.map((e) => _Designation.fromJson(e as Map<String, dynamic>)).toList();
        _items.sort((a, b) => (a.sortOrder ?? 999).compareTo(b.sortOrder ?? 999));
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _delete(int id) async {
    try {
      await _api.delete('/api/designations/$id');
      setState(() => _items.removeWhere((d) => d.id == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Designation deleted'), backgroundColor: AppColors.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e'), backgroundColor: AppColors.error),
        );
      }
    }
  }

  void _showForm({_Designation? existing}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => _DesignationFormSheet(existing: existing, onSaved: _fetch),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Designations'),
      drawer: const CustomDrawer(),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.primary,
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _loading
          ? const ShimmerList(itemCount: 8, itemHeight: 60)
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetch)
              : _items.isEmpty
                  ? EmptyStateWidget(
                      title: 'No Designations',
                      subtitle: 'Tap + to add a new designation.',
                      icon: Icons.badge_outlined,
                      actionLabel: 'Add Designation',
                      onAction: () => _showForm(),
                    )
                  : RefreshIndicator(
                      color: AppColors.primary,
                      onRefresh: _fetch,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (ctx, i) {
                          final item = _items[i];
                          return Card(
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: const BorderSide(color: AppColors.border),
                            ),
                            color: AppColors.surface,
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                              leading: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: AppColors.primaryLight,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  '${i + 1}',
                                  style: AppTextStyles.caption.copyWith(color: AppColors.primary, fontWeight: FontWeight.w600),
                                ),
                              ),
                              title: Text(item.designationName, style: AppTextStyles.bodyMedium),
                              subtitle: item.sortOrder != null
                                  ? Text('Sort order: ${item.sortOrder}', style: AppTextStyles.caption)
                                  : null,
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(
                                    icon: const Icon(Icons.edit_outlined, size: 18, color: AppColors.primary),
                                    onPressed: () => _showForm(existing: item),
                                    constraints: const BoxConstraints(),
                                    padding: const EdgeInsets.all(6),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                                    onPressed: () async {
                                      final ok = await ConfirmationDialog.show(
                                        context,
                                        title: 'Delete Designation',
                                        message: 'Delete "${item.designationName}"?',
                                      );
                                      if (ok) _delete(item.id);
                                    },
                                    constraints: const BoxConstraints(),
                                    padding: const EdgeInsets.all(6),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

// ---------------------------------------------------------------------------
// Form Sheet
// ---------------------------------------------------------------------------
class _DesignationFormSheet extends StatefulWidget {
  final _Designation? existing;
  final VoidCallback onSaved;

  const _DesignationFormSheet({this.existing, required this.onSaved});

  @override
  State<_DesignationFormSheet> createState() => _DesignationFormSheetState();
}

class _DesignationFormSheetState extends State<_DesignationFormSheet> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  final _nameCtrl = TextEditingController();
  final _sortOrderCtrl = TextEditingController();
  bool _saving = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      _nameCtrl.text = widget.existing!.designationName;
      _sortOrderCtrl.text = widget.existing!.sortOrder?.toString() ?? '';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _sortOrderCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final body = {
      'designationName': _nameCtrl.text.trim(),
      if (_sortOrderCtrl.text.trim().isNotEmpty) 'sortOrder': int.tryParse(_sortOrderCtrl.text.trim()),
    };

    try {
      if (_isEditing) {
        await _api.put('/api/designations/${widget.existing!.id}', body: body);
      } else {
        await _api.post('/api/designations', body: body);
      }
      if (mounted) {
        Navigator.of(context).pop();
        widget.onSaved();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Designation updated' : 'Designation created'),
            backgroundColor: AppColors.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e'), backgroundColor: AppColors.error),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40, height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              Text(_isEditing ? 'Edit Designation' : 'New Designation', style: AppTextStyles.h3),
              const SizedBox(height: 16),
              CustomTextField(
                label: 'Designation Name *',
                controller: _nameCtrl,
                hint: 'e.g. District Governor',
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Name is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Sort Order',
                controller: _sortOrderCtrl,
                hint: '1, 2, 3...',
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
              const SizedBox(height: 16),
              CustomButton(
                label: _isEditing ? 'Update' : 'Create',
                onPressed: _save,
                isLoading: _saving,
                fullWidth: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
