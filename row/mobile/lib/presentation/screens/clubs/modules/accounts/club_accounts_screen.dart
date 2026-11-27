import 'package:flutter/material.dart' hide Text;
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../widgets/common/custom_app_bar.dart';
import '../../../../widgets/common/empty_state_widget.dart';
import '../../../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';

/// The club's accounts for its officers (gap agent, `api/clubs/{id}/accounts`): bank balances, this Rotary year's
/// profit and loss and the dues members owe by age (both read-only), the latest entries, and the treasurer's quick
/// "money in / money out" entry. The full journal, chart of accounts, payees, reconciliation, reports and downloads
/// are on the web admin (Club Admin > Accounts).
class ClubAccountsScreen extends StatefulWidget {
  const ClubAccountsScreen({super.key, required this.clubId});
  final int clubId;

  @override
  State<ClubAccountsScreen> createState() => _ClubAccountsScreenState();
}

class _ClubAccountsScreenState extends State<ClubAccountsScreen> {
  final _api = ApiClient();
  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>> _accounts = const [];
  Map<String, dynamic>? _pl;
  Map<String, dynamic>? _aged;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final base = '/api/clubs/${widget.clubId}/accounts';
      final s = await _api.get<Map<String, dynamic>>('$base/summary', fromJson: (j) => j as Map<String, dynamic>);
      final a = await _api.get<List<dynamic>>(base, fromJson: (j) => j as List<dynamic>);
      final today = _day(DateTime.now());
      final from = (s.data?['yearStart'] as String?)?.substring(0, 10) ?? today;
      final to = (s.data?['yearEnd'] as String?)?.substring(0, 10) ?? today;
      final pl = await _api.get<Map<String, dynamic>>('$base/reports/profit-loss',
          queryParams: {'from': from, 'to': to}, fromJson: (j) => j as Map<String, dynamic>);
      final aged = await _api.get<Map<String, dynamic>>('$base/reports/aged',
          queryParams: {'asOf': today}, fromJson: (j) => j as Map<String, dynamic>);
      if (mounted) {
        setState(() {
          _pl = pl.data;
          _aged = aged.data;
          _summary = s.data;
          _accounts = (a.data ?? const []).cast<Map<String, dynamic>>();
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the club accounts.');
    }
  }

  static String _day(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static List<Map<String, dynamic>> _list(Map<String, dynamic>? m, String key) =>
      ((m?[key] as List?) ?? const []).cast<Map<String, dynamic>>();

  Widget _heading(String text) => Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 8),
        child: Text(text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      );

  Widget _row(String label, num? amount, {bool bold = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w400))),
          Text(formatMoney(amount, null), style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w400)),
        ]),
      );

  /// Profit and loss for this Rotary year, read-only.
  List<Widget> _profitAndLoss() {
    final pl = _pl;
    if (pl == null) return const [];
    return [
      _heading(_summary?['yearLabel'] != null ? 'Profit and loss ${_summary!['yearLabel']}' : 'Profit and loss'),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(children: [
            for (final l in _list(pl, 'income')) _row('${l['code']} ${l['name']}', l['amount'] as num?),
            _row('Total income', pl['totalIncome'] as num?, bold: true),
            const Divider(),
            for (final l in _list(pl, 'expenses')) _row('${l['code']} ${l['name']}', l['amount'] as num?),
            _row('Total expenses', pl['totalExpenses'] as num?, bold: true),
            const Divider(),
            _row(((pl['net'] as num?) ?? 0) < 0 ? 'Deficit' : 'Surplus', pl['net'] as num?, bold: true),
          ]),
        ),
      ),
    ];
  }

  /// Membership dues owed by age, read-only.
  List<Widget> _agedBalances() {
    final aged = _aged;
    if (aged == null) return const [];
    final rows = _list(aged, 'rows');
    final t = aged['totals'] as Map<String, dynamic>? ?? const {};
    return [
      _heading('Dues owed by age'),
      if (rows.isEmpty)
        const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('No member owes dues today.'))
      else ...[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(children: [
              _row('0 to 30 days', t['days0To30'] as num?),
              _row('31 to 60 days', t['days31To60'] as num?),
              _row('61 to 90 days', t['days61To90'] as num?),
              _row('Over 90 days', t['over90'] as num?),
              _row('Not yet due', t['notDue'] as num?),
              _row('Total owed', t['total'] as num?, bold: true),
            ]),
          ),
        ),
        for (final r in rows)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(r['memberName'] as String? ?? ''),
            subtitle: ((r['over90'] as num?) ?? 0) > 0 ? Text('Over 90 days: ${formatMoney(r['over90'] as num?, null)}') : null,
            trailing: Text(formatMoney(r['total'] as num?, null)),
          ),
      ],
    ];
  }

  Future<void> _record() async {
    final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => QuickEntryForm(clubId: widget.clubId, accounts: _accounts)));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    final banks = ((s?['banks'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final recent = ((s?['recent'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: const CustomAppBar(title: 'Accounts'),
      floatingActionButton: s == null
          ? null
          : FloatingActionButton.extended(onPressed: _record, icon: const Icon(Icons.add), label: const Text('Record money')),
      body: _error != null
          ? EmptyStateWidget(icon: Icons.account_balance_outlined, title: 'Not available', subtitle: _error!)
          : s == null
              ? const LoadingWidget()
              : RowRefresh(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
                    children: [
                      for (final b in banks)
                        Card(
                          child: ListTile(
                            leading: const Icon(Icons.account_balance_outlined),
                            title: Text(b['name'] as String? ?? ''),
                            subtitle: b['accountLast4'] != null ? Text('Ending ${b['accountLast4']}') : null,
                            trailing: Text(formatMoney(b['balance'] as num?, null),
                                style: const TextStyle(fontWeight: FontWeight.w700)),
                          ),
                        ),
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.insights_outlined),
                          title: Text(s['yearLabel'] != null ? 'Surplus in ${s['yearLabel']}' : 'Surplus this year'),
                          subtitle: Text('In ${formatMoney(s['yearIncome'] as num?, null)}  ·  '
                              'Out ${formatMoney(s['yearExpenses'] as num?, null)}'),
                          trailing: Text(formatMoney(s['yearNet'] as num?, null),
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                        ),
                      ),
                      ..._profitAndLoss(),
                      ..._agedBalances(),
                      _heading('Latest entries'),
                      if (recent.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 24),
                          child: Text('Nothing posted yet. Tap Record money to add the first entry.'),
                        ),
                      for (final e in recent)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(e['memo'] as String? ?? ''),
                          subtitle: Text([
                            DateFormatter.toDisplay(DateTime.tryParse(e['entryDate']?.toString() ?? '')),
                            if (e['reversesEntryId'] != null) 'Reversal',
                            if (e['reversedByEntryId'] != null) 'Reversed',
                          ].join('  ·  ')),
                          trailing: Text(formatMoney(e['total'] as num?, null)),
                        ),
                    ],
                  ),
                ),
    );
  }
}

