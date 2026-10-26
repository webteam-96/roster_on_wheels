import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/volunteer_api.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';

/// Share the member's personal guest invite link for one of their clubs (N3, feature `contacts_growth`).
/// A guest who replies through it is added to the club's contacts (source 'invite').
class InviteGuestScreen extends StatefulWidget {
  const InviteGuestScreen({super.key, this.api});
  final VolunteerApi? api;

  @override
  State<InviteGuestScreen> createState() => _InviteGuestScreenState();
}

class _InviteGuestScreenState extends State<InviteGuestScreen> {
  late final VolunteerApi _api = widget.api ?? VolunteerApi();
  int? _busyClub;

  Future<void> _share(int clubId, String clubName) async {
    setState(() => _busyClub = clubId);
    try {
      final url = await _api.inviteLink(clubId);
      if (!mounted) return;
      if (url == null) {
        SnackbarUtils.showError(context, 'Could not get your invite link. Please try again.');
        return;
      }
      await Share.share('Join me at a meeting of $clubName: $url', subject: 'An invitation from $clubName');
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    } finally {
      if (mounted) setState(() => _busyClub = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final clubs = auth.memberClubIds.toSet().toList();
    return Scaffold(
      appBar: const CustomAppBar(title: 'Invite a guest'),
      body: clubs.isEmpty
          ? const EmptyStateWidget(
              icon: Icons.group_add_outlined,
              title: 'No club',
              subtitle: 'Invite links belong to the clubs you are a member of.')
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(4, 0, 4, 12),
                  child: Text("Share your personal link. Guests who reply through it are added to your club's contacts."),
                ),
                for (final id in clubs)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.group_add_outlined),
                      title: Text(auth.clubNameOf(id) ?? 'Club $id'),
                      trailing: _busyClub == id
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.share_outlined),
                      onTap: _busyClub == null ? () => _share(id, auth.clubNameOf(id) ?? 'my club') : null,
                    ),
                  ),
              ],
            ),
    );
  }
}
