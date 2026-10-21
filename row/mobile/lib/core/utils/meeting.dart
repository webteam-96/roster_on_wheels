import 'package:flutter/material.dart';

/// Meeting mode on meeting (attendance) records, ROW Wave 1. Same rule as the
/// API's AttendanceService.NormalizeMeeting and the admin `lib/meeting.ts`.
const meetingModes = <String, String>{'in_person': 'In person', 'online': 'Online', 'hybrid': 'Hybrid'};

String? validateMeetingLink(String mode, String? link) {
  final l = (link ?? '').trim();
  if (mode == 'in_person' || l.isEmpty) return null;
  final uri = Uri.tryParse(l);
  return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty ? null : 'The meeting link must be an https:// address.';
}

Map<String, dynamic> meetingPayload(String mode, String link) => {
      'meetingMode': mode,
      'meetingLink': mode == 'in_person' || link.trim().isEmpty ? null : link.trim(),
    };

/// Mode selector plus, for online or hybrid, the join-link field.
class MeetingModeField extends StatelessWidget {
  const MeetingModeField({super.key, required this.mode, required this.linkController, required this.onModeChanged});

  final String mode;
  final TextEditingController linkController;
  final ValueChanged<String> onModeChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<String>(
          segments: [for (final e in meetingModes.entries) ButtonSegment(value: e.key, label: Text(e.value))],
          selected: {mode},
          onSelectionChanged: (s) => onModeChanged(s.first),
          showSelectedIcon: false,
        ),
        if (mode != 'in_person') ...[
          const SizedBox(height: 8),
          TextFormField(
            controller: linkController,
            keyboardType: TextInputType.url,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'Join link',
              hintText: 'https://zoom.us/j/… or a Google Meet / Teams link',
              isDense: true,
              border: OutlineInputBorder(),
              counterText: '',
            ),
            validator: (v) => validateMeetingLink(mode, v),
          ),
        ],
      ],
    );
  }
}
