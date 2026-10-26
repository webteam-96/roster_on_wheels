import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_response.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/custom_drawer.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/pagination_widget.dart';
import '../../widgets/common/search_bar_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
class _LoginLog {
  final int id;
  final String memberName;
  final String? emailOrPhone;
  final String status;
  final String? ipAddress;
  final String? userAgent;
  final DateTime? loginAt;

  const _LoginLog({
    required this.id,
    required this.memberName,
    this.emailOrPhone,
    this.status = 'Success',
    this.ipAddress,
    this.userAgent,
    this.loginAt,
  });

  factory _LoginLog.fromJson(Map<String, dynamic> j) => _LoginLog(
        id: j['id'] as int? ?? 0,
        memberName: j['memberName'] as String? ?? j['name'] as String? ?? 'Unknown',
        emailOrPhone: j['emailOrPhone'] as String? ?? j['email'] as String? ?? j['phone'] as String?,
        status: j['status'] as String? ?? 'Success',
        ipAddress: j['ipAddress'] as String? ?? j['ip'] as String?,
        userAgent: j['userAgent'] as String?,
        loginAt: j['loginAt'] != null ? DateTime.tryParse(j['loginAt'] as String) : null,
      );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class LoginLogsScreen extends StatefulWidget {
  const LoginLogsScreen({super.key});

  @override
  State<LoginLogsScreen> createState() => _LoginLogsScreenState();
}

class _LoginLogsScreenState extends State<LoginLogsScreen> {
  final _api = ApiClient();
  final _df = DateFormat('dd MMM yyyy, hh:mm a');

  final List<_LoginLog> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  String _search = '';
  String _statusFilter = '';
  static const int _pageSize = 20;

  static const _statusOptions = ['', 'Success', 'Failed'];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      if (!auth.canAccessLoginLogs) {
        context.go(RouteNames.home);
        return;
      }
      _fetch(reset: true);
    });
  }

  Future<void> _fetch({bool reset = false}) async {
    if (reset) {
      setState(() { _page = 1; _items.clear(); _loading = true; _error = null; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/auth/login-logs',
        queryParams: {
          'page': _page,
          'pageSize': _pageSize,
          if (_search.isNotEmpty) 'search': _search,
          if (_statusFilter.isNotEmpty) 'status': _statusFilter,
        },
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final paged = PagedResponse.fromJson(resp.data ?? {}, (j) => _LoginLog.fromJson(j));
      setState(() {
        _items.addAll(paged.items);
        // Backend (/api/auth/login-logs) returns no totalPages — derive it.
        _totalPages = paged.totalCount == 0 ? 1 : ((paged.totalCount + _pageSize - 1) ~/ _pageSize);
        _totalCount = paged.totalCount;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; _loadingMore = false; });
    }
  }

  void _onSearch(String value) {
    _search = value;
    _fetch(reset: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Login Logs'),
      drawer: const CustomDrawer(),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: SearchBarWidget(hint: 'Search by name or email...', onSearch: _onSearch),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: _statusOptions.map((opt) {
                final selected = _statusFilter == opt;
                final label = opt.isEmpty ? 'All' : opt;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(label),
                    selected: selected,
                    onSelected: (_) {
                      _statusFilter = opt;
                      _fetch(reset: true);
                    },
                    selectedColor: AppColors.primaryLight,
                    checkmarkColor: AppColors.primary,
                    labelStyle: AppTextStyles.caption.copyWith(
                      color: selected ? AppColors.primary : AppColors.textSecondary,
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          Expanded(
            child: _loading
                ? const ShimmerList(itemCount: 10, itemHeight: 80)
                : _error != null
                    ? ErrorStateWidget(message: _error!, onRetry: () => _fetch(reset: true))
                    : _items.isEmpty
                        ? const EmptyStateWidget(
                            title: 'No Login Logs',
                            subtitle: 'No login activity found.',
                            icon: Icons.history_outlined,
                          )
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: () => _fetch(reset: true),
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: _items.length + 1,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (ctx, i) {
                                if (i == _items.length) {
                                  return PaginationWidget(
                                    currentPage: _page,
                                    totalPages: _totalPages,
                                    totalCount: _totalCount,
                                    isLoading: _loadingMore,
                                    onLoadMore: () {
                                      if (_page < _totalPages && !_loadingMore) { _page++; _fetch(); }
                                    },
                                  );
                                }
                                return _LoginLogTile(item: _items[i], df: _df);
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------
class _LoginLogTile extends StatelessWidget {
  final _LoginLog item;
  final DateFormat df;

  const _LoginLogTile({required this.item, required this.df});

  @override
  Widget build(BuildContext context) {
    final isSuccess = item.status.toLowerCase() == 'success';
    final statusColor = isSuccess ? AppColors.success : AppColors.error;

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                isSuccess ? Icons.login_outlined : Icons.block_outlined,
                size: 20,
                color: statusColor,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.memberName, style: AppTextStyles.bodyMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (item.emailOrPhone != null)
                    Text(item.emailOrPhone!, style: AppTextStyles.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
                  Row(
                    children: [
                      if (item.ipAddress != null) ...[
                        const Icon(Icons.computer_outlined, size: 10, color: AppColors.textSecondary),
                        const SizedBox(width: 3),
                        Text(item.ipAddress!, style: AppTextStyles.caption),
                        const SizedBox(width: 8),
                      ],
                      if (item.loginAt != null) ...[
                        const Icon(Icons.access_time_outlined, size: 10, color: AppColors.textSecondary),
                        const SizedBox(width: 3),
                        Text(df.format(item.loginAt!), style: AppTextStyles.caption),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                item.status,
                style: AppTextStyles.caption.copyWith(color: statusColor, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
