import 'dart:convert';
import 'dart:io';
import 'package:archive/archive.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../network/api_client.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Native Word (.docx) generator for the Club Monthly Report.
// Mirrors rotary-frontend/src/utils/reportDownload.ts → downloadWord().
//
// A .docx is a ZIP archive of Open XML files. We emit only the minimum
// parts Word needs to open: [Content_Types].xml, _rels/.rels,
// word/document.xml, word/_rels/document.xml.rels, word/styles.xml.
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

/// XML-escape a string so it's safe inside `<w:t>` etc.
String _xml(String s) => s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

class MonthlyReportWordService {
  final ApiClient _api;
  MonthlyReportWordService([ApiClient? api]) : _api = api ?? ApiClient();

  /// Fetches the preview JSON and emits a saved .docx file path.
  Future<String> generateAndSaveDocx({
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

    final documentXml = _buildDocumentXml(report);
    final bytes = _zipDocx(documentXml);

    final dir = await getApplicationDocumentsDirectory();
    final clubName = (report['clubName']?.toString() ?? 'Club');
    final monthName = (report['monthName']?.toString() ?? 'Month');
    final yearLabel = (report['yearLabel']?.toString() ?? 'Year');
    final fileName =
        '${_sanitize('${clubName}_Monthly_Report_${monthName}_$yearLabel')}.docx';
    final file = File('${dir.path}/$fileName');
    await file.writeAsBytes(bytes);
    return file.path;
  }

  Future<void> openFile(String path) async {
    await OpenFilex.open(path);
  }

  // ── Zip wrapper ─────────────────────────────────────────────
  List<int> _zipDocx(String documentXml) {
    final archive = Archive();

    void add(String path, String content) {
      final data = utf8.encode(content);
      archive.addFile(ArchiveFile(path, data.length, data));
    }

    add('[Content_Types].xml', _contentTypesXml);
    add('_rels/.rels', _topRelsXml);
    add('word/_rels/document.xml.rels', _docRelsXml);
    add('word/styles.xml', _stylesXml);
    add('word/document.xml', documentXml);

    return ZipEncoder().encode(archive)!;
  }

  // ── document.xml ────────────────────────────────────────────
  String _buildDocumentXml(Map<String, dynamic> r) {
    final monthName = r['monthName']?.toString() ?? '';
    final yearLabel = r['yearLabel']?.toString() ?? '';
    final uploadedDate = r['uploadedToDistrictDate']?.toString();

    final buf = StringBuffer();
    buf.write(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<w:body>');

    // Title (centered, bold, 28pt half-points = size 28 in OOXML)
    buf.write(_paragraph(
      runs: [_run('Club Monthly Report - $monthName $yearLabel', bold: true, sizeHalfPt: 28)],
      alignment: 'center',
      spacingAfter: (uploadedDate != null && uploadedDate.isNotEmpty) ? 50 : 200,
    ));

    if (uploadedDate != null && uploadedDate.isNotEmpty) {
      buf.write(_paragraph(
        runs: [_run('Uploaded to District: ${_fmtDateTime(uploadedDate)}',
            bold: true, sizeHalfPt: 24)],
        alignment: 'center',
        spacingAfter: 200,
      ));
    }

    // Info table (4 rows x 4 cols)
    buf.write(_table(
      rows: [
        _tableRow([
          _td('Club Name', bold: true),
          _td(r['clubName']?.toString() ?? '-'),
          _td('Prepared By', bold: true),
          _td(r['preparedBy']?.toString() ?? '-'),
        ]),
        _tableRow([
          _td('Rotary Club ID', bold: true),
          _td(r['clubCode']?.toString() ?? '-'),
          _td('Designation', bold: true),
          _td(r['designation']?.toString() ?? '-'),
        ]),
        _tableRow([
          _td('Assistant Governor', bold: true),
          _td(r['assistantGovernor']?.toString() ?? '-'),
          _td('No. Of Members', bold: true),
          _td('${_asInt(r['currentMemberCount'])}'),
        ]),
        _tableRow([
          _td('No. Of Meetings', bold: true),
          _td('${_asInt(r['totalMeetings'])}'),
          _td('Avg. Attendance', bold: true),
          _td('${_asInt(r['averageAttendance'])}%'),
        ]),
      ],
    ));
    buf.write(_paragraph(runs: const [], spacingBefore: 200));

    // TRF section
    buf.write(_paragraph(
      runs: [_run('TRF Contribution', bold: true, sizeHalfPt: 24)],
      spacingBefore: 200,
      spacingAfter: 100,
    ));
    buf.write(_paragraph(
      runs: [
        _run(
          'Current Month: \$${_asDouble(r['trfCurrentMonth']).toStringAsFixed(2)}    '
          '|    This Year: \$${_asDouble(r['trfThisYear']).toStringAsFixed(2)}',
          sizeHalfPt: 18,
        ),
      ],
      spacingAfter: 100,
    ));

    final trfEntries = List<Map<String, dynamic>>.from(
        (r['trfEntries'] ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    if (trfEntries.isNotEmpty) {
      buf.write(_table(
        rows: [
          _tableRow([
            _th('Sr.No'), _th('Date'), _th('Name'), _th('Amount (USD)'), _th('Fund Type'),
          ]),
          ...trfEntries.asMap().entries.map((e) {
            final i = e.key;
            final t = e.value;
            final fundType = t['fundType']?.toString() ?? '';
            final otherName = t['otherFundName']?.toString();
            final fundDisp = (fundType == 'Other' && otherName != null && otherName.isNotEmpty)
                ? otherName
                : fundType;
            return _tableRow([
              _td('${i + 1}'),
              _td(_fmtDate(t['trfDate']?.toString())),
              _td(t['donorName']?.toString() ?? '-'),
              _td('\$${_asDouble(t['amountUSD']).toStringAsFixed(2)}'),
              _td(fundDisp),
            ]);
          }),
        ],
      ));
    }

    // Meetings section
    final meetings = List<Map<String, dynamic>>.from(
        (r['meetings'] ?? const []).map((e) => Map<String, dynamic>.from(e as Map)));
    final meetingsByType = <String, List<Map<String, dynamic>>>{};
    for (final m in meetings) {
      final t = m['meetingType']?.toString() ?? 'other';
      meetingsByType.putIfAbsent(t, () => []).add(m);
    }

    if (meetingsByType.isNotEmpty) {
      buf.write(_paragraph(
        runs: [_run('Meetings', bold: true, sizeHalfPt: 24)],
        spacingBefore: 200,
        spacingAfter: 100,
      ));
      for (final entry in meetingsByType.entries) {
        final label = _kMeetingTypeLabels[entry.key] ?? entry.key;
        buf.write(_paragraph(
          runs: [_run('$label (${entry.value.length})',
              bold: true, sizeHalfPt: 20)],
          spacingBefore: 100,
          spacingAfter: 50,
        ));
        buf.write(_table(
          rows: [
            _tableRow([
              _th('Sr.No'), _th('Date'), _th('Title'),
              _th('Attendance'), _th('Attendance %'),
            ]),
            ...entry.value.asMap().entries.map((e) {
              final i = e.key;
              final m = e.value;
              return _tableRow([
                _td('${i + 1}'),
                _td(_fmtDate(m['projectDate']?.toString())),
                _td(m['title']?.toString() ?? '-'),
                _td(_asDouble(m['attendance']) > 0
                    ? '${_asInt(m['attendance'])}'
                    : '-'),
                _td(_asDouble(m['attendancePercentage']) > 0
                    ? '${_asInt(m['attendancePercentage'])}%'
                    : '-'),
              ]);
            }),
          ],
        ));
      }
    }

    // Projects sections
    final projectsMap =
        Map<String, dynamic>.from(r['projects'] as Map? ?? const {});
    for (final entry in _kProjectLabels.entries) {
      final key = entry.key;
      final label = entry.value;
      final list = projectsMap[key];
      if (list is! List || list.isEmpty) continue;

      final projects = List<Map<String, dynamic>>.from(
          list.map((e) => Map<String, dynamic>.from(e as Map)));

      buf.write(_paragraph(
        runs: [_run(label, bold: true, sizeHalfPt: 24)],
        spacingBefore: 200,
        spacingAfter: 100,
      ));

      final headerCells = [
        _th('Sr.No'), _th('Date'), _th('Title'), _th('Area of Focus'),
        _th('Cost'), _th('Beneficiaries'), _th('Man Hours'),
        _th('Rotarians'), _th('Rotaractors'),
      ];

      buf.write(_table(
        rows: [
          _tableRow(headerCells),
          ...projects.asMap().entries.map((e) {
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
            // Omit zero-valued metrics (show '-') to match the server report —
            // a present 0 is treated as "no value".
            final common = [
              _td(_asDouble(p['projectCost']) > 0
                  ? NumberFormat('#,##0').format(_asInt(p['projectCost']))
                  : '-'),
              _td(_asDouble(p['directBeneficiaries']) > 0
                  ? '${_asInt(p['directBeneficiaries'])}'
                  : '-'),
              _td(_asDouble(p['manHours']) > 0 ? '${_asInt(p['manHours'])}' : '-'),
              _td(_asDouble(p['rotariansInvolved']) > 0
                  ? '${_asInt(p['rotariansInvolved'])}'
                  : '-'),
              _td(_asDouble(p['rotaractorsInvolved']) > 0
                  ? '${_asInt(p['rotaractorsInvolved'])}'
                  : '-'),
            ];
            return _tableRow([
              _td('${i + 1}'),
              _td(_fmtDate(p['projectDate']?.toString())),
              _td(title),
              _td(p['areaOfFocusName']?.toString() ?? '-'),
              ...common,
            ]);
          }),
        ],
      ));
    }

    // Members section
    buf.write(_paragraph(
      runs: [_run('Members', bold: true, sizeHalfPt: 24)],
      spacingBefore: 200,
      spacingAfter: 100,
    ));
    buf.write(_table(
      rows: [
        _tableRow([
          _td('Member count as on last month', bold: true),
          _td('${_asInt(r['memberCountLastMonth'])}'),
          _td('Members Deleted/Terminated', bold: true),
          _td('${_asInt(r['membersDeleted'])}'),
        ]),
        _tableRow([
          _td('Members Added', bold: true),
          _td('${_asInt(r['membersAdded'])}'),
          _td('Current No. Of Members', bold: true),
          _td('${_asInt(r['currentMemberCount'])}'),
        ]),
      ],
    ));

    final remarks = r['additionalRemarks']?.toString();
    if (remarks != null && remarks.trim().isNotEmpty) {
      buf.write(_paragraph(
        runs: [
          _run(
              'Additional achievement/participation/hosting of events/projects above club if any: ',
              bold: true,
              sizeHalfPt: 18),
          _run(remarks, sizeHalfPt: 18),
        ],
        spacingBefore: 100,
      ));
    }

    // Footer note
    buf.write(_paragraph(
      runs: [
        _run('Note: ', bold: true, italic: true, sizeHalfPt: 16),
        _run(
            'Agenda, MOM added in meeting & Photographs added in Club Meetings will not be shared to the District, only the content displayed here will be shared to the District.',
            italic: true,
            sizeHalfPt: 16),
      ],
      spacingBefore: 200,
    ));

    // sectPr — defines page size/margins.
    buf.write(
        '<w:sectPr>'
        '<w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" '
        'w:header="720" w:footer="720" w:gutter="0"/>'
        '</w:sectPr>');

    buf.write('</w:body></w:document>');
    return buf.toString();
  }

  // ── XML primitives ──────────────────────────────────────────
  String _run(
    String text, {
    bool bold = false,
    bool italic = false,
    int sizeHalfPt = 22,
    String? color,
  }) {
    final props = StringBuffer('<w:rPr>');
    if (bold) props.write('<w:b/>');
    if (italic) props.write('<w:i/>');
    props.write('<w:sz w:val="$sizeHalfPt"/>');
    if (color != null) props.write('<w:color w:val="$color"/>');
    props.write('</w:rPr>');
    return '<w:r>${props.toString()}<w:t xml:space="preserve">${_xml(text)}</w:t></w:r>';
  }

  String _paragraph({
    required List<String> runs,
    String? alignment,
    int? spacingBefore,
    int? spacingAfter,
  }) {
    final props = StringBuffer('<w:pPr>');
    if (alignment != null) {
      props.write('<w:jc w:val="$alignment"/>');
    }
    if (spacingBefore != null || spacingAfter != null) {
      props.write('<w:spacing');
      if (spacingBefore != null) props.write(' w:before="$spacingBefore"');
      if (spacingAfter != null) props.write(' w:after="$spacingAfter"');
      props.write('/>');
    }
    props.write('</w:pPr>');
    return '<w:p>${props.toString()}${runs.join()}</w:p>';
  }

  /// Data cell
  String _td(String text, {bool bold = false}) =>
      _cell(text, bold: bold, shading: null, color: null);

  /// Header cell (white text on primary-blue shading)
  String _th(String text) =>
      _cell(text, bold: true, shading: '2980B9', color: 'FFFFFF');

  String _cell(String text, {
    bool bold = false,
    String? shading,
    String? color,
  }) {
    final cellProps = StringBuffer('<w:tcPr>');
    if (shading != null) {
      cellProps.write('<w:shd w:val="clear" w:color="auto" w:fill="$shading"/>');
    }
    cellProps.write(
        '<w:tcBorders>'
        '<w:top w:val="single" w:sz="4" w:color="999999"/>'
        '<w:left w:val="single" w:sz="4" w:color="999999"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="999999"/>'
        '<w:right w:val="single" w:sz="4" w:color="999999"/>'
        '</w:tcBorders>'
        '</w:tcPr>');
    final run = _run(text, bold: bold, sizeHalfPt: 18, color: color);
    return '<w:tc>${cellProps.toString()}<w:p>$run</w:p></w:tc>';
  }

  String _tableRow(List<String> cells) =>
      '<w:tr>${cells.join()}</w:tr>';

  String _table({required List<String> rows}) {
    return '<w:tbl>'
        '<w:tblPr>'
        '<w:tblW w:w="5000" w:type="pct"/>'
        '<w:tblBorders>'
        '<w:top w:val="single" w:sz="4" w:color="999999"/>'
        '<w:left w:val="single" w:sz="4" w:color="999999"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="999999"/>'
        '<w:right w:val="single" w:sz="4" w:color="999999"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="999999"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="999999"/>'
        '</w:tblBorders>'
        '</w:tblPr>'
        '${rows.join()}'
        '</w:tbl>';
  }

  // ── Static OOXML parts that Word requires ───────────────────
  static const _contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/word/document.xml" '
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      '<Override PartName="/word/styles.xml" '
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      '</Types>';

  static const _topRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" '
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      'Target="word/document.xml"/>'
      '</Relationships>';

  static const _docRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" '
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
      'Target="styles.xml"/>'
      '</Relationships>';

  static const _stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      '<w:docDefaults>'
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
      '</w:docDefaults>'
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
      '<w:name w:val="Normal"/>'
      '</w:style>'
      '</w:styles>';
}
