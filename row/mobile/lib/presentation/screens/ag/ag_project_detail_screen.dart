import 'package:flutter/material.dart' hide Text;
import '../../../core/constants/api_constants.dart';
import '../../../core/services/ag_dashboard_api.dart';
import '../../../core/services/project_share_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/money_format.dart';
import '../../../data/models/ag_dashboard_models.dart';
import 'widgets/ag_async.dart';
import 'widgets/ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// AG project detail — full detail + photos for one project, fetched on demand
/// from `GET /api/mobile/ag-dashboard/projects/{projectId}`. Mirrors the web
/// `ProjectDetailModal`: a two-column field grid (same order/labels), an
/// optional description, and a primary-first photo grid with a tap-to-zoom
/// lightbox. The tapped list [row] seeds the header so the screen is never
/// blank while loading.
class AgProjectDetailScreen extends StatefulWidget {
  final int projectId;
  final int? yearId;
  final AgProjectRow row; // fallback for instant title/club
  const AgProjectDetailScreen({
    super.key,
    required this.projectId,
    required this.yearId,
    required this.row,
  });

  @override
  State<AgProjectDetailScreen> createState() => _AgProjectDetailScreenState();
}

class _AgProjectDetailScreenState extends State<AgProjectDetailScreen> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgProjectDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<AgProjectDetail> _load() =>
      _api.getProjectDetail(widget.projectId, yearId: widget.yearId);

  void _reload() => setState(() => _future = _load());

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        backgroundColor: AppColors.primaryPrime,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          'Project Details',
          style: AppFonts.body(
            fontWeight: FontWeight.w800,
            fontSize: 15,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Share',
            icon: const Icon(Icons.share_outlined),
            onPressed: () => shareProject(context,
                projectId: widget.projectId, yearId: widget.yearId),
          ),
        ],
      ),
      body: FutureBuilder<AgProjectDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const AgLoading();
          }
          if (snap.hasError) {
            return AgError(error: snap.error!, onRetry: _reload);
          }
          return _Body(detail: snap.data!, currency: widget.row.currency);
        },
      ),
    );
  }
}

class _Body extends StatelessWidget {
  final AgProjectDetail detail;
  // The detail endpoint carries no currency; the list row's currency is passed
  // through so Cost renders in the project's own currency (web parity).
  final String currency;
  const _Body({required this.detail, required this.currency});

  String get _jointProject {
    if (!detail.isJointProject) return 'No';
    final host = (detail.coHostName ?? '').trim();
    if (host.isEmpty) return 'Yes';
    final role = (detail.clubRole ?? '').trim();
    return role.isEmpty ? 'Yes: with $host' : 'Yes: with $host ($role)';
  }

  String get _manHours => detail.manHoursIsPending
      ? 'Pending'
      : (detail.manHours > 0 ? agFmtInt(detail.manHours) : '–');

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Title + club · RY
          Text(
            detail.title.isEmpty ? '–' : detail.title,
            style: AppFonts.body(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            detail.yearLabel.isEmpty
                ? detail.clubName
                : '${detail.clubName} · RY ${detail.yearLabel}',
            style: AppFonts.body(
              fontSize: 12,
              color: AppColors.slate500,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 14),

          // Field grid (2 columns), web order.
          _Card(
            child: _FieldGrid(fields: [
              _F('Club', detail.clubName),
              _F('Date', agFmtDate(detail.date)),
              _F('Avenue of Service', detail.avenue),
              _F('Area of Focus', detail.areaOfFocus),
              _F('Location', detail.location),
              _F('Funding', detail.funding, chip: _FundingChip(detail.funding)),
              // Detail endpoint carries no currency; fall back to the list
              // row's currency (matches web `d?.currency ?? row.currency`).
              _F('Cost', detail.cost > 0
                  ? formatMoney(detail.cost, currency)
                  : null),
              _F('Beneficiaries',
                  detail.beneficiaries > 0 ? agFmtInt(detail.beneficiaries) : null),
              _F('Man Hours', _manHours, muted: detail.manHoursIsPending),
              _F('Rotarians',
                  detail.rotariansInvolved > 0 ? agFmtInt(detail.rotariansInvolved) : null),
              _F('Rotaractors',
                  detail.rotaractorsInvolved > 0 ? agFmtInt(detail.rotaractorsInvolved) : null),
              _F('Project Type', detail.projectType),
              _F('Joint Project', _jointProject),
            ]),
          ),

          // Description
          if ((detail.description ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: 12),
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _FieldLabel('Description'),
                  const SizedBox(height: 4),
                  Text(
                    detail.description!.trim(),
                    style: AppFonts.body(
                      fontSize: 12.5,
                      color: AppColors.textPrimary,
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Photos
          const SizedBox(height: 12),
          _Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _FieldLabel(detail.photos.isEmpty
                    ? 'Photos'
                    : 'Photos (${detail.photos.length})'),
                const SizedBox(height: 8),
                if (detail.photos.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    child: Text(
                      'No photos uploaded for this project.',
                      style: AppFonts.body(
                        fontSize: 11.5,
                        color: AppColors.slate400,
                      ),
                    ),
                  )
                else
                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 2,
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                    childAspectRatio: 4 / 3,
                    children: [
                      for (var i = 0; i < detail.photos.length; i++)
                        _PhotoTile(
                          photo: detail.photos[i],
                          onTap: () => _openLightbox(context, i),
                        ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openLightbox(BuildContext context, int index) {
    showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.88),
      builder: (_) => _Lightbox(photos: detail.photos, initialIndex: index),
    );
  }
}

/// One field entry (label + value, optional chip / muted).
class _F {
  final String label;
  final String? value;
  final Widget? chip;
  final bool muted;
  const _F(this.label, this.value, {this.chip, this.muted = false});
}

class _FieldGrid extends StatelessWidget {
  final List<_F> fields;
  const _FieldGrid({required this.fields});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      const gap = 12.0;
      final colW = ((c.maxWidth - gap) / 2).floorToDouble();
      return Wrap(
        spacing: gap,
        runSpacing: 12,
        children: [
          for (final f in fields)
            SizedBox(width: colW, child: _FieldView(field: f)),
        ],
      );
    });
  }
}

class _FieldView extends StatelessWidget {
  final _F field;
  const _FieldView({required this.field});

  @override
  Widget build(BuildContext context) {
    final empty = field.value == null || field.value!.trim().isEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FieldLabel(field.label),
        const SizedBox(height: 3),
        if (field.chip != null && !empty)
          field.chip!
        else
          Text(
            empty ? '–' : field.value!,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: empty
                  ? AppColors.slate400
                  : (field.muted ? AppColors.slate500 : AppColors.textPrimary),
              height: 1.3,
            ),
          ),
      ],
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: AppFonts.body(
        fontSize: 9.5,
        fontWeight: FontWeight.w800,
        color: AppColors.slate400,
        letterSpacing: 0.5,
      ),
    );
  }
}

