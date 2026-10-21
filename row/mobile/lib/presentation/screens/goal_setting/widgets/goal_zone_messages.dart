import 'package:flutter/material.dart';

import '../../../../core/services/goal_setting_api.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Zone-based messaging for the goal oversight roles, scoped to one
/// (category, zone, year). Mirrors the web GoalZoneMessages:
/// - RI Director / SuperAdmin: a box per Zone Co-ordinator / District Assistant
///   of the zone → tap to open its private chat.
/// - Zone Co-ordinator / District Assistant: their single own box (chat with
///   the RI Director), opened straight away.
class GoalZoneMessages extends StatefulWidget {
  final int categoryId;
  final int zoneId;
  final int yearId;
  const GoalZoneMessages({
    super.key,
    required this.categoryId,
    required this.zoneId,
    required this.yearId,
  });

  @override
  State<GoalZoneMessages> createState() => _GoalZoneMessagesState();
}

class _GoalZoneMessagesState extends State<GoalZoneMessages> {
  final GoalSettingApi _api = GoalSettingApi();

  GoalThreadList? _list;
  bool _loadingList = true;
  String? _listError;

  GoalMessageThread? _active;
  List<GoalComment>? _messages;
  bool _loadingMsgs = false;
  String? _msgError;

  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  bool _posting = false;

  @override
  void initState() {
    super.initState();
    _loadList();
  }

