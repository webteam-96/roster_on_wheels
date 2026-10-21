import 'dart:io';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../network/api_client.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Native PDF generator for the Club Monthly Report.
// Mirrors rotary-frontend/src/utils/reportDownload.ts → downloadPDF().
// ─────────────────────────────────────────────────────────────────────────────

const Map<String, String> _kProjectLabels = {
  'community_service': 'Community Service',
  'vocational_service': 'Vocational Service',
  'international_service': 'International Service',
  'new_generation_service': 'New Generation Service',
  'public_image_initiative': 'Public Image Initiative',
};

const Map<String, String> _kMeetingTypeLabels = {
  'regular': 'Regular',
  'fellowship': 'Fellowship',
  'bod': 'BOD',
  'assembly': 'Assembly',
  'trust': 'Trust',
};

int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

double _asDouble(dynamic v) {
  if (v is double) return v;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0.0;
  return 0.0;
}

String _fmtDate(String? iso) {
  if (iso == null || iso.isEmpty) return '-';
  final dt = DateTime.tryParse(iso);
  if (dt == null || dt.year <= 1) return '-'; // `0001-01-01` zero date => no value
  return DateFormat('dd MMM yyyy').format(dt);
}

String _fmtDateTime(String? iso) {
  if (iso == null || iso.isEmpty) return '-';
  final dt = DateTime.tryParse(iso);
  if (dt == null || dt.year <= 1) return '-'; // `0001-01-01` zero date => no value
  return DateFormat('EEE, dd MMM yyyy hh:mm:ss a').format(dt);
}

String _sanitize(String s) => s.replaceAll(RegExp(r'\s+'), '_');

class MonthlyReportPdfService {
  final ApiClient _api;
  MonthlyReportPdfService([ApiClient? api]) : _api = api ?? ApiClient();

  /// Fetches the preview JSON and emits a saved PDF file path.
  Future<String> generateAndSavePdf({
    required int clubId,
    required int yearId,
    required int month,
  }) async {
    final resp = await _api.get(
      '/api/clubs/$clubId/monthly-reports/preview/$yearId/$month',
      fromJson: (j) => j,
    );
    final data = resp.data;
    if (data is! Map) {
      throw Exception('Invalid preview response');
    }
    final report = Map<String, dynamic>.from(data);
    final bytes = await _buildPdf(report);

    final dir = await getApplicationDocumentsDirectory();
    final clubName = (report['clubName']?.toString() ?? 'Club');
    final monthName = (report['monthName']?.toString() ?? 'Month');
    final yearLabel = (report['yearLabel']?.toString() ?? 'Year');
    final fileName =
        '${_sanitize('${clubName}_Monthly_Report_${monthName}_$yearLabel')}.pdf';
    final file = File('${dir.path}/$fileName');
    await file.writeAsBytes(bytes);
    return file.path;
  }

  Future<void> openFile(String path) async {
    await OpenFilex.open(path);
  }

