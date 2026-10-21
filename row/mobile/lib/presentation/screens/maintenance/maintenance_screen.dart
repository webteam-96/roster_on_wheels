import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/maintenance/maintenance_controller.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/maintenance/maintenance_panel.dart';

/// Full-screen target of the route-level maintenance gate. The router redirects
/// a blocked navigation here with `?key=<matched RouteKey>` (or `*` for global)
/// so the correct message/ETA can be shown.
class MaintenanceScreen extends StatelessWidget {
  final String? routeKey;
  const MaintenanceScreen({super.key, this.routeKey});

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<MaintenanceController>();
    final entry = (routeKey == null || routeKey!.isEmpty)
        ? null
        : ctrl.registry.entryForKey(routeKey!);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Under Maintenance'),
      body: MaintenancePanel(
        message: entry?.message,
        until: entry?.until,
        onRetry: () async {
          await ctrl.refresh();
          if (!context.mounted) return;
          // If the flag cleared, leave the maintenance screen.
          final stillBlocked = routeKey != null &&
              routeKey!.isNotEmpty &&
              ctrl.registry.isKeyBlocked(routeKey!);
          if (!stillBlocked) {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go(RouteNames.home);
            }
          }
        },
      ),
    );
  }
}
