import 'package:flutter/material.dart' hide Text;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/utils/snackbar_utils.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// Friends of the club (feature `contacts_growth`): non-members who get the club's emails and event invites. Club
/// officers see the list and add a friend they met; the API allows only the club's managers (403 otherwise).
/// Friends are contacts, never members, so they never count in reports, attendance or the Rotary.org sync.
class FriendsScreen extends StatefulWidget {
  const FriendsScreen({super.key, this.api});
  final ApiClient? api;

  @override
  State<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends State<FriendsScreen> {
  late final ApiClient _api = widget.api ?? ApiClient();
  int? _clubId;
  List<Map<String, dynamic>>? _friends;
  String? _error;
  String _search = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final clubs = context.read<AuthProvider>().memberClubIds.toSet().toList();
      if (clubs.isEmpty) {
        setState(() => _friends = const []);
        return;
      }
      _clubId = clubs.first;
      _load();
    });
  }

  Future<void> _load() async {
    final club = _clubId;
    if (club == null) return;
    setState(() { _friends = null; _error = null; });
    try {
      final res = await _api.get<Map<String, dynamic>>('/api/clubs/$club/contacts',
          queryParams: {'type': 'friend', 'pageSize': 500, if (_search.isNotEmpty) 'search': _search},
          fromJson: (j) => j as Map<String, dynamic>);
      if (!mounted) return;
      setState(() => _friends = ((res.data?['items'] as List?) ?? const []).cast<Map<String, dynamic>>());
    } on ApiException catch (e) {
      if (mounted) setState(() { _friends = const []; _error = e.message; });
    } catch (_) {
      if (mounted) setState(() { _friends = const []; _error = 'Could not load the friends of the club.'; });
    }
  }

  Future<void> _add() async {
    final name = TextEditingController(), email = TextEditingController(), phone = TextEditingController();
    final ok = await showRowDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add a friend of the club'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: name, maxLength: 200, decoration: const InputDecoration(labelText: 'Name')),
            TextField(controller: email, maxLength: 200, keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(labelText: 'Email')),
            TextField(controller: phone, maxLength: 30, keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Phone')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    if (name.text.trim().isEmpty) {
      SnackbarUtils.showError(context, 'Please enter a name.');
      return;
    }
    try {
      await _api.post<dynamic>('/api/clubs/$_clubId/contacts', body: {
        'name': name.text.trim(), 'email': email.text.trim(), 'mobile': phone.text.trim(), 'contactType': 'friend',
      });
      if (!mounted) return;
      SnackbarUtils.showSuccess(context, 'Friend added. They will get the club\'s emails and event invites.');
      _load();
    } on ApiException catch (e) {
      if (mounted) SnackbarUtils.showError(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final clubs = auth.memberClubIds.toSet().toList();
    final friends = _friends;
    return Scaffold(
      appBar: const CustomAppBar(title: 'Friends of the club'),
      floatingActionButton: _error == null && _clubId != null
          ? FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.person_add_alt_outlined), label: const Text('Add friend'))
          : null,
      body: Column(children: [
        if (clubs.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: DropdownButtonFormField<int>(
              initialValue: _clubId,
              decoration: const InputDecoration(labelText: 'Club'),
              items: [for (final id in clubs) DropdownMenuItem(value: id, child: Text(auth.clubNameOf(id) ?? 'Club $id'))],
              onChanged: (v) { _clubId = v; _load(); },
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search name, email or phone'),
            textInputAction: TextInputAction.search,
            onSubmitted: (v) { _search = v.trim(); _load(); },
          ),
        ),
        Expanded(
          child: friends == null
              ? const ShimmerList(itemCount: 8, itemHeight: 72)
              : _error != null
                  ? ErrorStateWidget(message: _error!, onRetry: _load)
                  : friends.isEmpty
                      ? const EmptyStateWidget(
                          icon: Icons.volunteer_activism_outlined,
                          title: 'No friends of the club yet',
                          subtitle: 'Friends are not members. They get the club\'s emails and event invites.')
                      : RowRefresh(
                          onRefresh: _load,
                          child: RowListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
                            itemCount: friends.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (_, i) => _FriendTile(friend: friends[i]),
                          ),
                        ),
        ),
      ]),
    );
  }
}

class _FriendTile extends StatelessWidget {
  const _FriendTile({required this.friend});
  final Map<String, dynamic> friend;

  @override
  Widget build(BuildContext context) {
    final email = (friend['email'] as String?) ?? '';
    final phone = (friend['mobile'] as String?) ?? '';
    final org = (friend['organisation'] as String?) ?? '';
    return Card(
      child: ListTile(
        leading: const Icon(Icons.volunteer_activism_outlined),
        title: Text(friend['name'] as String? ?? ''),
        subtitle: Text([org, email, phone].where((s) => s.isNotEmpty).join('\n')),
        isThreeLine: [org, email, phone].where((s) => s.isNotEmpty).length > 1,
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          if (email.isNotEmpty)
            IconButton(tooltip: 'Email', icon: const Icon(Icons.email_outlined),
                onPressed: () => launchUrl(Uri(scheme: 'mailto', path: email))),
          if (phone.isNotEmpty)
            IconButton(tooltip: 'Call', icon: const Icon(Icons.call_outlined),
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone))),
        ]),
      ),
    );
  }
}