  @override
  void didUpdateWidget(covariant GoalZoneMessages old) {
    super.didUpdateWidget(old);
    if (old.categoryId != widget.categoryId ||
        old.zoneId != widget.zoneId ||
        old.yearId != widget.yearId) {
      _active = null;
      _messages = null;
      _loadList();
    }
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  bool get _isRiView =>
      _list?.viewerRole == 'RIDirector' || _list?.viewerRole == 'SuperAdmin';

  Future<void> _loadList() async {
    setState(() {
      _loadingList = true;
      _listError = null;
      _active = null;
      _messages = null;
    });
    try {
      final data = await _api.getZoneThreadList(
          widget.categoryId, widget.zoneId, widget.yearId);
      if (!mounted) return;
      setState(() {
        _list = data;
        _loadingList = false;
        // A DA/ZC has exactly one (own) box — open it straight away.
        if ((data.viewerRole == 'DistrictAssistant' ||
                data.viewerRole == 'ZoneCoordinator') &&
            data.threads.length == 1) {
          _active = data.threads.first;
        }
      });
      if (_active != null) _loadMessages(_active!.ownerMemberId);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingList = false;
        _listError = friendlyErrorMessage(e, fallback: 'Failed to load messages.');
      });
    }
  }

  Future<void> _loadMessages(int ownerId) async {
    setState(() {
      _loadingMsgs = true;
      _msgError = null;
    });
    try {
      final msgs = await _api.getOwnerThreadMessages(
          widget.categoryId, widget.yearId, ownerId);
      if (!mounted) return;
      setState(() {
        _messages = msgs;
        _loadingMsgs = false;
      });
      _jumpToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMsgs = false;
        _msgError = friendlyErrorMessage(e, fallback: 'Failed to load this conversation.');
      });
    }
  }

  void _jumpToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  Future<void> _post() async {
    final text = _input.text.trim();
    if (text.isEmpty || _active == null || _posting) return;
    setState(() {
      _posting = true;
      _msgError = null;
    });
    try {
      final c = await _api.postOwnerThreadMessage(
          widget.categoryId, widget.yearId, _active!.ownerMemberId, text);
      if (!mounted) return;
      setState(() {
        _messages = [...(_messages ?? const []), c];
        _input.clear();
        _posting = false;
      });
      _jumpToBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _posting = false;
        _msgError = friendlyErrorMessage(e, fallback: 'Failed to send message.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingList) {
      return _shell(
        child: Row(
          children: [
            const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 8),
            Text('Loading messages…',
                style: AppFonts.body(
                    fontSize: 12, color: AppColors.slate400)),
          ],
        ),
      );
    }
    if (_listError != null) {
      return _shell(
        child: Text(_listError!,
            style: AppFonts.body(
                fontSize: 12, color: AppColors.error)),
      );
    }
    final list = _list;
    if (list == null || list.viewerRole == 'None' || list.threads.isEmpty) {
      return _shell(
        child: Row(
          children: [
            const Icon(Icons.forum_outlined, size: 16, color: AppColors.info),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'No Zone Co-ordinator or District Assistant assigned for this zone & category yet.',
                style: AppFonts.body(
                    fontSize: 12, color: AppColors.slate400),
              ),
            ),
          ],
        ),
      );
    }

    if (_isRiView && _active == null) return _threadListView(list);
    return _chatView();
  }

  // ── RI Director / SuperAdmin: one box per ZC / DA ─────────────────────────
  Widget _threadListView(GoalThreadList list) {
    return Container(
      decoration: _cardDecoration(),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          _sectionHeader('Messages'),
          for (var i = 0; i < list.threads.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.slate100),
            _threadTile(list.threads[i]),
          ],
        ],
      ),
    );
  }

  Widget _threadTile(GoalMessageThread t) {
    return InkWell(
      onTap: () {
        setState(() => _active = t);
        _loadMessages(t.ownerMemberId);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: const BoxDecoration(
                  color: AppColors.slate100, shape: BoxShape.circle),
              child: const Icon(Icons.person_outline,
                  size: 18, color: AppColors.slate500),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 6,
                    runSpacing: 2,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(t.ownerName,
                          style: AppFonts.body(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary)),
                      if (t.ownerRoleLabel.isNotEmpty)
                        _chip(t.ownerRoleLabel, AppColors.info,
                            AppColors.infoLight),
                      if (t.scope != null && t.scope!.isNotEmpty)
                        _chip(t.scope!, AppColors.slate500, AppColors.slate100),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    t.lastMessagePreview ??
                        'No messages yet: start the conversation',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppFonts.body(
                        fontSize: 11.5, color: AppColors.slate400),
                  ),
                ],
              ),
            ),
            if (t.messageCount > 0 && t.lastMessageDate != null) ...[
              const SizedBox(width: 6),
              Text(t.lastMessageDate!,
                  style: AppFonts.body(
                      fontSize: 10, color: AppColors.slate400)),
            ],
            const Icon(Icons.chevron_right, size: 18, color: AppColors.slate400),
          ],
        ),
      ),
    );
  }

  // ── Chat view ─────────────────────────────────────────────────────────────
  Widget _chatView() {
    final active = _active;
    final header = _isRiView
        ? '${active?.ownerName ?? ''}${active?.ownerRoleLabel.isNotEmpty == true ? ' · ${active!.ownerRoleLabel}' : ''}${active?.scope != null && active!.scope!.isNotEmpty ? ' · ${active.scope}' : ''}'
        : 'Messages with ${active?.counterpartyName ?? 'RI Director'}';
    final canPost = active?.canPost ?? false;

    return Container(
      decoration: _cardDecoration(),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: const BoxDecoration(
              color: AppColors.infoLight,
              border: Border(bottom: BorderSide(color: AppColors.slate100)),
            ),
            child: Row(
              children: [
                if (_isRiView)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: InkWell(
                      onTap: () => setState(() {
                        _active = null;
                        _messages = null;
                      }),
                      borderRadius: BorderRadius.circular(8),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 5),
                        decoration: BoxDecoration(
                            color: AppColors.info,
                            borderRadius: BorderRadius.circular(8)),
                        child: const Row(mainAxisSize: MainAxisSize.min, children: [
                          Icon(Icons.chevron_left, size: 15, color: Colors.white),
                          Text('Back',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700)),
                        ]),
                      ),
                    ),
                  ),
                const Icon(Icons.forum_outlined, size: 16, color: AppColors.info),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(header,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary)),
                ),
              ],
            ),
          ),
          // messages
          ConstrainedBox(
            constraints: BoxConstraints(
                maxHeight: MediaQuery.of(context).size.height * 0.5,
                minHeight: 120),
            child: Container(
              width: double.infinity,
              color: AppColors.slate50,
              child: _messagesBody(),
            ),
          ),
          if (active?.notice != null && active!.notice!.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              color: AppColors.warningLight,
              child: Text(active.notice!,
                  style: AppFonts.body(
                      fontSize: 11.5, color: AppColors.warning)),
            ),
          if (canPost) _composer(),
          if (_msgError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
              child: Text(_msgError!,
                  style: AppFonts.body(
                      fontSize: 11.5, color: AppColors.error)),
            ),
        ],
      ),
    );
  }

  Widget _messagesBody() {
    if (_loadingMsgs) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      );
    }
    final msgs = _messages ?? const <GoalComment>[];
    if (msgs.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('No messages yet. Start the conversation below.',
              style: AppFonts.body(
                  fontSize: 12, color: AppColors.slate400)),
        ),
      );
    }
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.all(12),
      itemCount: msgs.length,
      itemBuilder: (_, i) => _bubble(msgs[i]),
    );
  }

  Widget _bubble(GoalComment c) {
    final mine = c.isMine;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment:
            mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            textDirection: mine ? TextDirection.rtl : TextDirection.ltr,
            children: [
              Text(mine ? 'You' : c.postedByName,
                  style: AppFonts.body(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.slate700)),
              if (c.postedByRoleLabel != null &&
                  c.postedByRoleLabel!.isNotEmpty) ...[
                const SizedBox(width: 6),
                _chip(c.postedByRoleLabel!, AppColors.slate500,
                    AppColors.slate100),
              ],
            ],
          ),
          const SizedBox(height: 3),
          Container(
            constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.72),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              color: mine ? AppColors.info : Colors.white,
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(14),
                topRight: const Radius.circular(14),
                bottomLeft: Radius.circular(mine ? 14 : 3),
                bottomRight: Radius.circular(mine ? 3 : 14),
              ),
              border: mine ? null : Border.all(color: AppColors.slate200),
            ),
            child: Text(c.commentText,
                style: AppFonts.body(
                    fontSize: 13,
                    color: mine ? Colors.white : AppColors.textPrimary)),
          ),
          if (c.createdDate != null && c.createdDate!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(c.createdDate!,
                  style: AppFonts.body(
                      fontSize: 10, color: AppColors.slate400)),
            ),
        ],
      ),
    );
  }

  Widget _composer() {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.slate100)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _input,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _post(),
              style: AppFonts.body(fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Type a message…',
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.slate200)),
                enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.slate200)),
                focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: const BorderSide(color: AppColors.info)),
              ),
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            onTap: _posting ? null : _post,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                  color: _posting ? AppColors.slate200 : AppColors.info,
                  borderRadius: BorderRadius.circular(10)),
              child: _posting
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.send, size: 16, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  // ── small shared pieces ────────────────────────────────────────────────────
  Widget _sectionHeader(String title) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: const BoxDecoration(
        color: AppColors.infoLight,
        border: Border(bottom: BorderSide(color: AppColors.slate100)),
      ),
      child: Row(
        children: [
          const Icon(Icons.forum_outlined, size: 16, color: AppColors.info),
          const SizedBox(width: 6),
          Text(title,
              style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
        ],
      ),
    );
  }

  Widget _chip(String text, Color fg, Color bg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(text,
          style: AppFonts.body(
              fontSize: 10, fontWeight: FontWeight.w600, color: fg)),
    );
  }

  Widget _shell({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: _cardDecoration(),
      child: child,
    );
  }

  BoxDecoration _cardDecoration() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      );
}
