import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/network/api_response.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_text_styles.dart';
import '../../../providers/auth_provider.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import '../../../widgets/common/empty_state_widget.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/pagination_widget.dart';
import '../../../widgets/detail/detail_widgets.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
final _dateFmt = DateFormat('dd MMM yyyy');

bool _asBool(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase().trim();
    return s == 'true' || s == '1' || s == 'yes';
  }
  return false;
}

String _formatDate(String? iso) {
  if (iso == null || iso.isEmpty) return '–';
  final dt = DateTime.tryParse(iso);
  if (dt == null || dt.year <= 1) return '–'; // `0001-01-01` zero date => no value
  return _dateFmt.format(dt.toLocal());
}

String _recipientTypeLabel(int t) {
  switch (t) {
    case 2:
      return 'Selected Clubs';
    case 3:
      return 'Subgroups';
    case 1:
    default:
      return 'All Members';
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
class _MassEmail {
  final int id;
  final String subject;
  final int recipientType;
  final int recipientCount;
  final int sentCount;
  final int failedCount;
  final String status;
  final String? createdDate;
  final String fromName;
  final String replyName;
  final String replyEmail;
  final String emailBody;
  final List<int> selectedClubIds;
  final List<int> selectedSubgroupIds;

  const _MassEmail({
    required this.id,
    required this.subject,
    this.recipientType = 1,
    this.recipientCount = 0,
    this.sentCount = 0,
    this.failedCount = 0,
    this.status = 'Draft',
    this.createdDate,
    this.fromName = '',
    this.replyName = '',
    this.replyEmail = '',
    this.emailBody = '',
    this.selectedClubIds = const [],
    this.selectedSubgroupIds = const [],
  });

  factory _MassEmail.fromJson(Map<String, dynamic> j) {
    List<int> parseIntList(dynamic v) {
      if (v is List) {
        return v
            .map((e) => e is int ? e : int.tryParse(e.toString()) ?? 0)
            .where((e) => e > 0)
            .toList();
      }
      return const [];
    }

    return _MassEmail(
      id: (j['id'] as int?) ?? 0,
      subject: j['subject']?.toString() ?? '',
      recipientType: (j['recipientType'] as int?) ??
          int.tryParse(j['recipientType']?.toString() ?? '') ??
          1,
      recipientCount: (j['totalRecipients'] as int?) ??
          (j['recipientCount'] as int?) ??
          0,
      sentCount: (j['sentCount'] as int?) ?? 0,
      failedCount: (j['failedCount'] as int?) ?? 0,
      status: j['status']?.toString() ?? 'Draft',
      createdDate: (j['createdDate'] ?? j['createdAt'])?.toString(),
      fromName: j['fromName']?.toString() ?? '',
      replyName: j['replyName']?.toString() ?? '',
      replyEmail: j['replyEmail']?.toString() ?? '',
      emailBody: j['emailBody']?.toString() ?? '',
      // List endpoints expose clubIds/subgroupIds arrays; the detail endpoint
      // (MassEmailDetailDto) exposes single fkClubId/fkSubgroupId. Accept both
      // so the editor prefills from either shape.
      selectedClubIds: () {
        final list = parseIntList(j['clubIds'] ?? j['selectedClubIds']);
        if (list.isNotEmpty) return list;
        final single = int.tryParse(j['fkClubId']?.toString() ?? '') ?? 0;
        return single > 0 ? [single] : const <int>[];
      }(),
      selectedSubgroupIds: () {
        final list = parseIntList(j['subgroupIds'] ?? j['selectedSubgroupIds']);
        if (list.isNotEmpty) return list;
        final single = int.tryParse(j['fkSubgroupId']?.toString() ?? '') ?? 0;
        return single > 0 ? [single] : const <int>[];
      }(),
    );
  }
}

class _ClubOption {
  final int id;
  final String clubName;
  const _ClubOption({required this.id, required this.clubName});

  factory _ClubOption.fromJson(Map<String, dynamic> j) => _ClubOption(
        id: (j['id'] as int?) ?? 0,
        clubName: j['clubName']?.toString() ?? j['name']?.toString() ?? '',
      );
}

class _SubgroupOption {
  final int id;
  final String groupName;
  final int memberCount;
  const _SubgroupOption({
    required this.id,
    required this.groupName,
    this.memberCount = 0,
  });

  factory _SubgroupOption.fromJson(Map<String, dynamic> j) => _SubgroupOption(
        id: (j['id'] as int?) ?? 0,
        groupName: j['groupName']?.toString() ?? '',
        memberCount: (j['memberCount'] as int?) ?? 0,
      );
}

class _RotaryYear {
  final int id;
  final String yearLabel;
  final bool isCurrent;
  const _RotaryYear({
    required this.id,
    required this.yearLabel,
    this.isCurrent = false,
  });

  factory _RotaryYear.fromJson(Map<String, dynamic> j) => _RotaryYear(
        id: (j['id'] as int?) ?? 0,
        yearLabel: j['yearLabel']?.toString() ?? '',
        isCurrent: _asBool(j['isCurrent']),
      );
}

class _RecipientCount {
  final int totalMembers;
  final int membersWithEmail;
  const _RecipientCount({this.totalMembers = 0, this.membersWithEmail = 0});

  factory _RecipientCount.fromJson(Map<String, dynamic> j) => _RecipientCount(
        totalMembers: (j['totalMembers'] as int?) ?? 0,
        membersWithEmail: (j['membersWithEmail'] as int?) ?? 0,
      );
}

// ---------------------------------------------------------------------------
// List Screen
// ---------------------------------------------------------------------------
class DistrictMassEmailsScreen extends StatefulWidget {
  final int districtId;
  final bool embedded;
  /// When true, forces read-only rendering regardless of the user's admin
  /// role. Set by the unified flow when the user isn't admin of this district.
  final bool viewOnly;
  const DistrictMassEmailsScreen({
    super.key,
    required this.districtId,
    this.embedded = false,
    this.viewOnly = false,
  });

  @override
  State<DistrictMassEmailsScreen> createState() =>
      _DistrictMassEmailsScreenState();
}

class _DistrictMassEmailsScreenState extends State<DistrictMassEmailsScreen> {
  final _api = ApiClient();

  final List<_MassEmail> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  String _status = 'All';
  static const _statuses = ['All', 'Draft', 'Sending', 'Sent', 'Failed'];

  final TextEditingController _searchCtrl = TextEditingController();
  Timer? _searchDebounce;

  // Cache for editor (fetched lazily on first open)
  List<_ClubOption>? _clubs;
  List<_RotaryYear>? _years;

  @override
  void initState() {
    super.initState();
    _fetch(reset: true);
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() {
        _page = 1;
        _items.clear();
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final qp = <String, dynamic>{
        'page': _page,
        'pageSize': _pageSize,
      };
      if (_status != 'All') qp['status'] = _status;
      final search = _searchCtrl.text.trim();
      if (search.isNotEmpty) qp['search'] = search;

      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/mass-emails',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(
        resp.data ?? {},
        (j) => _MassEmail.fromJson(j),
      );
      setState(() {
        _items.addAll(paged.items);
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      } else {
        setState(() {
          _error = e.message;
          _loading = false;
          _loadingMore = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _loadEditorData() async {
    if (_clubs != null && _years != null) return;
    try {
      final clubResp = _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/clubs',
        fromJson: (j) => j as List<dynamic>,
      );
      final yearResp = _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/sub-groups/available-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final results = await Future.wait([clubResp, yearResp]);
      _clubs = ((results[0].data) ?? const [])
          .map((e) => _ClubOption.fromJson(e as Map<String, dynamic>))
          .toList();
      _years = ((results[1].data) ?? const [])
          .map((e) => _RotaryYear.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      _clubs ??= [];
      _years ??= [];
    }
  }

  Future<void> _delete(_MassEmail item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Mass Email'),
        content: Text('Delete "${item.subject}"? This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete',
                style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete(
        '/api/districts/${widget.districtId}/mass-emails/${item.id}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Mass email deleted'),
          backgroundColor: AppColors.success,
        ),
      );
      await _fetch(reset: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
  }

  Future<void> _sendNow(_MassEmail item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send Mass Email'),
        content: Text(
          'Send this email to ${item.recipientCount} recipient${item.recipientCount == 1 ? '' : 's'}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final resp = await _api.post<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/mass-emails/${item.id}/send',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      final msg = resp.data?['message']?.toString() ?? 'Send triggered';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(msg),
          backgroundColor: AppColors.success,
        ),
      );
      await _fetch(reset: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Send failed: $e')),
      );
    }
  }

  /// The list row is only a summary (subject/status/counts) — it has no
  /// From/Reply/Body or selected clubs/subgroups. Fetch the full detail record
  /// so the editor/viewer have the complete email. Returns null (and shows a
  /// warning) if the detail can't be loaded, so callers can react instead of
  /// silently presenting blank fields.
  Future<_MassEmail?> _fetchDetail(int id) async {
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/mass-emails/$id',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (resp.data != null) return _MassEmail.fromJson(resp.data!);
      return null;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not load full email details: '
                '${e is ApiException ? e.message : e}'),
            backgroundColor: AppColors.error,
          ),
        );
      }
      return null;
    }
  }

  Future<void> _openEditor({_MassEmail? existing}) async {
    await _loadEditorData();
    // Edit must prefill From/Reply/Body — pull the detail; fall back to the
    // summary row only if the detail fetch fails (a warning is shown).
    _MassEmail? detailed = existing;
    if (existing != null) {
      detailed = await _fetchDetail(existing.id) ?? existing;
    }
    if (!mounted) return;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _MassEmailComposePage(
          districtId: widget.districtId,
          existing: detailed,
          clubs: _clubs ?? const [],
          years: _years ?? const [],
        ),
      ),
    );
    if (saved == true) await _fetch(reset: true);
  }

  Future<void> _openViewer(_MassEmail item) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => _MassEmailDetailScreen(
          districtId: widget.districtId,
          emailId: item.id,
          fallback: item,
        ),
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'Sent':
        return AppColors.success;
      case 'Failed':
        return AppColors.error;
      case 'Sending':
        return Colors.amber.shade700;
      case 'Draft':
      default:
        return AppColors.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // viewOnly overrides admin access — used by the unified flow.
    // Per-level gating: only district admins of THIS district can manage.
    final canManage =
        !widget.viewOnly && auth.isDistrictAdminOf(widget.districtId);

    final body = Column(
      children: [
        _buildFilters(),
        Expanded(child: _buildBody(canManage)),
      ],
    );

    if (widget.embedded) {
      return Scaffold(
        backgroundColor: AppColors.background,
        body: body,
      );
    }
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Mass Emails',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Compose mass email',
              onPressed: () => _openEditor(),
            ),
        ],
      ),
      body: body,
    );
  }

  Widget _buildFilters() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        children: [
          Row(
            children: [
              SizedBox(
                width: 200,
                child: DropdownButtonFormField<String>(
                  value: _status,
                  isDense: true,
                  isExpanded: true,
                  decoration: InputDecoration(
                    isDense: true,
                    labelText: 'Status',
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  items: _statuses
                      .map((s) => DropdownMenuItem(
                          value: s,
                          child: Text(s,
                              overflow: TextOverflow.ellipsis)))
                      .toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() => _status = v);
                    _fetch(reset: true);
                  },
                ),
              ),
              const Spacer(),
              if (_totalCount > 0)
                Text(
                  '$_totalCount total',
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary),
                ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _searchCtrl,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search subject',
              isDense: true,
              prefixIcon: const Icon(Icons.search, size: 18),
              suffixIcon: _searchCtrl.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        _searchCtrl.clear();
                        _searchDebounce?.cancel();
                        _fetch(reset: true);
                      },
                    ),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            onChanged: (_) {
              _searchDebounce?.cancel();
              _searchDebounce = Timer(
                const Duration(milliseconds: 400),
                () => _fetch(reset: true),
              );
              setState(() {});
            },
            onSubmitted: (_) {
              _searchDebounce?.cancel();
              _fetch(reset: true);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildBody(bool canManage) {
    if (_loading) {
      return const ShimmerList(itemCount: 6, itemHeight: 110);
    }
    if (_error != null) {
      return ErrorStateWidget(
        message: _error!,
        onRetry: () => _fetch(reset: true),
      );
    }
    if (_items.isEmpty) {
      return EmptyStateWidget(
        title: 'No mass emails',
        subtitle: canManage
            ? 'Tap + to compose a new mass email.'
            : 'No mass emails have been sent yet.',
        icon: Icons.mail_outline,
        actionLabel: canManage ? 'Compose Email' : null,
        onAction: canManage ? () => _openEditor() : null,
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _fetch(reset: true),
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: _items.length + 1,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (ctx, i) {
          if (i == _items.length) {
            return PaginationWidget(
              currentPage: _page,
              totalPages: _totalPages,
              totalCount: _totalCount,
              isLoading: _loadingMore,
              onLoadMore: () {
                if (_page < _totalPages && !_loadingMore) {
                  _page++;
                  _fetch();
                }
              },
            );
          }
          final item = _items[i];
          return _MassEmailCard(
            item: item,
            canManage: canManage,
            statusColor: _statusColor(item.status),
            onView: () => _openViewer(item),
            onEdit: () => _openEditor(existing: item),
            onDelete: () => _delete(item),
            onSend: () => _sendNow(item),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
class _MassEmailCard extends StatelessWidget {
  final _MassEmail item;
  final bool canManage;
  final Color statusColor;
  final VoidCallback onView;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onSend;

  const _MassEmailCard({
    required this.item,
    required this.canManage,
    required this.statusColor,
    required this.onView,
    required this.onEdit,
    required this.onDelete,
    required this.onSend,
  });

  Widget _statRow(IconData icon, String text, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          text,
          style: AppTextStyles.caption.copyWith(color: color),
        ),
      ],
    );
  }

  String _recipientDescription() {
    switch (item.recipientType) {
      case 2:
        return '${_recipientTypeLabel(2)} (${item.selectedClubIds.length})';
      case 3:
        return '${_recipientTypeLabel(3)} (${item.selectedSubgroupIds.length})';
      case 1:
      default:
        return _recipientTypeLabel(1);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDraft = item.status == 'Draft';
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onView,
        child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.mail_outline,
                      size: 20, color: AppColors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.subject.isEmpty ? '(No subject)' : item.subject,
                        style: AppTextStyles.bodyMedium
                            .copyWith(fontWeight: FontWeight.w600),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              item.status,
                              style: AppTextStyles.caption
                                  .copyWith(color: statusColor),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.background,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Text(
                              _recipientDescription(),
                              style: AppTextStyles.caption,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, size: 20),
                  onSelected: (v) {
                    if (v == 'view') onView();
                    if (v == 'send') onSend();
                    if (v == 'retry') onSend();
                    if (v == 'edit') onEdit();
                    if (v == 'delete') onDelete();
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'view',
                      child: Row(children: [
                        Icon(Icons.visibility_outlined, size: 18),
                        SizedBox(width: 8),
                        Text('View'),
                      ]),
                    ),
                    if (canManage)
                      const PopupMenuItem(
                        value: 'edit',
                        child: Row(children: [
                          Icon(Icons.edit_outlined, size: 18),
                          SizedBox(width: 8),
                          Text('Edit & Resend'),
                        ]),
                      ),
                    if (canManage && isDraft)
                      const PopupMenuItem(
                        value: 'send',
                        child: Row(children: [
                          Icon(Icons.send_outlined, size: 18),
                          SizedBox(width: 8),
                          Text('Send Now'),
                        ]),
                      ),
                    if (canManage && item.status == 'Failed')
                      const PopupMenuItem(
                        value: 'retry',
                        child: Row(children: [
                          Icon(Icons.refresh, size: 18),
                          SizedBox(width: 8),
                          Text('Retry'),
                        ]),
                      ),
                    if (canManage)
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(children: [
                          Icon(Icons.delete_outline, size: 18, color: AppColors.error),
                          SizedBox(width: 8),
                          Text('Delete', style: TextStyle(color: AppColors.error)),
                        ]),
                      ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 12,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _statRow(
                  Icons.send_outlined,
                  '${item.sentCount} / ${item.recipientCount} sent',
                  AppColors.textSecondary,
                ),
                if (item.failedCount > 0)
                  _statRow(
                    Icons.error_outline,
                    '${item.failedCount} failed',
                    AppColors.error,
                  ),
                if (() {
                  final pending = item.recipientCount -
                      item.sentCount -
                      item.failedCount;
                  return pending > 0;
                }())
                  _statRow(
                    Icons.schedule,
                    '${item.recipientCount - item.sentCount - item.failedCount} pending',
                    Colors.amber.shade700,
                  ),
                Text(
                  'Created ${_formatDate(item.createdDate)}',
                  style: AppTextStyles.caption
                      .copyWith(color: AppColors.textSecondary),
                ),
              ],
            ),
          ],
        ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Compose / Edit Page
// ---------------------------------------------------------------------------
class _MassEmailComposePage extends StatefulWidget {
  final int districtId;
  final _MassEmail? existing;
  final List<_ClubOption> clubs;
  final List<_RotaryYear> years;

  const _MassEmailComposePage({
    required this.districtId,
    this.existing,
    required this.clubs,
    required this.years,
  });

  @override
  State<_MassEmailComposePage> createState() => _MassEmailComposePageState();
}

class _MassEmailComposePageState extends State<_MassEmailComposePage> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();

  final _fromNameCtrl = TextEditingController();
  final _replyNameCtrl = TextEditingController();
  final _replyEmailCtrl = TextEditingController();
  final _subjectCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();

  int _recipientType = 1;
  final Set<int> _selectedClubIds = <int>{};
  final Set<int> _selectedSubgroupIds = <int>{};

  int? _selectedYearId;
  List<_SubgroupOption> _subgroups = const [];
  bool _loadingSubgroups = false;

  _RecipientCount? _recipientCount;
  bool _countLoading = false;
  Timer? _countDebounce;

  bool _saving = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _fromNameCtrl.text = e.fromName;
      _replyNameCtrl.text = e.replyName;
      _replyEmailCtrl.text = e.replyEmail;
      _subjectCtrl.text = e.subject;
      _bodyCtrl.text = e.emailBody;
      _recipientType = e.recipientType;
      _selectedClubIds.addAll(e.selectedClubIds);
      _selectedSubgroupIds.addAll(e.selectedSubgroupIds);
    }
    // Default year selection
    if (widget.years.isNotEmpty) {
      final current = widget.years.firstWhere(
        (y) => y.isCurrent,
        orElse: () => widget.years.first,
      );
      _selectedYearId = current.id;
      if (_recipientType == 3) {
        _fetchSubgroups();
      }
    }
    _scheduleCountRefresh(immediate: true);
  }

  @override
  void dispose() {
    _countDebounce?.cancel();
    _fromNameCtrl.dispose();
    _replyNameCtrl.dispose();
    _replyEmailCtrl.dispose();
    _subjectCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchSubgroups() async {
    if (_selectedYearId == null) {
      setState(() => _subgroups = const []);
      return;
    }
    setState(() => _loadingSubgroups = true);
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/districts/${widget.districtId}/sub-groups',
        queryParams: {'yearId': _selectedYearId},
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? const [])
          .map((e) => _SubgroupOption.fromJson(e as Map<String, dynamic>))
          .toList();
      if (!mounted) return;
      setState(() {
        _subgroups = list;
        _loadingSubgroups = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _subgroups = const [];
        _loadingSubgroups = false;
      });
    }
  }

  void _scheduleCountRefresh({bool immediate = false}) {
    _countDebounce?.cancel();
    _countDebounce = Timer(
      Duration(milliseconds: immediate ? 0 : 500),
      _fetchRecipientCount,
    );
  }

  Future<void> _fetchRecipientCount() async {
    setState(() => _countLoading = true);
    try {
      final qp = <String, dynamic>{'recipientType': _recipientType};
      if (_recipientType == 2 && _selectedClubIds.isNotEmpty) {
        qp['clubIds'] = _selectedClubIds.join(',');
      }
      if (_recipientType == 3 && _selectedSubgroupIds.isNotEmpty) {
        qp['subgroupIds'] = _selectedSubgroupIds.join(',');
      }
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/mass-emails/recipient-count',
        queryParams: qp,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _recipientCount = _RecipientCount.fromJson(resp.data ?? {});
        _countLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _recipientCount = null;
        _countLoading = false;
      });
    }
  }

  String? _validateEmail(String? v) {
    if (v == null || v.trim().isEmpty) return 'Reply email is required';
    final re = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
    if (!re.hasMatch(v.trim())) return 'Enter a valid email';
    return null;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_recipientType == 2 && _selectedClubIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one club')),
      );
      return;
    }
    if (_recipientType == 3 && _selectedSubgroupIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one subgroup')),
      );
      return;
    }

    final body = <String, dynamic>{
      'recipientType': _recipientType,
      'fromName': _fromNameCtrl.text.trim(),
      'replyName': _replyNameCtrl.text.trim(),
      'replyEmail': _replyEmailCtrl.text.trim(),
      'subject': _subjectCtrl.text.trim(),
      'emailBody': _bodyCtrl.text,
      'saveAsDraft': true,
    };
    if (_recipientType == 2) {
      body['clubIds'] = _selectedClubIds.toList();
    }
    if (_recipientType == 3) {
      body['subgroupIds'] = _selectedSubgroupIds.toList();
      if (_selectedYearId != null) body['yearId'] = _selectedYearId;
    }

    setState(() => _saving = true);
    try {
      if (_isEdit) {
        await _api.put(
          '/api/districts/${widget.districtId}/mass-emails/${widget.existing!.id}',
          body: body,
        );
      } else {
        await _api.post(
          '/api/districts/${widget.districtId}/mass-emails',
          body: body,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Save failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Mass Email' : 'Compose Mass Email',
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.white),
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: AppColors.primaryPrime),
                  )
                : const Text(
                    'Save',
                    style: TextStyle(
                        color: AppColors.primaryPrime, fontWeight: FontWeight.bold),
                  ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _sectionTitle('Recipients'),
              const SizedBox(height: 8),
              _recipientTypeSelector(),
              const SizedBox(height: 12),
              if (_recipientType == 2) _buildClubsPicker(),
              if (_recipientType == 3) _buildSubgroupsPicker(),
              const SizedBox(height: 10),
              _recipientCountChip(),
              const SizedBox(height: 20),
              _sectionTitle('Email details'),
              const SizedBox(height: 8),
              CustomTextField(
                label: 'From Name *',
                controller: _fromNameCtrl,
                hint: 'e.g. District 3141',
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'From name is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Reply Name *',
                controller: _replyNameCtrl,
                hint: 'e.g. District Secretary',
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Reply name is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Reply Email *',
                controller: _replyEmailCtrl,
                hint: 'secretary@district.org',
                keyboardType: TextInputType.emailAddress,
                validator: _validateEmail,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Subject *',
                controller: _subjectCtrl,
                hint: 'Enter email subject',
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Subject is required' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                label: 'Email Body *',
                controller: _bodyCtrl,
                hint: 'Write your message...',
                maxLines: 10,
                maxLength: 20000,
                keyboardType: TextInputType.multiline,
                textInputAction: TextInputAction.newline,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Email body is required' : null,
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String title) => Text(
        title,
        style: AppTextStyles.bodyMedium
            .copyWith(fontWeight: FontWeight.w700, color: AppColors.primary),
      );

  Widget _recipientTypeSelector() {
    const options = [
      (1, 'All members'),
      (2, 'Specific Clubs'),
      (3, 'Subgroups'),
    ];
    return Column(
      children: options.map((o) {
        return RadioListTile<int>(
          value: o.$1,
          groupValue: _recipientType,
          onChanged: (v) {
            if (v == null) return;
            setState(() {
              _recipientType = v;
              if (v != 2) _selectedClubIds.clear();
              if (v != 3) _selectedSubgroupIds.clear();
            });
            if (v == 3 && _subgroups.isEmpty) _fetchSubgroups();
            _scheduleCountRefresh(immediate: true);
          },
          title: Text(o.$2),
          activeColor: AppColors.primary,
          contentPadding: EdgeInsets.zero,
          dense: true,
        );
      }).toList(),
    );
  }

  Widget _buildClubsPicker() {
    if (widget.clubs.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          'No clubs available.',
          style: AppTextStyles.caption
              .copyWith(color: AppColors.textSecondary),
        ),
      );
    }
    return Container(
      constraints: const BoxConstraints(maxHeight: 260),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: ListView.builder(
        shrinkWrap: true,
        itemCount: widget.clubs.length,
        itemBuilder: (_, i) {
          final c = widget.clubs[i];
          final selected = _selectedClubIds.contains(c.id);
          return CheckboxListTile(
            value: selected,
            onChanged: (v) {
              setState(() {
                if (v == true) {
                  _selectedClubIds.add(c.id);
                } else {
                  _selectedClubIds.remove(c.id);
                }
              });
              _scheduleCountRefresh();
            },
            title: Text(c.clubName, style: AppTextStyles.body),
            dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            activeColor: AppColors.primary,
          );
        },
      ),
    );
  }

  Widget _buildSubgroupsPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.years.isNotEmpty) ...[
          DropdownButtonFormField<int>(
            value: _selectedYearId,
            isDense: true,
            decoration: InputDecoration(
              labelText: 'Rotary Year',
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            items: widget.years
                .map((y) => DropdownMenuItem(
                      value: y.id,
                      child: Text(y.yearLabel),
                    ))
                .toList(),
            onChanged: (v) {
              if (v == null) return;
              setState(() {
                _selectedYearId = v;
                _selectedSubgroupIds.clear();
              });
              _fetchSubgroups();
              _scheduleCountRefresh();
            },
          ),
          const SizedBox(height: 10),
        ],
        Container(
          constraints: const BoxConstraints(maxHeight: 260),
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(8),
          ),
          child: _loadingSubgroups
              ? const Padding(
                  padding: EdgeInsets.all(16),
                  child: const RowSkeletonList(),
                )
              : _subgroups.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        'No subgroups available.',
                        style: AppTextStyles.caption
                            .copyWith(color: AppColors.textSecondary),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: _subgroups.length,
                      itemBuilder: (_, i) {
                        final g = _subgroups[i];
                        final selected =
                            _selectedSubgroupIds.contains(g.id);
                        return CheckboxListTile(
                          value: selected,
                          onChanged: (v) {
                            setState(() {
                              if (v == true) {
                                _selectedSubgroupIds.add(g.id);
                              } else {
                                _selectedSubgroupIds.remove(g.id);
                              }
                            });
                            _scheduleCountRefresh();
                          },
                          title: Text(
                            '${g.groupName} (${g.memberCount} members)',
                            style: AppTextStyles.body,
                          ),
                          dense: true,
                          controlAffinity: ListTileControlAffinity.leading,
                          activeColor: AppColors.primary,
                        );
                      },
                    ),
        ),
      ],
    );
  }

  Widget _recipientCountChip() {
    if (_countLoading) {
      return Row(
        children: [
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Text(
            'Calculating recipients...',
            style: AppTextStyles.caption
                .copyWith(color: AppColors.textSecondary),
          ),
        ],
      );
    }
    final c = _recipientCount;
    if (c == null) return const SizedBox.shrink();
    final hasRecipients = c.membersWithEmail > 0;
    final color = hasRecipients ? AppColors.success : Colors.amber.shade800;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.people_outline, size: 14, color: color),
          const SizedBox(width: 6),
          Text(
            'Recipients: ${c.membersWithEmail} / ${c.totalMembers}',
            style: AppTextStyles.caption
                .copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Read-only Detail Page (shared detail toolkit)
// ---------------------------------------------------------------------------
/// Renders emailBody as plain text. The web composer stores rich HTML, so when
/// the body looks like HTML we strip the tags (and decode a few common
/// entities) before display; plain-text bodies pass through unchanged.
String _emailBodyAsText(String raw) {
  final body = raw.trim();
  if (body.isEmpty) return '';
  final looksHtml = RegExp(r'<[a-zA-Z/!][^>]*>').hasMatch(body);
  if (!looksHtml) return body;
  var text = body
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</(p|div|li|tr|h[1-6])>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]+>'), '');
  text = text
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'");
  // Collapse the runs of blank lines that tag-stripping tends to produce.
  text = text.replaceAll(RegExp(r'\n{3,}'), '\n\n');
  return text.trim();
}

