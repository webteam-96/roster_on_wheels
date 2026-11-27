import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/website_extras_api.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Share the member's club website: any public page as a link or a QR code to show or print (website extras).
class ClubWebsiteShareScreen extends StatefulWidget {
  const ClubWebsiteShareScreen({super.key, this.api});
  final WebsiteExtrasApi? api;

  @override
  State<ClubWebsiteShareScreen> createState() => _ClubWebsiteShareScreenState();
}

typedef _Site = ({int clubId, String clubName, String? siteUrl, List<({String title, String path})> pages});

class _ClubWebsiteShareScreenState extends State<ClubWebsiteShareScreen> {
  late final WebsiteExtrasApi _api = widget.api ?? WebsiteExtrasApi();
  List<_Site>? _sites;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final auth = context.read<AuthProvider>();
    setState(() => _error = null);
    try {
      final sites = <_Site>[];
      for (final c in auth.memberClubBriefs) {
        final s = await _api.clubSite(c.id);
        sites.add((clubId: c.id, clubName: c.name, siteUrl: s.siteUrl, pages: s.pages));
      }
      if (mounted) setState(() => _sites = sites);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the club website.');
    }
  }

  void _openQr(String clubName, String title, String url) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title, style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 4),
              SelectableText(url, textAlign: TextAlign.center, style: Theme.of(ctx).textTheme.bodySmall),
              const SizedBox(height: 16),
              Container(
                color: Colors.white,
                padding: const EdgeInsets.all(12),
                child: QrImageView(data: url, size: 220, backgroundColor: Colors.white,
                    semanticsLabel: 'QR code that opens $title'),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.copy_outlined),
                      label: const Text('Copy link'),
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: url));
                        if (ctx.mounted) SnackbarUtils.showSuccess(ctx, 'Link copied');
                      },
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton.icon(
                      icon: const Icon(Icons.share_outlined),
                      label: const Text('Share'),
                      onPressed: () => Share.share('$title, $clubName: $url', subject: clubName),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sites = _sites;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Share our website'),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.error_outline, title: 'Something went wrong', subtitle: _error!,
              actionLabel: 'Try again', actionIcon: Icons.refresh_rounded, onAction: _load)
          : sites == null
              ? const LoadingWidget()
              : sites.every((s) => s.siteUrl == null)
                  ? const EmptyStateWidget(
                      icon: Icons.language_outlined,
                      title: 'No club website yet',
                      subtitle: 'When your club has a website, you can share its pages here.')
                  : RowRefresh(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          for (final s in sites.where((s) => s.siteUrl != null)) _siteCard(s),
                        ],
                      ),
                    ),
    );
  }

  Widget _siteCard(_Site s) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListTile(
            title: Text(s.clubName, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(s.siteUrl!),
          ),
          for (final p in s.pages)
            ListTile(
              dense: true,
              leading: const Icon(Icons.qr_code_2_outlined),
              title: Text(p.title),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _openQr(s.clubName, p.title, WebsiteExtrasApi.pageUrl(s.siteUrl!, p.path)),
            ),
        ],
      ),
    );
  }
}
