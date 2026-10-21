import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/theme/app_text_styles.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import 'club_website_menu_form_screen.dart';

const _linkTypes = <(String, String)>[
  ('page', 'Page'),
  ('external', 'External Link'),
  ('document', 'Document'),
];

String _linkTypeLabel(String v) =>
    _linkTypes.firstWhere((t) => t.$1 == v, orElse: () => (v, v)).$2;

Color _linkTypeColor(String v) {
  switch (v) {
    case 'external':
      return AppColors.warningDark;
    case 'document':
      return AppColors.success;
    case 'page':
    default:
      return AppColors.primary;
  }
}

class _Menu {
  final int id;
  final String menuName;
  final String linkType;
  final String linkValue;
  final int sortOrder;
  final bool isActive;
  final int subMenuCount;
  const _Menu({
    required this.id,
    required this.menuName,
    required this.linkType,
    required this.linkValue,
    required this.sortOrder,
    required this.isActive,
    required this.subMenuCount,
  });

  factory _Menu.fromJson(Map<String, dynamic> j) => _Menu(
        id: (j['id'] as int?) ?? 0,
        menuName: j['menuName']?.toString() ?? '',
        linkType: j['linkType']?.toString() ?? 'page',
        linkValue: j['linkValue']?.toString() ?? '',
        sortOrder: (j['sortOrder'] as int?) ?? 0,
        isActive: j['isActive'] as bool? ?? true,
        subMenuCount: (j['subMenuCount'] as int?) ?? 0,
      );
}

class _SubMenu {
  final int id;
  final int menuId;
  final String subMenuName;
  final String linkType;
  final String linkValue;
  final int sortOrder;
  final bool isActive;
  const _SubMenu({
    required this.id,
    required this.menuId,
    required this.subMenuName,
    required this.linkType,
    required this.linkValue,
    required this.sortOrder,
    required this.isActive,
  });

  factory _SubMenu.fromJson(Map<String, dynamic> j) => _SubMenu(
        id: (j['id'] as int?) ?? 0,
        menuId: (j['menuId'] as int?) ?? 0,
        subMenuName: j['subMenuName']?.toString() ?? '',
        linkType: j['linkType']?.toString() ?? 'page',
        linkValue: j['linkValue']?.toString() ?? '',
        sortOrder: (j['sortOrder'] as int?) ?? 0,
        isActive: j['isActive'] as bool? ?? true,
      );
}

class ClubWebsiteMenuListScreen extends StatefulWidget {
  final int clubId;
  const ClubWebsiteMenuListScreen({super.key, required this.clubId});

  @override
  State<ClubWebsiteMenuListScreen> createState() => _ClubWebsiteMenuListScreenState();
}

class _ClubWebsiteMenuListScreenState extends State<ClubWebsiteMenuListScreen> {
  final _api = ApiClient();
  bool _loading = true;
  String? _error;
  List<_Menu> _menus = [];
  final Set<int> _expanded = {};
  final Map<int, List<_SubMenu>> _subs = {};
  final Set<int> _loadingSubs = {};
  String _search = '';