  Future<List<int>> _buildPdf(Map<String, dynamic> r) async {
    final pdf = pw.Document();

    const headerFill = PdfColor.fromInt(0xff2980b9);
    final cellBorder = pw.TableBorder.all(
      color: const PdfColor.fromInt(0xffcccccc),
      width: 0.5,
    );

    final monthName = r['monthName']?.toString() ?? '';
    final yearLabel = r['yearLabel']?.toString() ?? '';
    final uploadedDate = r['uploadedToDistrictDate']?.toString();

    final infoRows = [
      ['Club Name', r['clubName']?.toString() ?? '-', 'Prepared By',
        r['preparedBy']?.toString() ?? '-'],
      ['Rotary Club ID', r['clubCode']?.toString() ?? '-', 'Designation',
        r['designation']?.toString() ?? '-'],
      ['Assistant Governor', r['assistantGovernor']?.toString() ?? '-',
        'No. Of Members', _asInt(r['currentMemberCount']).toString()],
      ['No. Of Meetings', _asInt(r['totalMeetings']).toString(),
        'Avg. Attendance', '${_asInt(r['averageAttendance'])}%'],
    ];

    final trfEntries =
        List<Map<String, dynamic>>.from((r['trfEntries'] ?? const []).map(
      (e) => Map<String, dynamic>.from(e as Map),
    ));
    final meetings = List<Map<String, dynamic>>.from((r['meetings'] ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map)));
    final projectsMap =
        Map<String, dynamic>.from(r['projects'] as Map? ?? const {});

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.landscape,
        margin: const pw.EdgeInsets.fromLTRB(14, 14, 14, 14),
        build: (ctx) {
          final out = <pw.Widget>[];

          // ── Title ─────────────────────────────────────────
          out.add(
            pw.Center(
              child: pw.Text(
                'Club Monthly Report - $monthName $yearLabel',
                style: pw.TextStyle(
                    fontSize: 16, fontWeight: pw.FontWeight.bold),
              ),
            ),
          );
          out.add(pw.SizedBox(height: 4));

          if (uploadedDate != null && uploadedDate.isNotEmpty) {
            out.add(
              pw.Center(
                child: pw.Text(
                  'Uploaded to District: ${_fmtDateTime(uploadedDate)}',
                  style: pw.TextStyle(
                      fontSize: 12, fontWeight: pw.FontWeight.bold),
                ),
              ),
            );
          }
          out.add(pw.SizedBox(height: 8));

          // ── Info table ─────────────────────────────────────
          out.add(
            pw.Table(
              border: cellBorder,
              columnWidths: const {
                0: pw.FixedColumnWidth(110),
                1: pw.FlexColumnWidth(2),
                2: pw.FixedColumnWidth(110),
                3: pw.FlexColumnWidth(2),
              },
              children: infoRows
                  .map((row) => pw.TableRow(
                        children: [
                          _labelCell(row[0]),
                          _valueCell(row[1]),
                          _labelCell(row[2]),
                          _valueCell(row[3]),
                        ],
                      ))
                  .toList(),
            ),
          );
          out.add(pw.SizedBox(height: 10));

          // ── TRF Section ────────────────────────────────────
          out.add(_sectionHeader('TRF Contribution'));
          out.add(pw.SizedBox(height: 2));
          out.add(
            pw.Text(
              'Current Month: \$${_asDouble(r['trfCurrentMonth']).toStringAsFixed(2)}    '
              '|    This Year: \$${_asDouble(r['trfThisYear']).toStringAsFixed(2)}',
              style: const pw.TextStyle(fontSize: 9),
            ),
          );
          out.add(pw.SizedBox(height: 4));

          if (trfEntries.isNotEmpty) {
            out.add(_dataTable(
              headerFill: headerFill,
              border: cellBorder,
              headers: const [
                'Sr.No', 'Date', 'Name', 'Amount (USD)', 'Fund Type'
              ],
              rows: trfEntries
                  .asMap()
                  .entries
                  .map((e) {
                    final i = e.key;
                    final t = e.value;
                    final fundType = t['fundType']?.toString() ?? '';
                    final otherName = t['otherFundName']?.toString();
                    final fundDisp = (fundType == 'Other' &&
                            otherName != null &&
                            otherName.isNotEmpty)
                        ? otherName
                        : fundType;
                    return [
                      '${i + 1}',
                      _fmtDate(t['trfDate']?.toString()),
                      t['donorName']?.toString() ?? '-',
                      '\$${_asDouble(t['amountUSD']).toStringAsFixed(2)}',
                      fundDisp,
                    ];
                  })
                  .toList(),
            ));
            out.add(pw.SizedBox(height: 8));
          }

          // ── Meetings Section ──────────────────────────────
          final meetingsByType = <String, List<Map<String, dynamic>>>{};
          for (final m in meetings) {
            final t = m['meetingType']?.toString() ?? 'other';
            meetingsByType.putIfAbsent(t, () => []).add(m);
          }

          if (meetingsByType.isNotEmpty) {
            out.add(_sectionHeader('Meetings'));
            out.add(pw.SizedBox(height: 4));
            for (final entry in meetingsByType.entries) {
              final label =
                  _kMeetingTypeLabels[entry.key] ?? entry.key;
              out.add(pw.Text(
                '$label (${entry.value.length})',
                style: pw.TextStyle(
                    fontSize: 10, fontWeight: pw.FontWeight.bold),
              ));
              out.add(pw.SizedBox(height: 2));
              out.add(_dataTable(
                headerFill: headerFill,
                border: cellBorder,
                headers: const [
                  'Sr.No', 'Date', 'Title', 'Attendance', 'Attendance %'
                ],
                rows: entry.value
                    .asMap()
                    .entries
                    .map((e) {
                      final i = e.key;
                      final m = e.value;
                      return [
                        '${i + 1}',
                        _fmtDate(m['projectDate']?.toString()),
                        m['title']?.toString() ?? '-',
                        _asDouble(m['attendance']) > 0
                            ? '${_asInt(m['attendance'])}'
                            : '-',
                        _asDouble(m['attendancePercentage']) > 0
                            ? '${_asInt(m['attendancePercentage'])}%'
                            : '-',
                      ];
                    })
                    .toList(),
              ));
              out.add(pw.SizedBox(height: 6));
            }
          }

          // ── Projects Sections ─────────────────────────────
          for (final entry in _kProjectLabels.entries) {
            final key = entry.key;
            final label = entry.value;
            final list = projectsMap[key];
            if (list is! List || list.isEmpty) continue;

            final projects = List<Map<String, dynamic>>.from(
                list.map((e) => Map<String, dynamic>.from(e as Map)));
            final isCommunity = key == 'community_service';

            out.add(_sectionHeader(label));
            out.add(pw.SizedBox(height: 4));
            out.add(_dataTable(
              headerFill: headerFill,
              border: cellBorder,
              fontSize: 7,
              headers: isCommunity
                  ? const [
                      'Sr.No', 'Date', 'Title', 'Area of Focus', 'Category',
                      'Sub Category', 'Cost', 'Beneficiaries', 'Man Hours',
                      'Rotarians', 'Rotaractors'
                    ]
                  : const [
                      'Sr.No', 'Date', 'Title', 'Category', 'Sub Category',
                      'Cost', 'Beneficiaries', 'Man Hours', 'Rotarians',
                      'Rotaractors'
                    ],
              rows: projects.asMap().entries.map((e) {
                final i = e.key;
                final p = e.value;
                final projType = p['projectType']?.toString();
                final parentId = p['parentProjectId'];
                final typeTag = (key == 'community_service' ||
                            key == 'public_image_initiative') &&
                        projType != null &&
                        projType.isNotEmpty
                    ? ' [${projType == 'one_time' ? 'One Time' : 'Ongoing'}]'
                    : '';
                final childTag = (parentId != null && _asInt(parentId) > 0)
                    ? ' [Child]'
                    : '';
                final title =
                    '${p['title']?.toString() ?? '-'}$typeTag$childTag';
                // Omit zero-valued metrics (show '-') to match the server
                // report — a present 0 is treated as "no value".
                final common = [
                  _asDouble(p['projectCost']) > 0
                      ? NumberFormat('#,##0').format(_asInt(p['projectCost']))
                      : '-',
                  _asDouble(p['directBeneficiaries']) > 0
                      ? '${_asInt(p['directBeneficiaries'])}'
                      : '-',
                  _asDouble(p['manHours']) > 0
                      ? '${_asInt(p['manHours'])}'
                      : '-',
                  _asDouble(p['rotariansInvolved']) > 0
                      ? '${_asInt(p['rotariansInvolved'])}'
                      : '-',
                  _asDouble(p['rotaractorsInvolved']) > 0
                      ? '${_asInt(p['rotaractorsInvolved'])}'
                      : '-',
                ];
                if (isCommunity) {
                  return [
                    '${i + 1}',
                    _fmtDate(p['projectDate']?.toString()),
                    title,
                    p['areaOfFocusName']?.toString() ?? '-',
                    p['categoryName']?.toString() ?? '-',
                    p['subCategoryName']?.toString() ?? '-',
                    ...common,
                  ];
                }
                return [
                  '${i + 1}',
                  _fmtDate(p['projectDate']?.toString()),
                  title,
                  p['areaOfFocusName']?.toString() ?? '-',
                  p['categoryName']?.toString() ?? '-',
                  ...common,
                ];
              }).toList(),
            ));
            out.add(pw.SizedBox(height: 8));
          }

          // ── Members Section ───────────────────────────────
          out.add(_sectionHeader('Members'));
          out.add(pw.SizedBox(height: 4));
          out.add(
            pw.Table(
              border: cellBorder,
              columnWidths: const {
                0: pw.FixedColumnWidth(155),
                1: pw.FlexColumnWidth(1),
                2: pw.FixedColumnWidth(155),
                3: pw.FlexColumnWidth(1),
              },
              children: [
                pw.TableRow(children: [
                  _labelCell('Member count as on last month'),
                  _valueCell('${_asInt(r['memberCountLastMonth'])}'),
                  _labelCell('Members Deleted/Terminated'),
                  _valueCell('${_asInt(r['membersDeleted'])}'),
                ]),
                pw.TableRow(children: [
                  _labelCell('Members Added'),
                  _valueCell('${_asInt(r['membersAdded'])}'),
                  _labelCell('Current No. Of Members'),
                  _valueCell('${_asInt(r['currentMemberCount'])}'),
                ]),
              ],
            ),
          );
          out.add(pw.SizedBox(height: 6));

          final remarks = r['additionalRemarks']?.toString();
          if (remarks != null && remarks.trim().isNotEmpty) {
            out.add(pw.Text(
              'Additional achievement/participation/hosting of events/projects above club if any:',
              style: pw.TextStyle(
                  fontSize: 9, fontWeight: pw.FontWeight.bold),
            ));
            out.add(pw.SizedBox(height: 2));
            out.add(pw.Text(remarks, style: const pw.TextStyle(fontSize: 9)));
            out.add(pw.SizedBox(height: 6));
          }

          out.add(pw.Text(
            'Note: Agenda, MOM added in meeting & Photographs added in Club Meetings will not be shared to the District, only the content displayed here will be shared to the District.',
            style: pw.TextStyle(
                fontSize: 8, fontStyle: pw.FontStyle.italic),
          ));

          return out;
        },
      ),
    );

    return await pdf.save();
  }

  // ── Helpers ────────────────────────────────────────────────
  pw.Widget _sectionHeader(String text) => pw.Text(
        text,
        style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold),
      );

  pw.Widget _labelCell(String text) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: pw.Text(text,
            style: pw.TextStyle(
                fontSize: 9, fontWeight: pw.FontWeight.bold)),
      );

  pw.Widget _valueCell(String text) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: pw.Text(text, style: const pw.TextStyle(fontSize: 9)),
      );

  pw.Widget _dataTable({
    required List<String> headers,
    required List<List<String>> rows,
    required PdfColor headerFill,
    required pw.TableBorder border,
    double fontSize = 8,
  }) {
    return pw.Table(
      border: border,
      children: [
        pw.TableRow(
          decoration: pw.BoxDecoration(color: headerFill),
          children: headers
              .map((h) => pw.Padding(
                    padding: const pw.EdgeInsets.symmetric(
                        horizontal: 4, vertical: 4),
                    child: pw.Text(h,
                        style: pw.TextStyle(
                            fontSize: fontSize,
                            color: PdfColors.white,
                            fontWeight: pw.FontWeight.bold)),
                  ))
              .toList(),
        ),
        ...rows.map((r) => pw.TableRow(
              children: r
                  .map((c) => pw.Padding(
                        padding: const pw.EdgeInsets.symmetric(
                            horizontal: 4, vertical: 3),
                        child: pw.Text(c,
                            style: pw.TextStyle(fontSize: fontSize)),
                      ))
                  .toList(),
            )),
      ],
    );
  }
}
