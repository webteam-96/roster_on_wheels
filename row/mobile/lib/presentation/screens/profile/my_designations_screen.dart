import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/date_formatter.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';

/// The member's own Rotary Foundation designations (Paul Harris Fellow and so on; feature `membership_fields`).
/// Read-only: club and district admins record them on the web.
class MyDesignationsScreen extends StatefulWidget {
  const MyDesignationsScreen({super.key});

  @override
  State<MyDesignationsScreen> createState() => _MyDesignationsScreenState();
}

class _MyDesignationsScreenState extends State<MyDesignationsScreen> {
  final _api = ApiClient();
  List<Map<String, dynamic>>? _rows;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final memberId = context.read<AuthProvider>().memberId;
    try {
      final res = await _api.get<List<dynamic>>('/api/members/$memberId/foundation-designations',
          fromJson: (j) => j as List<dynamic>);
      if (mounted) setState(() => _rows = (res.data ?? const []).cast<Map<String, dynamic>>());
    } catch (_) {
      if (mounted) setState(() => _rows = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return Scaffold(
      appBar: const CustomAppBar(title: 'My Foundation designations'),
      body: rows == null
          ? const LoadingWidget()
          : rows.isEmpty
              ? const EmptyStateWidget(
                  icon: Icons.workspace_premium_outlined,
                  title: 'No designations recorded',
                  subtitle: 'Your club records Paul Harris Fellow and other Foundation recognitions.')
              : ListView.separated(
                  itemCount: rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final r = rows[i];
                    return ListTile(
                      leading: const Icon(Icons.workspace_premium_outlined),
                      title: Text(r['label'] as String? ?? ''),
                      subtitle: Text(DateFormatter.toDisplay(DateTime.tryParse(r['awardedDate']?.toString() ?? ''))),
                    );
                  },
                ),
    );
  }
}
