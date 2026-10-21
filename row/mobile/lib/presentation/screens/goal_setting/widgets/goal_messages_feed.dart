import 'package:flutter/material.dart';

import '../../../../core/network/api_exceptions.dart';
import '../../../../core/services/goal_setting_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// The RI Director / Super Admin messages view — mobile twin of web's
/// `GoalMessagesFeed`.
///
/// A ROSTER of every Zone Co-ordinator and District Assistant in the zone, each
/// showing their message count or "No message yet". Tap a person to read their
/// thread. Strictly read-only: an RI Director can read every thread but cannot
/// reply (server-enforced), which is why there is no composer here at all — the
/// ZC/DA side uses `GoalZoneMessages` instead.
///
/// The roster is filtered by category and district; a `0` means "all".
class GoalMessagesFeed extends StatefulWidget {
  final int zoneId;
  final int yearId;

  /// 0 = every category the caller oversees.
  final int categoryId;

  /// 0 = every district.
  final int districtId;

  const GoalMessagesFeed({
    super.key,
    required this.zoneId,
    required this.yearId,
    this.categoryId = 0,
    this.districtId = 0,
  });

  @override
  State<GoalMessagesFeed> createState() => _GoalMessagesFeedState();
}

class _GoalMessagesFeedState extends State<GoalMessagesFeed> {
  final GoalSettingApi _api = GoalSettingApi();

  List<GoalMessageOwner>? _roster;
  bool _loading = true;
  String? _error;

  GoalMessageOwner? _active;
  List<GoalComment>? _messages;
  bool _loadingMessages = false;

  @override
  void initState() {
    super.initState();
    _loadRoster();
  }

  @override
  void didUpdateWidget(covariant GoalMessagesFeed old) {
    super.didUpdateWidget(old);
    if (old.categoryId != widget.categoryId ||
        old.districtId != widget.districtId ||
        old.zoneId != widget.zoneId ||
        old.yearId != widget.yearId) {
      // Filters changed — drop any open thread, it may no longer be in scope.
      _active = null;
      _messages = null;
      _loadRoster();
    }
  }

  Future<void> _loadRoster() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await _api.getMessageRoster(
        widget.zoneId,
        widget.yearId,
        categoryId: widget.categoryId,
        districtId: widget.districtId,
      );
      if (!mounted) return;
      setState(() {
        _roster = r;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = friendlyErrorMessage(e, fallback: 'Failed to load messages.');
      });
    }
  }

  Future<void> _openOwner(GoalMessageOwner o) async {
    setState(() {
      _active = o;
      _messages = null;
      _loadingMessages = true;
    });
    try {
      // The thread is fetched for the OWNER's own category, not the filter —
      // a roster row already belongs to one category.
      final msgs =
          await _api.getOwnerThreadMessages(o.categoryId, widget.yearId, o.memberId);
      if (!mounted) return;
      setState(() {
        // With a district filter on, show only that district's messages, so
        // the thread agrees with the roster that led here.
        _messages = widget.districtId == 0
            ? msgs
            : msgs.where((m) => (m.districtId ?? 0) == widget.districtId).toList();
        _loadingMessages = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _messages = const [];
        _loadingMessages = false;
      });
    }
  }

  void _back() => setState(() {
        _active = null;
        _messages = null;
      });

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: const Center(
            child: const CircularProgressIndicator(color: AppColors.primary)),
      );
    }
    if (_error != null) return _note(_error!, isError: true);
    if (_active != null) return _thread(_active!);

    final roster = _roster ?? const <GoalMessageOwner>[];
    if (roster.isEmpty) return _note('No messages yet.');

    return Column(
      children: [
        for (final o in roster) _rosterRow(o),
      ],
    );
  }

  Widget _rosterRow(GoalMessageOwner o) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: () => _openOwner(o),
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: const BoxDecoration(
                    color: AppColors.slate100,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.person_outline_rounded,
                      size: 18, color: AppColors.slate500),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        o.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Wrap(
                        spacing: 5,
                        runSpacing: 4,
                        children: [
                          _tag(o.roleLabel, AppColors.rotaryBlue),
                          _tag(o.categoryName, AppColors.slate500),
                          if (o.districts != null)
                            _tag(o.districts!, AppColors.success),
                        ],
                      ),
                      const SizedBox(height: 5),
                      Text(
                        o.messageCount > 0
                            ? '${o.messageCount} message${o.messageCount == 1 ? '' : 's'}: tap to read'
                            : 'No message yet',
                        style: AppFonts.body(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: o.messageCount > 0
                              ? AppColors.textSecondary
                              : AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded,
                    size: 20, color: AppColors.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _thread(GoalMessageOwner o) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton.icon(
          onPressed: _back,
          icon: const Icon(Icons.chevron_left_rounded, size: 18),
          label: Text(
            'Back to list',
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          style: TextButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            minimumSize: Size.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          decoration: BoxDecoration(
            color: AppColors.primaryLight.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                o.name,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 5),
              Wrap(
                spacing: 5,
                runSpacing: 4,
                children: [
                  _tag(o.roleLabel, AppColors.rotaryBlue),
                  _tag(o.categoryName, AppColors.slate500),
                  if (o.districts != null) _tag(o.districts!, AppColors.success),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        if (_loadingMessages)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 26),
            child: const Center(
                child: const CircularProgressIndicator(color: AppColors.primary)),
          )
        else if (_messages == null || _messages!.isEmpty)
          _note('No message yet.')
        else
          for (final m in _messages!) _messageCard(m),
      ],
    );
  }

  Widget _messageCard(GoalComment m) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 11),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  m.postedByName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              if (m.createdDate != null)
                Text(
                  m.createdDate!,
                  style: AppFonts.body(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMuted,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 5),
          Wrap(
            spacing: 5,
            runSpacing: 4,
            children: [
              if (m.postedByRoleLabel != null)
                _tag(m.postedByRoleLabel!, AppColors.slate500),
              // A district number when the message is about one district; a
              // zone-wide message (tier 2 = Zone Co-ordinator) says so instead.
              if (m.districtId != null && m.districtNumber != null)
                _tag(m.districtNumber!, AppColors.success)
              else if (m.postedByTier == 2)
                _tag('All districts', AppColors.slate400),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            m.commentText,
            style: AppFonts.body(
              fontSize: 12.5,
              height: 1.4,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _tag(String text, Color color) {
    if (text.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        text,
        style: AppFonts.body(
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }

  Widget _note(String text, {bool isError = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 12),
      child: Column(
        children: [
          Icon(
            isError ? Icons.error_outline_rounded : Icons.forum_outlined,
            size: 28,
            color: isError ? AppColors.error : AppColors.slate400,
          ),
          const SizedBox(height: 8),
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
