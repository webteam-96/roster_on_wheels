import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../presentation/widgets/common/custom_app_bar.dart';
import '../../../../../presentation/widgets/common/custom_button.dart';
import '../../../../../presentation/widgets/common/custom_text_field.dart';
import '../../../../../presentation/widgets/common/loading_widget.dart';
import '../../../../../presentation/widgets/common/empty_state_widget.dart';
import '../../../../../presentation/widgets/common/pagination_widget.dart';
import '../../../../../presentation/widgets/common/confirmation_dialog.dart';
import '../../../../../presentation/widgets/detail/detail_widgets.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class MassEmailsScreen extends StatefulWidget {
  final int clubId;
  final bool embedded;
  final bool viewOnly;
  const MassEmailsScreen({
    super.key,
    required this.clubId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<MassEmailsScreen> createState() => _MassEmailsScreenState();
}

class _MassEmailsScreenState extends State<MassEmailsScreen> {
  final _api = ApiClient();
  final _searchCtrl = TextEditingController();

  List<dynamic> _emails = [];
  bool _loading = true;
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  int? _emailRemaining;
  String _statusFilter = 'All';

  static const List<String> _statusOptions = [
    'All',
    'Draft',
    'Sending',
    'Sent',
    'Failed',
  ];

  @override
  void initState() {
    super.initState();
    _loadEmails();
    _loadCreditBalance();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadCreditBalance() async {
    try {
      final resp = await _api.get(
        '/api/credit-management/club/${widget.clubId}/balance',
        fromJson: (j) => j,
      );
      final data = resp.data;
      if (data is Map<String, dynamic> && mounted) {
        setState(() {
          _emailRemaining = (data['emailRemaining'] as num?)?.toInt();
        });
      }
    } catch (_) {
      // Credit display is optional; silently ignore.
    }
  }

  Future<void> _loadEmails({int page = 1}) async {
    setState(() => _loading = true);
    try {
      final qp = <String, dynamic>{
        'page': page,
        'pageSize': 20,
      };
      if (_statusFilter != 'All') {
        qp['status'] = _statusFilter;
      }
      if (_searchCtrl.text.trim().isNotEmpty) {
        qp['search'] = _searchCtrl.text.trim();
      }
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/mass-emails',
        queryParams: qp,
        fromJson: (json) => json,
      );
      if (resp.data != null) {
        // Backend returns an array, not a paged envelope.
        final data = resp.data;
        if (data is List) {
          setState(() {
            _emails = data;
            _currentPage = 1;
            _totalPages = 1;
            _totalCount = data.length;
          });
        } else if (data is Map<String, dynamic>) {
          // Backend returns { items, totalCount, page, pageSize } — no
          // currentPage/totalPages — so track the requested page and derive
          // totalPages from totalCount.
          final totalCount = data['totalCount'] as int? ?? 0;
          setState(() {
            _emails = data['items'] as List<dynamic>? ?? [];
            _currentPage = data['page'] as int? ?? page;
            _totalPages = totalCount == 0 ? 1 : ((totalCount + 20 - 1) ~/ 20);
            _totalCount = totalCount;
          });
        }
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to load emails');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openCompose({int? editId}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ComposeEmailScreen(
          clubId: widget.clubId,
          editId: editId,
          onSent: () {
            _loadEmails(page: 1);
            _loadCreditBalance();
          },
        ),
      ),
    );
  }

  Future<void> _showDetailDialog(Map<String, dynamic> email) async {
    final emailId = email['id'] ?? email['emailId'];
    if (emailId is! int) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _MassEmailDetailScreen(
          clubId: widget.clubId,
          emailId: emailId,
          onChanged: () {
            _loadEmails(page: _currentPage);
            _loadCreditBalance();
          },
        ),
      ),
    );
  }

  Future<void> _sendDraft(Map<String, dynamic> email) async {
    final emailId = email['id'] ?? email['emailId'];
    if (emailId == null) return;

    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Send Email',
      message: 'Are you sure you want to send this email to all recipients?',
    );
    if (confirmed != true) return;

    try {
      await _api.post(
        '/api/clubs/${widget.clubId}/mass-emails/$emailId/send',
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Email sent successfully');
        _loadEmails(page: _currentPage);
        _loadCreditBalance();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to send email');
    }
  }

  Future<void> _retryEmail(Map<String, dynamic> email) async {
    final emailId = email['id'] ?? email['emailId'];
    if (emailId == null) return;

    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Retry Sending',
      message: 'Are you sure you want to send this email to all recipients?',
    );
    if (confirmed != true) return;

    try {
      await _api.post(
        '/api/clubs/${widget.clubId}/mass-emails/$emailId/send',
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Email retry initiated');
        _loadEmails(page: _currentPage);
        _loadCreditBalance();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to retry email');
    }
  }

  Future<void> _deleteEmail(Map<String, dynamic> email) async {
    final emailId = email['id'] ?? email['emailId'];
    if (emailId == null) return;

    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Delete Draft',
      message: 'Are you sure you want to delete this draft email?',
    );
    if (confirmed != true) return;

    try {
      await _api.delete(
        '/api/clubs/${widget.clubId}/mass-emails/$emailId',
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Draft deleted');
        _loadEmails(page: _currentPage);
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete draft');
    }
  }

  Color _statusColor(String? status) {
    switch (status?.toLowerCase()) {
      case 'sent': return Colors.green;
      case 'failed': return Colors.red;
      case 'draft': return Colors.grey;
      case 'sending': return Colors.blue;
      default: return Colors.grey;
    }
  }

  String _recipientTypeLabel(dynamic value) {
    switch (value) {
      case 1: return 'All Members';
      case 2: return 'Subgroup';
      case 3: return 'Select Members';
      default: return value?.toString() ?? '-';
    }
  }

  /// Per-level gating: only club admins of THIS club can manage.
  bool get canManage =>
      !widget.viewOnly &&
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.embedded
          ? null
          : const CustomAppBar(
              title: 'Mass Emails',
            ),
      // Compact circular FAB to match the other list modules (announcements,
      // newsletters, documents) — the wide "Compose" extended FAB collided
      // with the full-width Load More footer.
      floatingActionButton: !canManage
          ? null
          : FloatingActionButton(
              onPressed: () => _openCompose(),
              backgroundColor: AppColors.primary,
              tooltip: 'Compose',
              child: const Icon(Icons.add, color: Colors.white),
            ),
      body: _loading
          ? const LoadingWidget()
          : Column(
              children: [
                // Credit balance + status filter bar
                _buildHeaderBar(),
                Expanded(
                  child: _emails.isEmpty
                      ? const EmptyStateWidget(
                          title: 'No mass emails sent yet')
                      : RefreshIndicator(
                          onRefresh: () async {
                            await _loadEmails(page: _currentPage);
                            await _loadCreditBalance();
                          },
                          // Pagination lives as the last list item (like the
                          // sibling modules) so it scrolls with the content and
                          // never collides with the FAB. Bottom inset clears the
                          // floating button for the last card.
                          child: ListView.separated(
                            padding: (EdgeInsets.fromLTRB(
                                16, 16, 16, canManage ? 88 : 16)).add(const EdgeInsets.only(bottom: 88)),
                            itemCount: _emails.length + 1,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 8),
                            itemBuilder: (_, i) {
                              if (i == _emails.length) {
                                return PaginationWidget(
                                  currentPage: _currentPage,
                                  totalPages: _totalPages,
                                  totalCount: _totalCount,
                                  onLoadMore: () =>
                                      _loadEmails(page: _currentPage + 1),
                                );
                              }
                              return _buildEmailCard(_emails[i]);
                            },
                          ),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _buildHeaderBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        children: [
          Row(
            children: [
              // Credit balance chip
              if (_emailRemaining != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: (_emailRemaining ?? 0) > 0
                        ? AppColors.primaryLight
                        : AppColors.error.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        (_emailRemaining ?? 0) > 0
                            ? Icons.mail_outline
                            : Icons.warning_amber_rounded,
                        size: 14,
                        color: (_emailRemaining ?? 0) > 0
                            ? AppColors.primary
                            : AppColors.error,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Credits: $_emailRemaining',
                        style: AppTextStyles.caption.copyWith(
                          color: (_emailRemaining ?? 0) > 0
                              ? AppColors.primary
                              : AppColors.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              const Spacer(),
              // Status filter dropdown
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey[300]!),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: _statusFilter,
                    isDense: true,
                    icon: const Icon(Icons.filter_list, size: 18),
                    style: AppTextStyles.caption
                        .copyWith(color: Colors.grey[700]),
                    items: _statusOptions
                        .map((s) => DropdownMenuItem(
                              value: s,
                              child: Text(s),
                            ))
                        .toList(),
                    onChanged: (val) {
                      if (val != null && val != _statusFilter) {
                        setState(() => _statusFilter = val);
                        _loadEmails(page: 1);
                      }
                    },
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Search bar
          TextField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              hintText: 'Search by subject...',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        _searchCtrl.clear();
                        _loadEmails(page: 1);
                      },
                    )
                  : null,
            ),
            onSubmitted: (_) => _loadEmails(page: 1),
            onChanged: (_) => setState(() {}),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailCard(Map<String, dynamic> email) {
    final status = email['status']?.toString() ?? 'Draft';
    final statusLower = status.toLowerCase();
    final totalRecipients =
        (email['totalRecipients'] ?? email['recipientCount']) as int? ?? 0;
    final sentCount = email['sentCount'] as int? ?? 0;
    final failedCount = email['failedCount'] as int? ?? 0;
    final notDelivered = totalRecipients - sentCount - failedCount;
    final recipientType = email['recipientType'];
    final isDraft = statusLower == 'draft';
    final sentAt = (email['sentDate'] ??
            email['createdDate'] ??
            email['sentAt'])
        ?.toString();

    return Card(
      elevation: 0,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(20))),
      child: InkWell(
        onTap: () => _showDetailDialog(email),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      email['subject']?.toString() ?? 'No Subject',
                      style: AppTextStyles.body
                          .copyWith(fontWeight: FontWeight.w600),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: _statusColor(status).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      status,
                      style: AppTextStyles.caption.copyWith(
                        color: _statusColor(status),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  // Popup menu
                  PopupMenuButton<String>(
                    padding: EdgeInsets.zero,
                    iconSize: 20,
                    icon: Icon(Icons.more_vert,
                        size: 20, color: Colors.grey[600]),
                    onSelected: (action) {
                      switch (action) {
                        case 'view':
                          _showDetailDialog(email);
                          break;
                        case 'edit':
                          final emailId = email['id'] ?? email['emailId'];
                          if (emailId != null) {
                            _openCompose(editId: emailId as int);
                          }
                          break;
                        case 'send':
                          _sendDraft(email);
                          break;
                        case 'delete':
                          _deleteEmail(email);
                          break;
                        case 'retry':
                          _retryEmail(email);
                          break;
                      }
                    },
                    itemBuilder: (_) => [
                      const PopupMenuItem(
                        value: 'view',
                        child: ListTile(
                          dense: true,
                          leading: Icon(Icons.visibility, size: 18),
                          title: Text('View Details'),
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                      if (canManage)
                        const PopupMenuItem(
                          value: 'edit',
                          child: ListTile(
                            dense: true,
                            leading: Icon(Icons.edit, size: 18),
                            title: Text('Edit & Resend'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      if (isDraft && canManage)
                        const PopupMenuItem(
                          value: 'send',
                          child: ListTile(
                            dense: true,
                            leading: Icon(Icons.send, size: 18),
                            title: Text('Send'),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      if (isDraft && canManage)
                        const PopupMenuItem(
                          value: 'delete',
                          child: ListTile(
                            dense: true,
                            leading:
                                Icon(Icons.delete, size: 18, color: Colors.red),
                            title: Text('Delete',
                                style: TextStyle(color: Colors.red)),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                      if (statusLower == 'failed' && canManage)
                        const PopupMenuItem(
                          value: 'retry',
                          child: ListTile(
                            dense: true,
                            leading:
                                Icon(Icons.refresh, size: 18, color: Colors.red),
                            title: Text('Retry',
                                style: TextStyle(color: Colors.red)),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.people_outline,
                      size: 16, color: Colors.grey),
                  const SizedBox(width: 4),
                  Text(
                      '$totalRecipients (${_recipientTypeLabel(recipientType)})',
                      style: AppTextStyles.caption
                          .copyWith(color: Colors.grey[600])),
                  if (sentAt != null) ...[
                    const SizedBox(width: 16),
                    const Icon(Icons.access_time,
                        size: 16, color: Colors.grey),
                    const SizedBox(width: 4),
                    Text(
                        DateFormatter.toDisplay(
                            DateTime.tryParse(sentAt)),
                        style: AppTextStyles.caption
                            .copyWith(color: Colors.grey[600])),
                  ],
                ],
              ),
              // Sent / Failed / Not Delivered counts (hide for Draft)
              if (!isDraft) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    Text(
                      'Sent: $sentCount',
                      style: AppTextStyles.caption.copyWith(
                        color: Colors.green[700],
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      'Failed: $failedCount',
                      style: AppTextStyles.caption.copyWith(
                        color: failedCount > 0 ? Colors.red[700] : Colors.grey[600],
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      'Not Delivered: ${notDelivered > 0 ? notDelivered : 0}',
                      style: AppTextStyles.caption.copyWith(
                        color: notDelivered > 0 ? Colors.orange[700] : Colors.grey[600],
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
              if (isDraft) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    Text('Sent: ---', style: AppTextStyles.caption.copyWith(color: Colors.grey[500])),
                    const SizedBox(width: 12),
                    Text('Failed: ---', style: AppTextStyles.caption.copyWith(color: Colors.grey[500])),
                    const SizedBox(width: 12),
                    Text('Not Delivered: ---', style: AppTextStyles.caption.copyWith(color: Colors.grey[500])),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// -- Email Detail Dialog with summary cards and recipients table -------------

// ---------------------------------------------------------------------------
// Detail Screen — full-screen view-only display of a single mass email.
// Mirrors the web's `/clubs/{id}/mass-emails/{emailId}` page: header with
// subject + status chip, an Email Info section (From, Reply To, Recipients,
// Date), a 4-card stats grid (Total / Sent / Failed / Not Delivered) for
// non-Draft emails, the Email Body, and a Recipients list. A "Retry Failed"
// button appears in the AppBar for admins when status is Failed.
// ---------------------------------------------------------------------------
class _MassEmailDetailScreen extends StatefulWidget {
  final int clubId;
  final int emailId;
  final VoidCallback onChanged;
  const _MassEmailDetailScreen({
    required this.clubId,
    required this.emailId,
    required this.onChanged,
  });

  @override
  State<_MassEmailDetailScreen> createState() => _MassEmailDetailScreenState();
}

class _MassEmailDetailScreenState extends State<_MassEmailDetailScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _email;
  List<dynamic> _recipients = [];
  bool _loading = true;
  bool _retrying = false;
  String? _error;

  bool get _canManage =>
      Provider.of<AuthProvider>(context, listen: false)
          .isClubAdminOf(widget.clubId);

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detailResp = await _api.get(
        '/api/clubs/${widget.clubId}/mass-emails/${widget.emailId}',
        fromJson: (j) => j,
      );
      List<dynamic> recipients = [];
      try {
        final rResp = await _api.get(
          '/api/clubs/${widget.clubId}/mass-emails/${widget.emailId}/recipients',
          fromJson: (j) => j,
        );
        if (rResp.data is List) {
          recipients = rResp.data as List<dynamic>;
        } else if (rResp.data is Map<String, dynamic>) {
          recipients = (rResp.data as Map<String, dynamic>)['items']
                  as List<dynamic>? ??
              [];
        }
      } catch (_) {
        // Recipients endpoint optional; ignore if it fails.
      }
      if (!mounted) return;
      final detail = detailResp.data is Map<String, dynamic>
          ? detailResp.data as Map<String, dynamic>
          : <String, dynamic>{};
      setState(() {
        _email = detail;
        _recipients = recipients;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to load: $e';
        _loading = false;
      });
    }
  }

  Future<void> _retry() async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: 'Retry Failed Emails',
      message:
          'This will retry sending to all failed recipients. Credits will be deducted.',
    );
    if (confirmed != true) return;
    setState(() => _retrying = true);
    try {
      await _api.post(
        '/api/clubs/${widget.clubId}/mass-emails/${widget.emailId}/send',
      );
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Retrying failed emails');
        widget.onChanged();
        await Future.delayed(const Duration(seconds: 2));
        if (mounted) await _fetch();
      }
    } catch (e) {
      if (mounted) {
        SnackbarUtils.showError(context, 'Failed to retry');
      }
    } finally {
      if (mounted) setState(() => _retrying = false);
    }
  }

  String _recipientTypeLabel(dynamic value) {
    final v = value is int ? value : int.tryParse('$value');
    switch (v) {
      case 1:
        return 'All Members';
      case 2:
        return 'Sub-Groups';
      case 3:
        return 'Select Members';
      default:
        return value?.toString() ?? '-';
    }
  }

  @override
  Widget build(BuildContext context) {
    final email = _email;
    final statusLower = (email?['status']?.toString() ?? '').toLowerCase();
    final isFailed = statusLower == 'failed';
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Mass Email',
        actions: [
          if (email != null && _canManage && isFailed)
            IconButton(
              tooltip: 'Retry Failed',
              icon: _retrying
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.primaryPrime,
                      ),
                    )
                  : const Icon(Icons.refresh),
              onPressed: _retrying ? null : _retry,
            ),
        ],
      ),
      body: _loading
          ? const LoadingWidget()
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        TextButton(
                            onPressed: _fetch, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : email == null
                  ? const Center(child: Text('Email not found'))
                  : _buildBody(email),
    );
  }

  Widget _buildBody(Map<String, dynamic> email) {
    final status = email['status']?.toString() ?? 'Draft';
    final isDraft = status.toLowerCase() == 'draft';
    final total = (email['totalRecipients'] ?? email['recipientCount']) as int? ?? 0;
    final sent = email['sentCount'] as int? ?? 0;
    final failed = email['failedCount'] as int? ?? 0;
    final notDelivered = (total - sent - failed).clamp(0, total);
    final subject = email['subject']?.toString() ?? 'Mass Email';
    final fromName = email['fromName']?.toString();
    final replyName = email['replyName']?.toString();
    final replyEmail = email['replyEmail']?.toString();
    final subgroupName = email['subgroupName']?.toString();
    final recipientType = email['recipientType'];
    final body = email['emailBody']?.toString() ?? '';
    final sentDateRaw =
        email['sentDate']?.toString() ?? email['createdDate']?.toString();
    final sentDate = sentDateRaw != null
        ? DateFormatter.toDisplay(DateTime.tryParse(sentDateRaw))
        : '-';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DetailHeader(
          title: subject,
          status: status,
          meta: sentDate != '-' ? sentDate : null,
          icon: Icons.mail_outline,
        ),
        const SizedBox(height: 16),
        DetailSectionCard(
          icon: Icons.email_outlined,
          title: 'Email Details',
          number: 1,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (fromName != null && fromName.isNotEmpty)
                DetailRow(label: 'From', value: fromName),
              if (replyEmail != null && replyEmail.isNotEmpty)
                DetailRow(
                  label: 'Reply To',
                  value: (replyName != null && replyName.isNotEmpty)
                      ? '$replyName <$replyEmail>'
                      : replyEmail,
                ),
              DetailRow(
                label: 'Recipients',
                value: subgroupName != null && subgroupName.isNotEmpty
                    ? '$total (${_recipientTypeLabel(recipientType)} - $subgroupName)'
                    : '$total (${_recipientTypeLabel(recipientType)})',
              ),
              DetailRow(label: 'Date', value: sentDate),
            ],
          ),
        ),
        if (!isDraft) ...[
          const SizedBox(height: 12),
          DetailSectionCard(
            icon: Icons.bar_chart_outlined,
            title: 'Delivery Stats',
            number: 2,
            child: GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
              childAspectRatio: 1.9,
              children: [
                _StatCard(
                    label: 'Total',
                    value: '$total',
                    color: Colors.blue.shade700,
                    bg: Colors.blue.withValues(alpha: 0.08)),
                _StatCard(
                    label: 'Sent',
                    value: '$sent',
                    color: Colors.green.shade700,
                    bg: Colors.green.withValues(alpha: 0.08)),
                _StatCard(
                    label: 'Failed',
                    value: '$failed',
                    color: Colors.red.shade700,
                    bg: Colors.red.withValues(alpha: 0.08)),
                _StatCard(
                    label: 'Not Delivered',
                    value: '$notDelivered',
                    color: Colors.orange.shade700,
                    bg: Colors.orange.withValues(alpha: 0.08)),
              ],
            ),
          ),
        ],
        if (body.isNotEmpty) ...[
          const SizedBox(height: 12),
          DetailSectionCard(
            icon: Icons.notes_outlined,
            title: 'Email Body',
            number: isDraft ? 2 : 3,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.border),
              ),
              child: Text(body, style: AppTextStyles.bodyMedium),
            ),
          ),
        ],
        const SizedBox(height: 12),
        DetailSectionCard(
          icon: Icons.people_outline,
          title: 'Recipients (${_recipients.length})',
          number: isDraft
              ? (body.isNotEmpty ? 3 : 2)
              : (body.isNotEmpty ? 4 : 3),
          child: _recipients.isEmpty
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'No recipients.',
                    style: AppTextStyles.caption
                        .copyWith(color: AppColors.textSecondary),
                  ),
                )
              : Column(
                  children: [
                    for (final r in _recipients.whereType<Map<String, dynamic>>())
                      _RecipientRow(data: r),
                  ],
                ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final Color bg;
  const _StatCard({
    required this.label,
    required this.value,
    required this.color,
    required this.bg,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _RecipientRow extends StatelessWidget {
  final Map<String, dynamic> data;
  const _RecipientRow({required this.data});

  @override
  Widget build(BuildContext context) {
    final status = data['status']?.toString() ?? '';
    final lower = status.toLowerCase();
    IconData icon;
    Color iconColor;
    if (lower == 'sent') {
      icon = Icons.check_circle;
      iconColor = Colors.green;
    } else if (lower == 'failed') {
      icon = Icons.cancel;
      iconColor = Colors.red;
    } else {
      icon = Icons.access_time;
      iconColor = Colors.amber.shade700;
    }
    final name = data['memberName']?.toString() ?? '-';
    final email = data['email']?.toString() ?? '';
    final errorMessage = data['errorMessage']?.toString() ?? '';
    final sentDateStr = data['sentDate']?.toString();
    final sentDate = sentDateStr != null
        ? DateFormatter.toDisplay(DateTime.tryParse(sentDateStr))
        : null;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icon, size: 18, color: iconColor),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: AppTextStyles.bodyMedium
                      .copyWith(fontWeight: FontWeight.w600),
                ),
                Text(
                  email.isEmpty ? 'No email' : email,
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Row(
                  children: [
                    Text(
                      status.isEmpty ? '-' : status,
                      style: AppTextStyles.caption
                          .copyWith(color: iconColor, fontWeight: FontWeight.w600),
                    ),
                    if (sentDate != null && sentDate.isNotEmpty) ...[
                      Text(' · ',
                          style: AppTextStyles.caption
                              .copyWith(color: AppColors.textSecondary)),
                      Flexible(
                        child: Text(
                          sentDate,
                          style: AppTextStyles.caption
                              .copyWith(color: AppColors.textSecondary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ],
                ),
                if (errorMessage.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      errorMessage,
                      style: AppTextStyles.caption.copyWith(color: Colors.red),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}


// -- Compose BottomSheet with recipientType 1/2/3, credit check, edit support

class _ComposeEmailScreen extends StatefulWidget {
  final int clubId;
  final int? editId;
  final VoidCallback onSent;

  const _ComposeEmailScreen({required this.clubId, this.editId, required this.onSent});

  @override
  State<_ComposeEmailScreen> createState() => _ComposeEmailScreenState();
}

class _ComposeEmailScreenState extends State<_ComposeEmailScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _subjectCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();
  final _fromNameCtrl = TextEditingController();
  final _replyNameCtrl = TextEditingController();
  final _replyEmailCtrl = TextEditingController();
  final _memberSearchCtrl = TextEditingController();

  List<dynamic> _subGroups = [];
  List<dynamic> _members = [];
  List<dynamic> _availableYears = [];
  int? _selectedYearId;

  // Numeric recipient type: 1=all, 2=subgroup, 3=individual
  int _recipientType = 1;
  final Set<int> _selectedSubgroupIds = <int>{};
  final Set<int> _selectedMemberIds = <int>{};
  bool _sending = false;
  bool _savingDraft = false;
  bool _loadingEdit = false;

  int? _emailRemaining;
  int? _recipientCount;
  int? _membersWithEmail;
  Timer? _countDebounce;

  bool get _isEdit => widget.editId != null;

  @override
  void initState() {
    super.initState();
    _loadCreditBalance();
    _loadAvailableYears();
    _loadMembers();
    if (_isEdit) {
      _loadEditData();
    } else {
      _scheduleCountRefresh(immediate: true);
    }
  }

  @override
  void dispose() {
    _subjectCtrl.dispose();
    _bodyCtrl.dispose();
    _fromNameCtrl.dispose();
    _replyNameCtrl.dispose();
    _replyEmailCtrl.dispose();
    _memberSearchCtrl.dispose();
    _countDebounce?.cancel();
    super.dispose();
  }

  Future<void> _loadEditData() async {
    setState(() => _loadingEdit = true);
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/mass-emails/${widget.editId}',
        fromJson: (j) => j,
      );
      final data = resp.data as Map<String, dynamic>?;
      if (data != null && mounted) {
        _fromNameCtrl.text = data['fromName']?.toString() ?? '';
        _replyNameCtrl.text = data['replyName']?.toString() ?? '';
        _replyEmailCtrl.text = data['replyEmail']?.toString() ?? '';
        _subjectCtrl.text = data['subject']?.toString() ?? '';
        _bodyCtrl.text = data['emailBody']?.toString() ?? '';
        _recipientType = data['recipientType'] as int? ?? 1;

        // Pre-populate subgroup selections
        final sgIds = data['subgroupIds'];
        if (sgIds is List) {
          _selectedSubgroupIds.addAll(sgIds.whereType<int>());
        }

        // Pre-populate member selections
        final recipients = data['recipients'] as List<dynamic>?;
        if (recipients != null) {
          for (final r in recipients) {
            final mid = (r as Map<String, dynamic>?)?['memberId'] as int?;
            if (mid != null) _selectedMemberIds.add(mid);
          }
        }

        setState(() {});
        _scheduleCountRefresh(immediate: true);
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingEdit = false);
    }
  }

  Future<void> _loadCreditBalance() async {
    try {
      final resp = await _api.get(
        '/api/credit-management/club/${widget.clubId}/balance',
        fromJson: (j) => j,
      );
      final data = resp.data;
      if (data is Map<String, dynamic> && mounted) {
        setState(() {
          _emailRemaining = (data['emailRemaining'] as num?)?.toInt();
        });
      }
    } catch (_) {}
  }

  Future<void> _loadAvailableYears() async {
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/sub-groups/available-years',
        fromJson: (j) => j,
      );
      if (resp.data is List && mounted) {
        setState(() => _availableYears = resp.data as List<dynamic>);
        if (_availableYears.isNotEmpty) {
          _selectedYearId = (_availableYears.first['id'] ?? _availableYears.first['yearId']) as int?;
          _loadSubGroups();
        }
      }
    } catch (_) {
      // Fall back to loading subgroups without year
      _loadSubGroups();
    }
  }

  Future<void> _loadSubGroups() async {
    try {
      final qp = <String, dynamic>{};
      if (_selectedYearId != null) qp['yearId'] = _selectedYearId;
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/sub-groups',
        queryParams: qp.isNotEmpty ? qp : null,
        fromJson: (j) => j,
      );
      final data = resp.data;
      List<dynamic> list = [];
      if (data is List) {
        list = data;
      } else if (data is Map<String, dynamic>) {
        list = data['items'] as List<dynamic>? ?? [];
      }
      if (mounted) setState(() => _subGroups = list);
    } catch (_) {}
  }

  Future<void> _loadMembers() async {
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/sub-groups/club-members',
        fromJson: (j) => j,
      );
      final data = resp.data;
      List<dynamic> list = [];
      if (data is List) {
        list = data;
      } else if (data is Map<String, dynamic>) {
        list = data['items'] as List<dynamic>? ?? [];
      }
      if (mounted) setState(() => _members = list);
    } catch (_) {}
  }

  void _scheduleCountRefresh({bool immediate = false}) {
    _countDebounce?.cancel();
    _countDebounce = Timer(
      Duration(milliseconds: immediate ? 0 : 500),
      _fetchRecipientCount,
    );
  }

  Future<void> _fetchRecipientCount() async {
    try {
      final qp = <String, dynamic>{'recipientType': _recipientType};
      if (_recipientType == 2 && _selectedSubgroupIds.isNotEmpty) {
        qp['subgroupIds'] = _selectedSubgroupIds.join(',');
      }
      if (_recipientType == 3 && _selectedMemberIds.isNotEmpty) {
        qp['memberIds'] = _selectedMemberIds.join(',');
      }
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/mass-emails/recipient-count',
        queryParams: qp,
        fromJson: (j) => j,
      );
      final data = resp.data;
      if (data is Map<String, dynamic> && mounted) {
        setState(() {
          _recipientCount = (data['totalCount'] ?? data['recipientCount'] ?? data['count']) as int?;
          _membersWithEmail = (data['membersWithEmail']) as int?;
        });
      }
    } catch (_) {}
  }

  Map<String, dynamic> _buildBody({required bool saveAsDraft}) {
    return {
      'subject': _subjectCtrl.text.trim(),
      'emailBody': _bodyCtrl.text.trim(),
      'recipientType': _recipientType,
      if (_recipientType == 2 && _selectedSubgroupIds.isNotEmpty)
        'subgroupIds': _selectedSubgroupIds.toList(),
      if (_recipientType == 3 && _selectedMemberIds.isNotEmpty)
        'memberIds': _selectedMemberIds.toList(),
      'saveAsDraft': saveAsDraft,
      'fromName': _fromNameCtrl.text.trim(),
      'replyName': _replyNameCtrl.text.trim(),
      'replyEmail': _replyEmailCtrl.text.trim(),
    };
  }

  bool get _hasSufficientCredits {
    if (_emailRemaining == null || _membersWithEmail == null) return true; // unknown = allow
    return _emailRemaining! >= _membersWithEmail!;
  }

  Future<void> _saveDraft() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _savingDraft = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/clubs/${widget.clubId}/mass-emails/${widget.editId}',
          body: _buildBody(saveAsDraft: true),
        );
      } else {
        await _api.post(
          '/api/clubs/${widget.clubId}/mass-emails',
          body: _buildBody(saveAsDraft: true),
        );
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Draft saved');
        Navigator.pop(context);
        widget.onSent();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to save draft: $e');
    } finally {
      if (mounted) setState(() => _savingDraft = false);
    }
  }

  Future<void> _send() async {
    if (!_formKey.currentState!.validate()) return;
    if (_recipientType == 2 && _selectedSubgroupIds.isEmpty) {
      SnackbarUtils.showError(context, 'Please select at least one sub-group');
      return;
    }
    if (_recipientType == 3 && _selectedMemberIds.isEmpty) {
      SnackbarUtils.showError(context, 'Please select at least one member');
      return;
    }
    setState(() => _sending = true);
    try {
      int? emailId = widget.editId;
      if (_isEdit) {
        await _api.put(
          '/api/clubs/${widget.clubId}/mass-emails/$emailId',
          body: _buildBody(saveAsDraft: false),
        );
      } else {
        final createResp = await _api.post(
          '/api/clubs/${widget.clubId}/mass-emails',
          body: _buildBody(saveAsDraft: false),
        );
        final created = createResp.data;
        if (created is Map<String, dynamic>) {
          emailId = (created['id'] ?? created['emailId']) as int?;
        }
      }
      if (emailId != null) {
        await _api
            .post('/api/clubs/${widget.clubId}/mass-emails/$emailId/send');
      }
      if (mounted) {
        SnackbarUtils.showSuccess(context, 'Email sent successfully');
        Navigator.pop(context);
        widget.onSent();
      }
    } catch (e) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to send email: $e');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final memberSearchText = _memberSearchCtrl.text.toLowerCase();
    final filteredMembers = _members.where((m) {
      if (memberSearchText.isEmpty) return true;
      final name = (m['memberName'] ?? m['name'] ?? '').toString().toLowerCase();
      final email = (m['email'] ?? '').toString().toLowerCase();
      return name.contains(memberSearchText) || email.contains(memberSearchText);
    }).toList();

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Email' : 'Compose Email',
      ),
      body: _loadingEdit
          ? const LoadingWidget()
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              child: Form(
                key: _formKey,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                        // Credit balance + recipient count display
                        if (_emailRemaining != null || _membersWithEmail != null)
                          Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: _hasSufficientCredits
                                  ? AppColors.primaryLight
                                  : Colors.orange.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  _hasSufficientCredits
                                      ? Icons.mail_outline
                                      : Icons.warning_amber_rounded,
                                  size: 16,
                                  color: _hasSufficientCredits
                                      ? AppColors.primary
                                      : Colors.orange,
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    '${_emailRemaining ?? '?'} available / ${_membersWithEmail ?? '?'} needed',
                                    style: AppTextStyles.caption.copyWith(
                                      color: _hasSufficientCredits
                                          ? AppColors.primary
                                          : Colors.orange,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        CustomTextField(
                          controller: _fromNameCtrl,
                          label: 'From Name *',
                          validator: (v) => v == null || v.trim().isEmpty
                              ? 'From name is required'
                              : null,
                        ),
                        const SizedBox(height: 12),
                        // Sender email (display only, not editable)
                        InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'Sender Email',
                            isDense: true,
                            enabled: false,
                          ),
                          child: Text(
                            // The sender is configured on the server (Brevo:MassEmailSenderEmail).
                            '${Brand.current.productName} (system sender)',
                            style: AppTextStyles.body.copyWith(color: Colors.grey[600]),
                          ),
                        ),
                        const SizedBox(height: 12),
                        CustomTextField(
                          controller: _replyNameCtrl,
                          label: 'Reply Name',
                        ),
                        const SizedBox(height: 12),
                        CustomTextField(
                          controller: _replyEmailCtrl,
                          label: 'Reply Email',
                        ),
                        const SizedBox(height: 12),
                        CustomTextField(
                          controller: _subjectCtrl,
                          label: 'Subject *',
                          validator: (v) =>
                              v == null || v.trim().isEmpty ? 'Subject is required' : null,
                        ),
                        const SizedBox(height: 16),
                        Text('Recipients', style: AppTextStyles.body.copyWith(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: _RecipientChip(
                                label: 'All Members',
                                selected: _recipientType == 1,
                                onTap: () {
                                  setState(() {
                                    _recipientType = 1;
                                    _selectedSubgroupIds.clear();
                                    _selectedMemberIds.clear();
                                  });
                                  _scheduleCountRefresh(immediate: true);
                                },
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _RecipientChip(
                                label: 'Subgroup',
                                selected: _recipientType == 2,
                                onTap: () {
                                  setState(() {
                                    _recipientType = 2;
                                    _selectedMemberIds.clear();
                                  });
                                  _scheduleCountRefresh(immediate: true);
                                },
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _RecipientChip(
                                label: 'Select Members',
                                selected: _recipientType == 3,
                                onTap: () {
                                  setState(() {
                                    _recipientType = 3;
                                    _selectedSubgroupIds.clear();
                                  });
                                  _scheduleCountRefresh(immediate: true);
                                },
                              ),
                            ),
                          ],
                        ),
                        // Subgroup picker (recipientType == 2)
                        if (_recipientType == 2) ...[
                          const SizedBox(height: 12),
                          // Year selector for subgroups
                          if (_availableYears.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: DropdownButtonFormField<int>(
                                value: _selectedYearId,
                                isExpanded: true,
                                isDense: true,
                                decoration: const InputDecoration(
                                  labelText: 'Year',
                                  isDense: true,
                                  contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  border: OutlineInputBorder(),
                                ),
                                items: _availableYears.map<DropdownMenuItem<int>>((y) {
                                  final id = (y['id'] ?? y['yearId']) as int?;
                                  final label = y['yearLabel']?.toString() ?? y['label']?.toString() ?? '$id';
                                  return DropdownMenuItem<int>(
                                    value: id,
                                    child: Text(label),
                                  );
                                }).toList(),
                                onChanged: (v) {
                                  setState(() => _selectedYearId = v);
                                  _loadSubGroups();
                                },
                              ),
                            ),
                          if (_subGroups.isEmpty)
                            Text(
                              'No sub-groups available',
                              style: AppTextStyles.caption
                                  .copyWith(color: AppColors.textMuted),
                            )
                          else
                            Container(
                              decoration: BoxDecoration(
                                border: Border.all(color: AppColors.border),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              constraints: const BoxConstraints(maxHeight: 200),
                              child: ListView(
  padding: const EdgeInsets.only(bottom: 88),
                                shrinkWrap: true,
                                children: _subGroups.map<Widget>((g) {
                                  final id = g['id'] as int?;
                                  if (id == null) return const SizedBox.shrink();
                                  final selected = _selectedSubgroupIds.contains(id);
                                  final memberCount = g['memberCount'] as int?;
                                  return CheckboxListTile.adaptive(
                                    value: selected,
                                    dense: true,
                                    controlAffinity: ListTileControlAffinity.leading,
                                    title: Text(
                                        g['groupName']?.toString() ?? '',
                                        style: AppTextStyles.caption),
                                    subtitle: memberCount != null
                                        ? Text('$memberCount members',
                                            style: AppTextStyles.caption.copyWith(
                                              fontSize: 13,
                                              color: Colors.grey[500],
                                            ))
                                        : null,
                                    activeColor: AppColors.primary,
                                    onChanged: (v) {
                                      setState(() {
                                        if (v == true) {
                                          _selectedSubgroupIds.add(id);
                                        } else {
                                          _selectedSubgroupIds.remove(id);
                                        }
                                      });
                                      _scheduleCountRefresh();
                                    },
                                  );
                                }).toList(),
                              ),
                            ),
                        ],
                        // Individual member picker (recipientType == 3)
                        if (_recipientType == 3) ...[
                          const SizedBox(height: 12),
                          TextField(
                            controller: _memberSearchCtrl,
                            decoration: InputDecoration(
                              hintText: 'Search members...',
                              prefixIcon: const Icon(Icons.search, size: 20),
                              isDense: true,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            ),
                            onChanged: (_) => setState(() {}),
                          ),
                          const SizedBox(height: 8),
                          if (_members.isEmpty)
                            Text(
                              'No members available',
                              style: AppTextStyles.caption
                                  .copyWith(color: AppColors.textMuted),
                            )
                          else
                            Container(
                              decoration: BoxDecoration(
                                border: Border.all(color: AppColors.border),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              constraints: const BoxConstraints(maxHeight: 250),
                              child: ListView(
  padding: const EdgeInsets.only(bottom: 88),
                                shrinkWrap: true,
                                children: filteredMembers.map<Widget>((m) {
                                  final id = (m['memberId'] ?? m['id']) as int?;
                                  if (id == null) return const SizedBox.shrink();
                                  final selected = _selectedMemberIds.contains(id);
                                  final name = (m['memberName'] ?? m['name'])?.toString() ?? '';
                                  final email = m['email']?.toString() ?? '';
                                  return CheckboxListTile.adaptive(
                                    value: selected,
                                    dense: true,
                                    controlAffinity: ListTileControlAffinity.leading,
                                    title: Text(name, style: AppTextStyles.caption),
                                    subtitle: email.isNotEmpty
                                        ? Text(email,
                                            style: AppTextStyles.caption.copyWith(
                                              fontSize: 13,
                                              color: Colors.grey[500],
                                            ))
                                        : null,
                                    activeColor: AppColors.primary,
                                    onChanged: (v) {
                                      setState(() {
                                        if (v == true) {
                                          _selectedMemberIds.add(id);
                                        } else {
                                          _selectedMemberIds.remove(id);
                                        }
                                      });
                                      _scheduleCountRefresh();
                                    },
                                  );
                                }).toList(),
                              ),
                            ),
                        ],
                        // Recipient count display
                        if (_recipientCount != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            '$_recipientCount recipients selected',
                            style: AppTextStyles.caption.copyWith(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        CustomTextField(
                          controller: _bodyCtrl,
                          label: 'Email Body *',
                          maxLines: 10,
                          keyboardType: TextInputType.multiline,
                          textInputAction: TextInputAction.newline,
                          validator: (v) =>
                              v == null || v.trim().isEmpty ? 'Email body is required' : null,
                        ),
                        const SizedBox(height: 24),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: _savingDraft || _sending ? null : _saveDraft,
                                icon: _savingDraft
                                    ? const SizedBox(
                                        width: 14,
                                        height: 14,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2),
                                      )
                                    : const Icon(Icons.save_outlined, size: 16),
                                label: Text(_savingDraft ? 'Saving...' : 'Save Draft'),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: CustomButton(
                                // Compact label so it fits the half-width slot
                                // next to "Save Draft" without overflowing on
                                // narrow phones (recipient count shown above).
                                label: _membersWithEmail != null
                                    ? 'Send ($_membersWithEmail)'
                                    : 'Send Email',
                                onPressed: _sending || _savingDraft || !_hasSufficientCredits
                                    ? null
                                    : _send,
                                isLoading: _sending,
                              ),
                            ),
                          ],
                        ),
                        if (!_hasSufficientCredits)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.orange.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                children: [
                                  const Icon(Icons.warning_amber_rounded, size: 16, color: Colors.orange),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      'Insufficient email credits. You can still save as draft.',
                                      style: AppTextStyles.caption.copyWith(color: Colors.orange),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                  ],
                ),
              ),
            ),
    );
  }
}

class _RecipientChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _RecipientChip(
      {required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : Colors.grey[100],
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
              color: selected ? AppColors.primary : Colors.grey[300]!),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: AppTextStyles.caption.copyWith(
            color: selected ? Colors.white : Colors.grey[700],
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