class _Card extends StatelessWidget {
  final Widget child;
  const _Card({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: child,
    );
  }
}

/// Funding chip — mirrors web `FundingChip` color map (self→emerald,
/// global→amber, district→indigo, sponsor→purple, else blue).
class _FundingChip extends StatelessWidget {
  final String funding;
  const _FundingChip(this.funding);

  ({Color bg, Color fg}) get _style {
    final f = funding.toLowerCase();
    if (f.contains('self')) {
      return (bg: AppColors.background, fg: AppColors.successDark);
    }
    if (f.contains('global')) {
      return (bg: AppColors.warningLight, fg: AppColors.warningInk);
    }
    if (f.contains('district')) {
      return (bg: AppColors.muted, fg: AppColors.primaryPrime);
    }
    if (f.contains('sponsor')) {
      return (bg: AppColors.muted, fg: AppColors.primaryPrime);
    }
    return (bg: AppColors.muted, fg: AppColors.rotaryBlue);
  }

  @override
  Widget build(BuildContext context) {
    final s = _style;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: s.bg,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          funding,
          style: AppFonts.body(
            fontSize: 10.5,
            fontWeight: FontWeight.w800,
            color: s.fg,
          ),
        ),
      ),
    );
  }
}

class _PhotoTile extends StatelessWidget {
  final AgProjectPhoto photo;
  final VoidCallback onTap;
  const _PhotoTile({required this.photo, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final url = ApiConstants.mediaUrl(photo.url);
    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(
              color: AppColors.slate100,
              child: url.isEmpty
                  ? const _PhotoFallback()
                  : Image.network(
                      url,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const _PhotoFallback(),
                    ),
            ),
            if (photo.isPrimary)
              Positioned(
                top: 6,
                left: 6,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.92),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'PRIMARY',
                    style: AppFonts.body(
                      fontSize: 8,
                      fontWeight: FontWeight.w800,
                      color: AppColors.slate700,
                      letterSpacing: 0.4,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PhotoFallback extends StatelessWidget {
  const _PhotoFallback();
  @override
  Widget build(BuildContext context) => const Center(
        child: Icon(Icons.image_not_supported_outlined,
            size: 22, color: AppColors.slate400),
      );
}

/// Full-screen photo viewer with swipe + pinch-zoom.
class _Lightbox extends StatefulWidget {
  final List<AgProjectPhoto> photos;
  final int initialIndex;
  const _Lightbox({required this.photos, required this.initialIndex});

  @override
  State<_Lightbox> createState() => _LightboxState();
}

class _LightboxState extends State<_Lightbox> {
  late final PageController _pc =
      PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _pc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: EdgeInsets.zero,
      backgroundColor: Colors.transparent,
      child: Stack(
        children: [
          PageView.builder(
            controller: _pc,
            itemCount: widget.photos.length,
            onPageChanged: (i) => setState(() => _index = i),
            itemBuilder: (_, i) {
              final url = ApiConstants.mediaUrl(widget.photos[i].url);
              return InteractiveViewer(
                minScale: 1,
                maxScale: 4,
                child: Center(
                  child: url.isEmpty
                      ? const _PhotoFallback()
                      : Image.network(url, fit: BoxFit.contain,
                          errorBuilder: (_, __, ___) => const _PhotoFallback()),
                ),
              );
            },
          ),
          Positioned(
            top: 8,
            right: 8,
            child: SafeArea(
              child: IconButton(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close_rounded, color: Colors.white),
              ),
            ),
          ),
          if (widget.photos.length > 1)
            Positioned(
              bottom: 16,
              left: 0,
              right: 0,
              child: SafeArea(
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '${_index + 1} / ${widget.photos.length}',
                      style: AppFonts.body(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