  int get _activeCount => _menus.where((m) => m.isActive).length;
  List<_Menu> get _filtered {
    if (_search.trim().isEmpty) return _menus;
    final q = _search.toLowerCase();
    return _menus.where((m) {
      return m.menuName.toLowerCase().contains(q)
          || _linkTypeLabel(m.linkType).toLowerCase().contains(q)
          || (m.isActive ? 'active' : 'inactive').contains(q);
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    _fetchMenus();
  }

  Future<void> _fetchMenus() async {
    setState(() { _loading = true; _error = null; });
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/menu_list',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? []).map((e) => _Menu.fromJson(e as Map<String, dynamic>)).toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() { _menus = list; _loading = false; });
    } on ApiException catch (e) {
      if (e.statusCode == 404) {
        setState(() { _menus = []; _loading = false; });
      } else {
        setState(() { _error = e.message; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _fetchSubMenus(int menuId) async {
    setState(() => _loadingSubs.add(menuId));
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/website-data/menu_list/$menuId/submenus',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? []).map((e) => _SubMenu.fromJson(e as Map<String, dynamic>)).toList();
      list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() { _subs[menuId] = list; _loadingSubs.remove(menuId); });
    } catch (e) {
      setState(() => _loadingSubs.remove(menuId));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to load sub-menus: $e')));
    }
  }

  void _toggleExpand(int menuId) {
    setState(() {
      if (_expanded.contains(menuId)) {
        _expanded.remove(menuId);
      } else {
        _expanded.add(menuId);
        if (!_subs.containsKey(menuId)) {
          _fetchSubMenus(menuId);
        }
      }
    });
  }

  Future<void> _openMenuForm({
    _Menu? editingMenu,
    _SubMenu? editingSubMenu,
    int? parentMenuId,
  }) async {
    final isSub = parentMenuId != null || editingSubMenu != null;
    final pid = parentMenuId ?? editingSubMenu?.menuId;
    final initial = (editingMenu == null && editingSubMenu == null)
        ? null
        : ClubMenuFormInitial(
            menuId: editingMenu?.id,
            subMenuId: editingSubMenu?.id,
            parentMenuId: editingSubMenu?.menuId,
            name: editingMenu?.menuName ?? editingSubMenu?.subMenuName ?? '',
            linkType:
                editingMenu?.linkType ?? editingSubMenu?.linkType ?? 'page',
            linkValue:
                editingMenu?.linkValue ?? editingSubMenu?.linkValue ?? '',
            sortOrder: editingMenu?.sortOrder ?? editingSubMenu?.sortOrder ?? 1,
            isActive: editingMenu?.isActive ?? editingSubMenu?.isActive ?? true,
          );
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ClubWebsiteMenuFormScreen(
          clubId: widget.clubId,
          initial: initial,
          defaultSortOrder: _defaultSortOrder(isSub, parentMenuId),
          isSub: isSub,
          parentMenuId: pid,
        ),
      ),
    );
    if (saved != true || !mounted) return;
    if (parentMenuId != null || editingSubMenu != null) {
      final p = parentMenuId ?? editingSubMenu!.menuId;
      await _fetchSubMenus(p);
      await _fetchMenus();
    } else {
      await _fetchMenus();
    }
  }

  int _defaultSortOrder(bool isSub, int? parentMenuId) {
    if (isSub && parentMenuId != null) {
      final subs = _subs[parentMenuId] ?? const [];
      return subs.length + 1;
    }
    return _menus.length + 1;
  }

  Future<void> _moveMenu(_Menu menu, bool up) async {
    final index = _menus.indexWhere((m) => m.id == menu.id);
    final target = up ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= _menus.length) return;
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/menu_list/reorder',
        body: {'id1': _menus[index].id, 'id2': _menus[target].id},
      );
      await _fetchMenus();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Reorder failed: $e')));
    }
  }

  Future<void> _moveSubMenu(_SubMenu sub, bool up) async {
    final subs = _subs[sub.menuId] ?? const [];
    final index = subs.indexWhere((s) => s.id == sub.id);
    final target = up ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= subs.length) return;
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/menu_list/${sub.menuId}/submenus/reorder',
        body: {'id1': subs[index].id, 'id2': subs[target].id},
      );
      await _fetchSubMenus(sub.menuId);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Reorder failed: $e')));
    }
  }

  Future<void> _toggleMenuActive(_Menu menu) async {
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/menu_list/${menu.id}',
        body: {
          'menuName': menu.menuName,
          'linkType': menu.linkType,
          'linkValue': menu.linkValue,
          'sortOrder': menu.sortOrder,
          'isActive': !menu.isActive,
        },
      );
      await _fetchMenus();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Update failed: $e')));
    }
  }

  Future<void> _toggleSubActive(_SubMenu sub) async {
    try {
      await _api.put(
        '/api/clubs/${widget.clubId}/website-data/menu_list/${sub.menuId}/submenus/${sub.id}',
        body: {
          'subMenuName': sub.subMenuName,
          'linkType': sub.linkType,
          'linkValue': sub.linkValue,
          'sortOrder': sub.sortOrder,
          'isActive': !sub.isActive,
        },
      );
      await _fetchSubMenus(sub.menuId);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Update failed: $e')));
    }
  }

  Future<void> _confirmDeleteMenu(_Menu menu) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Menu'),
        content: Text('Delete "${menu.menuName}" and all its sub-menus?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/website-data/menu_list/${menu.id}');
      _expanded.remove(menu.id);
      _subs.remove(menu.id);
      if (mounted) await _fetchMenus();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  Future<void> _confirmDeleteSub(_SubMenu sub) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Sub-Menu'),
        content: Text('Delete "${sub.subMenuName}"?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.delete(
        '/api/clubs/${widget.clubId}/website-data/menu_list/${sub.menuId}/submenus/${sub.id}',
      );
      await _fetchSubMenus(sub.menuId);
      if (mounted) await _fetchMenus();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final canManage = auth.isClubAdminOf(widget.clubId);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: 'Menu List',
        actions: [
          if (canManage)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: 'Add Menu',
              onPressed: () => _openMenuForm(),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: const CircularProgressIndicator(color: AppColors.primary))
          : _error != null
              ? ErrorStateWidget(message: _error!, onRetry: _fetchMenus)
              : _buildBody(canManage),
    );
  }

  Widget _buildBody(bool canManage) {
    final filtered = _filtered;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.goldLight.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$_activeCount/${_menus.length} Menus',
                  style: AppTextStyles.caption.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            onChanged: (v) => setState(() => _search = v),
            decoration: InputDecoration(
              hintText: 'Search menus...',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
          const SizedBox(height: 12),
          if (_menus.isEmpty)
            Expanded(
              child: EmptyStateWidget(
                title: 'No menus yet',
                subtitle: canManage ? 'Tap + to add a menu.' : 'No menus added.',
                icon: Icons.list_alt_outlined,
              ),
            )
          else if (filtered.isEmpty)
            const Expanded(
              child: const EmptyStateWidget(
                title: 'No matches',
                subtitle: 'Try a different search term.',
                icon: Icons.search_off,
              ),
            )
          else
            Expanded(
              child: ListView.separated(
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (ctx, i) {
                  final menu = filtered[i];
                  final absIndex = _menus.indexWhere((m) => m.id == menu.id);
                  return _MenuRow(
                    menu: menu,
                    expanded: _expanded.contains(menu.id),
                    canManage: canManage,
                    canMoveUp: absIndex > 0,
                    canMoveDown: absIndex >= 0 && absIndex < _menus.length - 1,
                    onToggle: () => _toggleExpand(menu.id),
                    onEdit: () => _openMenuForm(editingMenu: menu),
                    onAddSub: () => _openMenuForm(parentMenuId: menu.id),
                    onMoveUp: () => _moveMenu(menu, true),
                    onMoveDown: () => _moveMenu(menu, false),
                    onToggleActive: () => _toggleMenuActive(menu),
                    onDelete: () => _confirmDeleteMenu(menu),
                    subLoading: _loadingSubs.contains(menu.id),
                    subs: _subs[menu.id],
                    onEditSub: (s) => _openMenuForm(editingSubMenu: s),
                    onMoveSubUp: (s) => _moveSubMenu(s, true),
                    onMoveSubDown: (s) => _moveSubMenu(s, false),
                    onToggleSubActive: (s) => _toggleSubActive(s),
                    onDeleteSub: (s) => _confirmDeleteSub(s),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

enum _MenuAction { edit, addSub, moveUp, moveDown, toggleActive, delete }
enum _SubAction { edit, moveUp, moveDown, toggleActive, delete }

class _MenuRow extends StatelessWidget {
  final _Menu menu;
  final bool expanded;
  final bool canManage;
  final bool canMoveUp;
  final bool canMoveDown;
  final VoidCallback onToggle;
  final VoidCallback onEdit;
  final VoidCallback onAddSub;
  final VoidCallback onMoveUp;
  final VoidCallback onMoveDown;
  final VoidCallback onToggleActive;
  final VoidCallback onDelete;
  final bool subLoading;
  final List<_SubMenu>? subs;
  final void Function(_SubMenu) onEditSub;
  final void Function(_SubMenu) onMoveSubUp;
  final void Function(_SubMenu) onMoveSubDown;
  final void Function(_SubMenu) onToggleSubActive;
  final void Function(_SubMenu) onDeleteSub;

  const _MenuRow({
    required this.menu,
    required this.expanded,
    required this.canManage,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.onToggle,
    required this.onEdit,
    required this.onAddSub,
    required this.onMoveUp,
    required this.onMoveDown,
    required this.onToggleActive,
    required this.onDelete,
    required this.subLoading,
    required this.subs,
    required this.onEditSub,
    required this.onMoveSubUp,
    required this.onMoveSubDown,
    required this.onToggleSubActive,
    required this.onDeleteSub,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.border),
      ),
      color: AppColors.surface,
      child: Column(
        children: [
          InkWell(
            onTap: onToggle,
            borderRadius: BorderRadius.circular(10),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 4, 8),
              child: Row(
                children: [
                  Icon(expanded ? Icons.expand_more : Icons.chevron_right, size: 20, color: AppColors.textSecondary),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(menu.menuName, style: AppTextStyles.bodyMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            _LinkTypeBadge(type: menu.linkType),
                            const SizedBox(width: 6),
                            _StatusBadge(isActive: menu.isActive),
                            if (menu.subMenuCount > 0) ...[
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppColors.primary.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  '${menu.subMenuCount} sub',
                                  style: AppTextStyles.caption.copyWith(color: AppColors.primary),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (canManage)
                    PopupMenuButton<_MenuAction>(
                      icon: const Icon(Icons.more_vert, size: 20),
                      onSelected: (a) {
                        switch (a) {
                          case _MenuAction.edit: onEdit(); break;
                          case _MenuAction.addSub: onAddSub(); break;
                          case _MenuAction.moveUp: onMoveUp(); break;
                          case _MenuAction.moveDown: onMoveDown(); break;
                          case _MenuAction.toggleActive: onToggleActive(); break;
                          case _MenuAction.delete: onDelete(); break;
                        }
                      },
                      itemBuilder: (_) => [
                        const PopupMenuItem(value: _MenuAction.edit, child: Row(children: [Icon(Icons.edit_outlined, size: 18), SizedBox(width: 8), Text('Edit')])),
                        const PopupMenuItem(value: _MenuAction.addSub, child: Row(children: [Icon(Icons.add_circle_outline, size: 18), SizedBox(width: 8), Text('Add Sub-Menu')])),
                        if (canMoveUp)
                          const PopupMenuItem(value: _MenuAction.moveUp, child: Row(children: [Icon(Icons.arrow_upward, size: 18), SizedBox(width: 8), Text('Move Up')])),
                        if (canMoveDown)
                          const PopupMenuItem(value: _MenuAction.moveDown, child: Row(children: [Icon(Icons.arrow_downward, size: 18), SizedBox(width: 8), Text('Move Down')])),
                        PopupMenuItem(
                          value: _MenuAction.toggleActive,
                          child: Row(children: [
                            Icon(menu.isActive ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 18),
                            const SizedBox(width: 8),
                            Text(menu.isActive ? 'Deactivate' : 'Activate'),
                          ]),
                        ),
                        const PopupMenuItem(
                          value: _MenuAction.delete,
                          child: Row(children: [Icon(Icons.delete_outline, size: 18, color: AppColors.error), SizedBox(width: 8), Text('Delete', style: TextStyle(color: AppColors.error))]),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
          if (expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 0, 8, 10),
              child: subLoading
                  ? const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))))
                  : (subs == null || subs!.isEmpty)
                      ? Text('No sub-menus', style: AppTextStyles.caption.copyWith(fontStyle: FontStyle.italic, color: AppColors.textSecondary))
                      : Column(
                          children: [
                            for (int i = 0; i < subs!.length; i++)
                              _SubRow(
                                sub: subs![i],
                                canManage: canManage,
                                canMoveUp: i > 0,
                                canMoveDown: i < subs!.length - 1,
                                onEdit: () => onEditSub(subs![i]),
                                onMoveUp: () => onMoveSubUp(subs![i]),
                                onMoveDown: () => onMoveSubDown(subs![i]),
                                onToggleActive: () => onToggleSubActive(subs![i]),
                                onDelete: () => onDeleteSub(subs![i]),
                              ),
                          ],
                        ),
            ),
        ],
      ),
    );
  }
}

class _SubRow extends StatelessWidget {
  final _SubMenu sub;
  final bool canManage;
  final bool canMoveUp;
  final bool canMoveDown;
  final VoidCallback onEdit;
  final VoidCallback onMoveUp;
  final VoidCallback onMoveDown;
  final VoidCallback onToggleActive;
  final VoidCallback onDelete;

  const _SubRow({
    required this.sub,
    required this.canManage,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.onEdit,
    required this.onMoveUp,
    required this.onMoveDown,
    required this.onToggleActive,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          const Icon(Icons.subdirectory_arrow_right, size: 16, color: AppColors.textSecondary),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(sub.subMenuName, style: AppTextStyles.body, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Row(
                  children: [
                    _LinkTypeBadge(type: sub.linkType),
                    const SizedBox(width: 6),
                    _StatusBadge(isActive: sub.isActive),
                  ],
                ),
              ],
            ),
          ),
          if (canManage)
            PopupMenuButton<_SubAction>(
              icon: const Icon(Icons.more_vert, size: 18),
              onSelected: (a) {
                switch (a) {
                  case _SubAction.edit: onEdit(); break;
                  case _SubAction.moveUp: onMoveUp(); break;
                  case _SubAction.moveDown: onMoveDown(); break;
                  case _SubAction.toggleActive: onToggleActive(); break;
                  case _SubAction.delete: onDelete(); break;
                }
              },
              itemBuilder: (_) => [
                const PopupMenuItem(value: _SubAction.edit, child: Row(children: [Icon(Icons.edit_outlined, size: 18), SizedBox(width: 8), Text('Edit')])),
                if (canMoveUp)
                  const PopupMenuItem(value: _SubAction.moveUp, child: Row(children: [Icon(Icons.arrow_upward, size: 18), SizedBox(width: 8), Text('Move Up')])),
                if (canMoveDown)
                  const PopupMenuItem(value: _SubAction.moveDown, child: Row(children: [Icon(Icons.arrow_downward, size: 18), SizedBox(width: 8), Text('Move Down')])),
                PopupMenuItem(
                  value: _SubAction.toggleActive,
                  child: Row(children: [
                    Icon(sub.isActive ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 18),
                    const SizedBox(width: 8),
                    Text(sub.isActive ? 'Deactivate' : 'Activate'),
                  ]),
                ),
                const PopupMenuItem(
                  value: _SubAction.delete,
                  child: Row(children: [Icon(Icons.delete_outline, size: 18, color: AppColors.error), SizedBox(width: 8), Text('Delete', style: TextStyle(color: AppColors.error))]),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _LinkTypeBadge extends StatelessWidget {
  final String type;
  const _LinkTypeBadge({required this.type});

  @override
  Widget build(BuildContext context) {
    final color = _linkTypeColor(type);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        _linkTypeLabel(type),
        style: AppTextStyles.caption.copyWith(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final bool isActive;
  const _StatusBadge({required this.isActive});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: isActive ? AppColors.success.withValues(alpha: 0.12) : AppColors.muted,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        isActive ? 'Active' : 'Inactive',
        style: AppTextStyles.caption.copyWith(
          color: isActive ? AppColors.success : AppColors.textSecondary,
        ),
      ),
    );
  }
}