/// Money in (bank debited, income credited) or money out (expense debited, bank credited): POST journal/quick.
class QuickEntryForm extends StatefulWidget {
  const QuickEntryForm({super.key, required this.clubId, required this.accounts});
  final int clubId;
  final List<Map<String, dynamic>> accounts;

  @override
  State<QuickEntryForm> createState() => _QuickEntryFormState();
}

class _QuickEntryFormState extends State<QuickEntryForm> {
  final _api = ApiClient();
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _memo = TextEditingController();
  bool _moneyIn = true;
  int? _categoryId;
  int? _bankId;
  DateTime _date = DateTime.now();
  bool _busy = false;

  List<Map<String, dynamic>> get _banks => widget.accounts
      .where((a) => a['isActive'] == true && a['type'] == 'asset' && (a['isBank'] == true || a['systemKey'] == 'cash'))
      .toList();

  List<Map<String, dynamic>> get _categories =>
      widget.accounts.where((a) => a['isActive'] == true && a['type'] == (_moneyIn ? 'income' : 'expense')).toList();

  @override
  void initState() {
    super.initState();
    _bankId = _banks.isNotEmpty ? _banks.first['id'] as int : null;
  }

  @override
  void dispose() {
    _amount.dispose();
    _memo.dispose();
    super.dispose();
  }

  /// Two decimals at most, more than zero; null when the text is not a valid amount.
  static double? parseAmount(String text) {
    final t = text.replaceAll(RegExp(r'[,\s]'), '');
    if (!RegExp(r'^\d{1,12}(\.\d{1,2})?$').hasMatch(t)) return null;
    final v = double.parse(t);
    return v > 0 ? v : null;
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final d = _date;
      await _api.post('/api/clubs/${widget.clubId}/accounts/journal/quick', body: {
        'kind': _moneyIn ? 'in' : 'out',
        'entryDate': '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
        'categoryAccountId': _categoryId,
        'bankAccountId': _bankId,
        'amount': parseAmount(_amount.text),
        'memo': _memo.text.trim(),
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not record the entry.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const CustomAppBar(title: 'Record money'),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: true, label: Text('Money in')),
                ButtonSegment(value: false, label: Text('Money out')),
              ],
              selected: {_moneyIn},
              onSelectionChanged: (v) => setState(() {
                _moneyIn = v.first;
                _categoryId = null;
              }),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<int>(
              key: ValueKey(_moneyIn),
              initialValue: _categoryId,
              isExpanded: true,
              decoration: InputDecoration(labelText: _moneyIn ? 'Income account' : 'Expense account'),
              items: [
                for (final a in _categories)
                  DropdownMenuItem(value: a['id'] as int, child: Text('${a['code']} ${a['name']}')),
              ],
              onChanged: (v) => setState(() => _categoryId = v),
              validator: (v) => v == null ? 'Choose an account.' : null,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              initialValue: _bankId,
              isExpanded: true,
              decoration: InputDecoration(labelText: _moneyIn ? 'Paid into' : 'Paid from'),
              items: [
                for (final a in _banks) DropdownMenuItem(value: a['id'] as int, child: Text(a['name'] as String? ?? '')),
              ],
              onChanged: (v) => setState(() => _bankId = v),
              validator: (v) => v == null ? 'Choose the bank or cash account.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Amount'),
              validator: (v) => parseAmount(v ?? '') == null ? 'Type an amount such as 1250.50.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _memo,
              maxLength: 255,
              decoration: const InputDecoration(labelText: 'Description'),
              validator: (v) => (v ?? '').trim().isEmpty ? 'Describe the entry.' : null,
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event_outlined),
              title: Text('Date: ${DateFormatter.toDisplay(_date)}'),
              onTap: () async {
                final picked = await showDatePicker(
                    context: context, initialDate: _date, firstDate: DateTime(2000), lastDate: DateTime.now().add(const Duration(days: 365)));
                if (picked != null) setState(() => _date = picked);
              },
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Record'),
            ),
          ],
        ),
      ),
    );
  }
}
