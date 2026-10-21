import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/api_client.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/detail/detail_hero_layout.dart';

class _EventDetail {
  final int id;
  final String title;
  final String? description;
  final String? imagePath;
  final DateTime? eventDate;
  final DateTime? publishDate;
  final DateTime? expiryDate;
  final String? eventVenue;
  final String? registrationLink;
  final bool isSendEmail;
  final bool isRepeatNotification;
  final String status;
  final List<DateTime> reminders;

  const _EventDetail({
    required this.id,
    required this.title,
    required this.status,
    required this.reminders,
    this.description,
    this.imagePath,
    this.eventDate,
    this.publishDate,
    this.expiryDate,
    this.eventVenue,
    this.registrationLink,
    this.isSendEmail = false,
    this.isRepeatNotification = false,
  });

  factory _EventDetail.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v == null ? null : DateTime.tryParse(v.toString());
    final rawReminders = (j['reminders'] as List<dynamic>? ?? const []);
    final reminders = rawReminders
        .map((r) {
          if (r is Map<String, dynamic>) return parse(r['reminderDateTime']);
          return parse(r);
        })
        .whereType<DateTime>()
        .toList();
    return _EventDetail(
      id: j['id'] as int? ?? 0,
      title: j['title']?.toString() ?? '',
      description: j['description']?.toString(),
      imagePath: j['imagePath']?.toString(),
      eventDate: parse(j['eventDate']),
      publishDate: parse(j['publishDate']),
      expiryDate: parse(j['expiryDate']),
      eventVenue: j['eventVenue']?.toString(),
      registrationLink: j['registrationLink']?.toString(),
      isSendEmail: j['isSendEmail'] as bool? ?? false,
      isRepeatNotification: j['isRepeatNotification'] as bool? ?? false,
      status: j['status']?.toString() ?? 'Unpublished',
      reminders: reminders,
    );
  }
}

class RiDirectorUpcomingEventDetailScreen extends StatefulWidget {
  final int eventId;
  const RiDirectorUpcomingEventDetailScreen({super.key, required this.eventId});

  @override
  State<RiDirectorUpcomingEventDetailScreen> createState() =>
      _RiDirectorUpcomingEventDetailScreenState();
}

class _RiDirectorUpcomingEventDetailScreenState
    extends State<RiDirectorUpcomingEventDetailScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  _EventDetail? _detail;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/ri-director/upcoming-events/${widget.eventId}',
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!mounted) return;
      setState(() {
        _detail = _EventDetail.fromJson(resp.data ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _delete() async {
    final d = _detail;
    if (d == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: AppColors.error),
            const SizedBox(width: 8),
            Text('Delete Event', style: AppTextStyles.h3),
          ],
        ),
        content: Text('Are you sure you want to delete "${d.title}"?', style: AppTextStyles.body),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error, foregroundColor: Colors.white),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    setState(() => _deleting = true);
    try {
      await _api.delete('/api/ri-director/upcoming-events/${widget.eventId}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Event deleted'), backgroundColor: AppColors.success),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _deleting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $e'), backgroundColor: AppColors.error),
      );
    }
  }

  Future<void> _openEdit() async {
    final changed = await context.push<bool>(
      RouteNames.riDirectorUpcomingEventEdit(widget.eventId),
    );
    if (changed == true) _load();
  }

  String _formatDT(DateTime? d) {
    if (d == null || d.year <= 1) return '–'; // `0001-01-01` zero date => no value
    final dd = d.day.toString().padLeft(2, '0');
    final mm = d.month.toString().padLeft(2, '0');
    final hh = d.hour.toString().padLeft(2, '0');
    final mi = d.minute.toString().padLeft(2, '0');
    return '$dd/$mm/${d.year}  $hh:$mi';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Event',
        actions: _detail == null
            ? null
            : [
                IconButton(
                  icon: const Icon(Icons.edit_outlined),
                  tooltip: 'Edit',
                  onPressed: _openEdit,
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, color: AppColors.error),
                  tooltip: 'Delete',
                  onPressed: _deleting ? null : _delete,
                ),
              ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _load)
              : _detail == null
                  ? const Center(child: Text('No data'))
                  : _buildBody(_detail!),
    );
  }

  Widget _buildBody(_EventDetail d) {
    final img = (d.imagePath != null && d.imagePath!.isNotEmpty)
        ? ApiConstants.mediaUrl(d.imagePath)
        : null;
    final hasEventDate = d.eventDate != null && d.eventDate!.year > 1;
    final eventDate = _formatDT(d.eventDate);
    final hasReg = (d.registrationLink ?? '').trim().isNotEmpty;

    // Event date & venue live in the chips row above. Publish/Expiry and
    // notification settings are intentionally NOT shown on the detail page.
    final rows = <DetailKV>[
      if (hasReg)
        DetailKV('Registration', d.registrationLink!.trim(),
            url: d.registrationLink!.trim()),
    ];

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: [
          DetailHeroGallery(urls: [if (img != null) img]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DetailHeroTitle(title: d.title),
                DetailHeroChips(chips: [
                  DetailHeroStatusPill(label: d.status),
                  if (hasEventDate)
                    detailInfoChip(Icons.event_outlined, eventDate),
                  if ((d.eventVenue ?? '').trim().isNotEmpty)
                    detailInfoChip(
                        Icons.location_on_outlined, d.eventVenue!.trim()),
                ]),
                DetailHeroParagraph(text: d.description ?? ''),
                DetailHeroInfoCard(rows: rows),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
