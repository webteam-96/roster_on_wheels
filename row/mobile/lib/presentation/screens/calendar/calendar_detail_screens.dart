import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/calendar_model.dart';
import '../../widgets/common/custom_app_bar.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Read-only detail page for a calendar event. Built straight from the
/// [CalendarEvent] already loaded by the calendar (no extra fetch).
class CalendarEventDetailScreen extends StatelessWidget {
  final CalendarEvent event;
  const CalendarEventDetailScreen({super.key, required this.event});

  @override
  Widget build(BuildContext context) {
    final imgUrl = _mediaUrl(event.imagePath);
    final hasLink = (event.registrationLink ?? '').trim().isNotEmpty;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Event'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (imgUrl != null) _heroImage(imgUrl, Icons.event_rounded),
          if (imgUrl != null) const SizedBox(height: 16),
          Text(
            event.title,
            style: AppFonts.body(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 14),
          if (event.eventDate != null)
            _InfoRow(
              icon: Icons.calendar_today_rounded,
              label: 'Date',
              value: _formatDateTime(event.eventDate!),
            ),
          if ((event.eventVenue ?? '').isNotEmpty)
            _InfoRow(
              icon: Icons.place_rounded,
              label: 'Venue',
              value: event.eventVenue!,
            ),
          if ((event.description ?? '').isNotEmpty) ...[
            const SizedBox(height: 8),
            _sectionTitle('About'),
            const SizedBox(height: 6),
            Text(
              event.description!,
              style: AppFonts.body(
                fontSize: 14,
                height: 1.5,
                color: AppColors.textPrimary,
              ),
            ),
          ],
          if (hasLink) ...[
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => _openUrl(event.registrationLink!),
                icon: const Icon(Icons.open_in_new_rounded, size: 18),
                label: Text(
                  'Register',
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Read-only detail page for a calendar announcement.
class CalendarAnnouncementDetailScreen extends StatelessWidget {
  final CalendarAnnouncement announcement;
  const CalendarAnnouncementDetailScreen({super.key, required this.announcement});

  @override
  Widget build(BuildContext context) {
    final imgUrl = _mediaUrl(announcement.imagePath);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'Announcement'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (imgUrl != null) _heroImage(imgUrl, Icons.campaign_rounded),
          if (imgUrl != null) const SizedBox(height: 16),
          Text(
            announcement.title,
            style: AppFonts.body(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 14),
          if (announcement.publishDate != null)
            _InfoRow(
              icon: Icons.calendar_today_rounded,
              label: 'Published',
              value: DateFormat('EEE, d MMM yyyy').format(announcement.publishDate!),
            ),
          if (announcement.expiryDate != null)
            _InfoRow(
              icon: Icons.event_busy_rounded,
              label: 'Expires',
              value: DateFormat('EEE, d MMM yyyy').format(announcement.expiryDate!),
            ),
          if ((announcement.description ?? '').isNotEmpty) ...[
            const SizedBox(height: 8),
            _sectionTitle('Details'),
            const SizedBox(height: 6),
            Text(
              announcement.description!,
              style: AppFonts.body(
                fontSize: 14,
                height: 1.5,
                color: AppColors.textPrimary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ── shared bits ──────────────────────────────────────────────────────────────

Widget _heroImage(String url, IconData fallback) {
  return ClipRRect(
    borderRadius: BorderRadius.circular(14),
    child: CachedNetworkImage(
      imageUrl: url,
      width: double.infinity,
      height: 200,
      fit: BoxFit.cover,
      placeholder: (_, __) => Container(
        height: 200,
        color: AppColors.primaryLight,
      ),
      errorWidget: (_, __, ___) => Container(
        height: 200,
        color: AppColors.primaryLight,
        child: Icon(fallback, size: 48, color: AppColors.primary),
      ),
    ),
  );
}

Widget _sectionTitle(String text) => Text(
      text.toUpperCase(),
      style: AppFonts.body(
        fontSize: 11,
        fontWeight: FontWeight.w800,
        color: AppColors.textSecondary,
        letterSpacing: 1,
      ),
    );

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoRow({required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppColors.primaryLight,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 17, color: AppColors.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: AppFonts.body(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                    letterSpacing: 0.6,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
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

String _formatDateTime(DateTime d) {
  final hasTime = d.hour != 0 || d.minute != 0;
  return hasTime
      ? DateFormat('EEE, d MMM yyyy · h:mm a').format(d)
      : DateFormat('EEE, d MMM yyyy').format(d);
}

String? _mediaUrl(String? path) {
  if (path == null || path.trim().isEmpty) return null;
  return ApiConstants.mediaUrl(path);
}

Future<void> _openUrl(String raw) async {
  var url = raw.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://$url';
  }
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  try {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {}
}
