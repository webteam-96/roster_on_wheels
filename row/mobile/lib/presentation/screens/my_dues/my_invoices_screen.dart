import 'dart:io';
import 'package:flutter/material.dart' hide Text;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/empty_state_widget.dart';
import '../../widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// The member's own invoices and balance (gap #7), from `GET /api/my/invoices`.
/// Each invoice and a 12-month statement open as the club's PDF through the OS share sheet.
/// Meal charges (`GET /api/my/invoices/meals`) are listed below the invoices: own meals and guests hosted.
/// Paying by card waits for Stripe; dues are still paid from My Dues.
class MyInvoicesScreen extends StatefulWidget {
  const MyInvoicesScreen({super.key});

  @override
  State<MyInvoicesScreen> createState() => _MyInvoicesScreenState();
}

class _Invoice {
  final int id;
  final String invoiceNo, status, issueDate, dueDate;
  final String? description;
  final num amount, balance;
  _Invoice.fromJson(Map<String, dynamic> j)
      : id = j['id'] as int,
        invoiceNo = '${j['invoiceNo']}',
        status = '${j['status']}',
        issueDate = '${j['issueDate']}',
        dueDate = '${j['dueDate']}',
        description = j['description'] as String?,
        amount = j['amount'] as num? ?? 0,
        balance = j['balance'] as num? ?? 0;
}

class _Meal {
  final String eventName, mealDate, guestName;
  final String? invoiceNo;
  final num amount;
  final bool billed;
  _Meal.fromJson(Map<String, dynamic> j)
      : eventName = '${j['eventName'] ?? ''}',
        mealDate = '${j['mealDate']}',
        guestName = '${j['guestName'] ?? ''}',
        invoiceNo = j['invoiceNo'] as String?,
        amount = j['amount'] as num? ?? 0,
        billed = j['billed'] == true;
}

class _MyInvoicesScreenState extends State<MyInvoicesScreen> {
  final _api = ApiClient();
  List<_Invoice> _invoices = const [];
  List<_Meal> _meals = const [];
  num _balance = 0;
  bool _loading = true;
  String? _error;
  String? _downloading;

  static const _statusLabel = {'open': 'Open', 'part_paid': 'Part paid', 'paid': 'Paid', 'void': 'Void'};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.get<Map<String, dynamic>>('/api/my/invoices',
          fromJson: (j) => (j as Map).cast<String, dynamic>());
      final data = resp.data ?? const {};
      final meals = await _api.get<List<dynamic>>('/api/my/invoices/meals',
          fromJson: (j) => j as List<dynamic>);
      if (!mounted) return;
      setState(() {
        _balance = data['balance'] as num? ?? 0;
        _invoices = (data['invoices'] as List<dynamic>? ?? const [])
            .whereType<Map>()
            .map((e) => _Invoice.fromJson(e.cast<String, dynamic>()))
            .toList();
        _meals = (meals.data ?? const [])
            .whereType<Map>()
            .map((e) => _Meal.fromJson(e.cast<String, dynamic>()))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Couldn\'t load your invoices. Please try again.';
        _loading = false;
      });
    }
  }

  Future<void> _sharePdf(String key, String path, String fileName) async {
    if (_downloading != null) return;
    final messenger = ScaffoldMessenger.of(context);
    final box = context.findRenderObject() as RenderBox?;
    final origin = (box != null && box.hasSize) ? box.localToGlobal(Offset.zero) & box.size : const Rect.fromLTWH(0, 0, 1, 1);
    setState(() => _downloading = key);
    try {
      final bytes = await _api.downloadBytes(path);
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$fileName');
      await file.writeAsBytes(bytes, flush: true);
      await Share.shareXFiles([XFile(file.path, mimeType: 'application/pdf')], subject: fileName, sharePositionOrigin: origin);
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Couldn\'t download the PDF. Please try again.')));
    } finally {
      if (mounted) setState(() => _downloading = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const CustomAppBar(title: 'My Invoices'),
      body: _loading
          ? const LoadingWidget()
          : _error != null
              ? EmptyStateWidget(
                  icon: Icons.receipt_long_rounded,
                  title: 'Invoices unavailable',
                  subtitle: _error!,
                  actionLabel: 'Retry',
                  onAction: _load,
                )
              : _invoices.isEmpty && _meals.isEmpty
                  ? const EmptyStateWidget(
                      icon: Icons.receipt_long_rounded,
                      title: 'No invoices',
                      subtitle: 'Invoices your club sends you will appear here.',
                    )
                  : RefreshIndicator(onRefresh: _load, child: _list()),
    );
  }

  Widget _list() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Balance due', style: AppFonts.body(fontSize: 13, color: AppColors.textSecondary)),
                    const SizedBox(height: 4),
                    Text(formatMoney(_balance, null), style: AppFonts.body(fontSize: 22, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              OutlinedButton(
                onPressed: _downloading != null ? null : () => _sharePdf('statement', '/api/my/invoices/statement/pdf', 'statement.pdf'),
                child: Text(_downloading == 'statement' ? 'Preparing' : 'Statement PDF'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        for (final i in _invoices) _tile(i),
        if (_meals.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('Meal charges', style: AppFonts.body(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          for (final m in _meals) _mealTile(m),
        ],
      ],
    );
  }

  Widget _tile(_Invoice i) {
    final isVoid = i.status == 'void';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        title: Text('${i.invoiceNo}  ${i.description ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis,
            style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600)),
        subtitle: Text('${_statusLabel[i.status] ?? i.status}, due ${i.dueDate}',
            style: AppFonts.body(fontSize: 12, color: isVoid ? AppColors.textSecondary : AppColors.textPrimary)),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(formatMoney(i.amount, null), style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700)),
            if (!isVoid && i.balance > 0)
              Text('Due ${formatMoney(i.balance, null)}', style: AppFonts.body(fontSize: 12, color: AppColors.error)),
          ],
        ),
        onTap: _downloading != null ? null : () => _sharePdf('inv${i.id}', '/api/my/invoices/${i.id}/pdf', '${i.invoiceNo}.pdf'),
      ),
    );
  }

  Widget _mealTile(_Meal m) {
    final who = m.guestName.isEmpty ? 'Meal' : 'Guest meal: ${m.guestName}';
    final status = m.billed ? (m.invoiceNo != null ? 'On invoice ${m.invoiceNo}' : 'No charge') : 'Not billed yet';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
        title: Text('$who, ${m.mealDate}', style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600)),
        subtitle: Text(m.eventName.isEmpty ? status : '${m.eventName}. $status',
            style: AppFonts.body(fontSize: 12, color: AppColors.textSecondary)),
        trailing: Text(formatMoney(m.amount, null), style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700)),
      ),
    );
  }
}
