import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/custom_button.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/rotary_year_bar.dart';
import 'club_website_contact_form_screen.dart';

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({required this.id, required this.yearLabel, this.isCurrent = false});

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? j['label']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _Contact {
  final int id;
  final String email;
  final String phone;
  final bool isActive;
  const _Contact({required this.id, required this.email, required this.phone, required this.isActive});

  factory _Contact.fromJson(Map<String, dynamic> j) => _Contact(
        id: (j['id'] as int?) ?? 0,
        email: j['email']?.toString() ?? '',
        phone: j['phone']?.toString() ?? '',
        isActive: _asBool(j['isActive'] ?? true),
      );
}

class ClubWebsiteContactDetailsScreen extends StatefulWidget {
  final int clubId;
  const ClubWebsiteContactDetailsScreen({super.key, required this.clubId});

  @override
  State<ClubWebsiteContactDetailsScreen> createState() => _ClubWebsiteContactDetailsScreenState();
}

class _ClubWebsiteContactDetailsScreenState extends State<ClubWebsiteContactDetailsScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_RotaryYear> _years = [];
  int? _selectedYearId;
  _Contact? _contact;
  bool _loadingContact = false;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() { _loading = true; _error = null; });
    try {
      final allResp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final years = (allResp.data ?? [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
      final current = years.firstWhere((y) => y.isCurrent, orElse: () => years.isNotEmpty ? years.first : const _RotaryYear(id: 0, yearLabel: ''));
      setState(() {
        _years = years;
        _selectedYearId = current.id != 0 ? current.id : null;
        _loading = false;
      });
      if (_selectedYearId != null) await _fetchContact(_selectedYearId!);
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _fetchContact(int yearId) async {
    setState(() { _loadingContact = true; _contact = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/contact_details',
        queryParams: {'yearId': yearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? []).map((e) => _Contact.fromJson(e as Map<String, dynamic>)).toList();
      setState(() { _contact = list.isNotEmpty ? list.first : null; _loadingContact = false; });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() { _contact = null; _loadingContact = false; });
      } else {
        setState(() { _loadingContact = false; });
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to load: ${e.message}')));
      }
    } catch (_) {
      setState(() { _loadingContact = false; });
    }
  }

  Future<void> _openForm({_Contact? existing}) async {
    if (_selectedYearId == null) return;
    final initial = existing == null
        ? null
        : ClubContactFormInitial(
            id: existing.id,
            email: existing.email,
            phone: existing.phone,
            isActive: existing.isActive,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ClubWebsiteContactFormScreen(
          clubId: widget.clubId,
          yearId: _selectedYearId!,
          initial: initial,
        ),
      ),
    );
    if (saved == true && mounted && _selectedYearId != null) {
      await _fetchContact(_selectedYearId!);
    }
  }

  Future<void> _confirmDelete(_Contact c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Contact Detail'),
        content: const Text('Are you sure? This action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/website-data/contact_details/${c.id}');
      if (mounted && _selectedYearId != null) await _fetchContact(_selectedYearId!);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  Future<void> _toggleActive(_Contact c) async {
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/contact_details/${c.id}',
        body: {'email': c.email, 'phone': c.phone, 'isActive': !c.isActive},
      );
      if (mounted && _selectedYearId != null) await _fetchContact(_selectedYearId!);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Update failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isClubAdminOf(widget.clubId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Contact Details'),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _loadInitial)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_years.isNotEmpty) ...[
            RotaryYearBar<int>(
              value: _selectedYearId,
              margin: EdgeInsets.zero,
              options: [
                for (final y in _years)
                  RotaryYearOption(value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
              ],
              onChanged: (v) {
                setState(() => _selectedYearId = v);
                if (v != null) _fetchContact(v);
              },
            ),
            const SizedBox(height: 16),
          ],
          if (_loadingContact)
            const Center(child: Padding(padding: EdgeInsets.all(40), child: const CircularProgressIndicator(color: AppColors.primary)))
          else if (_contact == null)
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Expanded(
                    child: EmptyStateWidget(
                      title: 'No contact details yet',
                      subtitle: canManage ? 'Tap "Add Contact" to add details.' : 'No contact details added yet.',
                      icon: Icons.contact_phone_outlined,
                    ),
                  ),
                  if (canManage)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 24),
                      child: CustomButton(
                        label: 'Add Contact',
                        icon: Icons.add,
                        onPressed: () => _openForm(),
                      ),
                    ),
                ],
              ),
            )
          else
            _ContactCard(
              contact: _contact!,
              canManage: canManage,
              onEdit: () => _openForm(existing: _contact),
              onDelete: () => _confirmDelete(_contact!),
              onToggleActive: () => _toggleActive(_contact!),
            ),
        ],
      ),
    );
  }
}

class _ContactCard extends StatelessWidget {
  final _Contact contact;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onToggleActive;

  const _ContactCard({
    required this.contact,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
    required this.onToggleActive,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: contact.isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    contact.isActive ? 'Active' : 'Inactive',
                    style: AppTextStyles.caption.copyWith(
                      color: contact.isActive ? AppColors.success : AppColors.textSecondary,
                    ),
                  ),
                ),
                if (canManage)
                  Wrap(
                    spacing: 4,
                    children: [
                      IconButton(
                        icon: Icon(contact.isActive ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20),
                        onPressed: onToggleActive,
                        tooltip: contact.isActive ? 'Deactivate' : 'Activate',
                      ),
                      IconButton(icon: const Icon(Icons.edit_outlined, size: 20), onPressed: onEdit, tooltip: 'Edit'),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.error),
                        onPressed: onDelete,
                        tooltip: 'Delete',
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 16),
            _IconRow(icon: Icons.mail_outline, label: 'Email', value: contact.email),
            const SizedBox(height: 12),
            _IconRow(icon: Icons.phone_outlined, label: 'Phone', value: contact.phone),
          ],
        ),
      ),
    );
  }
}

class _IconRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _IconRow({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 16, color: AppColors.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary)),
              const SizedBox(height: 2),
              Text(value, style: AppTextStyles.bodyMedium),
            ],
          ),
        ),
      ],
    );
  }
}