class _MassEmailDetailScreen extends StatefulWidget {
  final int districtId;
  final int emailId;
  final _MassEmail fallback;
  const _MassEmailDetailScreen({
    required this.districtId,
    required this.emailId,
    required this.fallback,
  });

  @override
  State<_MassEmailDetailScreen> createState() => _MassEmailDetailScreenState();
}

class _MassEmailDetailScreenState extends State<_MassEmailDetailScreen> {
  final _api = ApiClient();
  late _MassEmail _email = widget.fallback; // seed so it never opens blank
  bool _loading = true;
  String? _error;

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
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}/mass-emails/${widget.emailId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        if (resp.data != null) _email = _MassEmail.fromJson(resp.data!);
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

  String _recipientDescription(_MassEmail e) {
    switch (e.recipientType) {
      case 2:
        return '${_recipientTypeLabel(2)} (${e.selectedClubIds.length})';
      case 3:
        return '${_recipientTypeLabel(3)} (${e.selectedSubgroupIds.length})';
      case 1:
      default:
        return _recipientTypeLabel(1);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _email;
    final showLoading = _loading && e.id == 0;
    return DetailScaffold(
      title: 'Mass Email',
      loading: showLoading,
      error: e.id == 0 ? _error : null,
      onRetry: _fetch,
      body: (_) {
        final created = _formatDate(e.createdDate);
        final body = _emailBodyAsText(e.emailBody);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            DetailHeader(
              title: e.subject.isEmpty ? '(No subject)' : e.subject,
              status: e.status,
              meta: created != '–' ? 'Created $created' : null,
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
                  DetailRow(label: 'Created', value: created),
                ],
              ),
            ),
            const SizedBox(height: 12),
            DetailSectionCard(
              icon: Icons.person_outline,
              title: 'Sender',
              number: 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (e.fromName.isNotEmpty)
                    DetailRow(label: 'From Name', value: e.fromName),
                  if (e.replyName.isNotEmpty)
                    DetailRow(label: 'Reply Name', value: e.replyName),
                  if (e.replyEmail.isNotEmpty)
                    DetailRow(label: 'Reply Email', value: e.replyEmail),
                ],
              ),
            ),
            const SizedBox(height: 12),
            DetailSectionCard(
              icon: Icons.people_outline,
              title: 'Recipients',
              number: 3,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DetailRow(
                      label: 'Recipient Type',
                      value: _recipientDescription(e)),
                  DetailRow(
                      label: 'Recipient Count', value: '${e.recipientCount}'),
                  DetailRow(label: 'Sent Count', value: '${e.sentCount}'),
                  DetailRow(label: 'Failed Count', value: '${e.failedCount}'),
                ],
              ),
            ),
            const SizedBox(height: 12),
            DetailSectionCard(
              icon: Icons.notes_outlined,
              title: 'Message',
              number: 4,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.background,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.border),
                ),
                child: SelectableText(
                  body.isEmpty ? '(No content)' : body,
                  style: AppTextStyles.bodyMedium,
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],
        );
      },
    );
  }
}
