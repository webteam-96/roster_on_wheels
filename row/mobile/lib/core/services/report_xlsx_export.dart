import 'dart:io';

import 'package:excel/excel.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';

/// A single column in an exported report sheet — mirrors the web frontend's
/// `{ key, label, width }` column descriptors used by `exportToCSV`.
class ReportColumn {
  final String key;
  final String label;
  final double width;
  final bool hyperlink;
  const ReportColumn(
    this.key,
    this.label, {
    this.width = 18,
    this.hyperlink = false,
  });
}

/// One report section → one worksheet (title, header, data rows, footer).
class ReportSheet {
  final String name;
  final List<ReportColumn> columns;
  final List<Map<String, dynamic>> rows;
  const ReportSheet({
    required this.name,
    required this.columns,
    required this.rows,
  });
}

class ReportXlsxResult {
  final File file;
  final int sheetCount;
  final int rowCount;
  const ReportXlsxResult({
    required this.file,
    required this.sheetCount,
    required this.rowCount,
  });
}

/// Builds a styled `.xlsx` workbook (one worksheet per [ReportSheet]) that
/// mirrors the web frontend's `exportToCSV` layout: title row, brand line,
/// optional subtitle, generated-at + total row, blank separator, header row,
/// alternating data rows, and footer total. Saves to a temp file and returns
/// the handle for sharing/opening.
Future<ReportXlsxResult> buildReportXlsx({
  required String fileName,
  String? subtitle,
  required List<ReportSheet> sheets,
}) async {
  final excel = Excel.createExcel();
  const defaultSheet = 'Sheet1';

  final now = DateTime.now();
  final dateStr = DateFormat('dd MMM yyyy, hh:mm a').format(now);

  final usedNames = <String>{};
  var totalRows = 0;

  for (final section in sheets) {
    final sheetName = _uniqueSheetName(section.name, usedNames);
    final sheet = excel[sheetName];
    totalRows += section.rows.length;
    _writeSheet(
      sheet: sheet,
      title: section.name,
      subtitle: subtitle,
      dateStr: dateStr,
      columns: section.columns,
      rows: section.rows,
    );
  }

  // Excel.createExcel() seeds a default 'Sheet1'; drop it once real sheets exist.
  if (sheets.isNotEmpty &&
      excel.sheets.containsKey(defaultSheet) &&
      !usedNames.contains(defaultSheet)) {
    excel.delete(defaultSheet);
  }

  final bytes = excel.save(fileName: 'in_memory.xlsx');
  if (bytes == null) {
    throw const FileSystemException('Failed to encode XLSX bytes');
  }

  final dir = await getTemporaryDirectory();
  final dateTag = DateFormat('yyyy-MM-dd').format(now);
  final safeName = fileName.replaceAll(RegExp(r'\s+'), '_');
  final fullName = '${safeName}_$dateTag.xlsx';
  final file = File('${dir.path}/$fullName');
  await file.writeAsBytes(bytes, flush: true);
  return ReportXlsxResult(
    file: file,
    sheetCount: sheets.length,
    rowCount: totalRows,
  );
}

void _writeSheet({
  required Sheet sheet,
  required String title,
  required String? subtitle,
  required String dateStr,
  required List<ReportColumn> columns,
  required List<Map<String, dynamic>> rows,
}) {
  final colCount = columns.isEmpty ? 1 : columns.length;

  final titleStyle = CellStyle(
    bold: true,
    fontSize: 16,
    fontColorHex: ExcelColor.fromHexString('#1F4E79'),
    horizontalAlign: HorizontalAlign.Left,
  );
  final subtitleStyle = CellStyle(
    fontSize: 10,
    italic: true,
    fontColorHex: ExcelColor.fromHexString('#555555'),
    horizontalAlign: HorizontalAlign.Left,
  );
  final infoStyle = CellStyle(
    fontSize: 10,
    fontColorHex: ExcelColor.fromHexString('#666666'),
    horizontalAlign: HorizontalAlign.Left,
  );
  final headerStyle = CellStyle(
    bold: true,
    fontSize: 11,
    fontColorHex: ExcelColor.fromHexString('#FFFFFF'),
    backgroundColorHex: ExcelColor.fromHexString('#1F4E79'),
    horizontalAlign: HorizontalAlign.Center,
    verticalAlign: VerticalAlign.Center,
  );
  final oddRowStyle = CellStyle(
    fontSize: 10,
    backgroundColorHex: ExcelColor.fromHexString('#FFFFFF'),
  );
  final evenRowStyle = CellStyle(
    fontSize: 10,
    backgroundColorHex: ExcelColor.fromHexString('#F2F7FB'),
  );
  final footerStyle = CellStyle(
    bold: true,
    fontSize: 10,
    fontColorHex: ExcelColor.fromHexString('#1F4E79'),
    backgroundColorHex: ExcelColor.fromHexString('#E8EEF4'),
  );

  void mergeRow(int r) {
    sheet.merge(
      CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: r),
      CellIndex.indexByColumnRow(columnIndex: colCount - 1, rowIndex: r),
    );
  }

  int row = 0;

  // Title
  sheet.cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
    ..value = TextCellValue(title)
    ..cellStyle = titleStyle;
  mergeRow(row);
  sheet.setRowHeight(row, 28);
  row++;

  // Brand line
  sheet.cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
    ..value = TextCellValue('${Brand.current.productName} Admin Portal')
    ..cellStyle = subtitleStyle;
  mergeRow(row);
  row++;

  // Optional subtitle
  if (subtitle != null && subtitle.isNotEmpty) {
    sheet.cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
      ..value = TextCellValue(subtitle)
      ..cellStyle = subtitleStyle;
    mergeRow(row);
    row++;
  }

  // Generated + total
  sheet.cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
    ..value =
        TextCellValue('Generated: $dateStr  |  Total Records: ${rows.length}')
    ..cellStyle = infoStyle;
  mergeRow(row);
  row++;

  // Blank separator
  row++;

  // Header row
  for (var c = 0; c < columns.length; c++) {
    sheet.cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: row))
      ..value = TextCellValue(columns[c].label)
      ..cellStyle = headerStyle;
  }
  sheet.setRowHeight(row, 22);
  row++;

  // Data rows
  for (var i = 0; i < rows.length; i++) {
    final style = i % 2 == 0 ? oddRowStyle : evenRowStyle;
    final rowData = rows[i];
    for (var c = 0; c < columns.length; c++) {
      final col = columns[c];
      final cell =
          sheet.cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: row));
      final raw = rowData[col.key];
      if (col.hyperlink &&
          raw is String &&
          (raw.startsWith('http://') || raw.startsWith('https://'))) {
        cell.value = FormulaCellValue('HYPERLINK("$raw","View")');
        cell.cellStyle = CellStyle(
          fontSize: 10,
          underline: Underline.Single,
          fontColorHex: ExcelColor.fromHexString('#0563C1'),
        );
      } else {
        cell.value = TextCellValue(_formatValue(raw));
        cell.cellStyle = style;
      }
    }
    row++;
  }

  // Blank + footer total
  row++;
  sheet.cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
    ..value = TextCellValue('Total: ${rows.length} record(s)')
    ..cellStyle = footerStyle;
  mergeRow(row);

  for (var c = 0; c < columns.length; c++) {
    sheet.setColumnWidth(c, columns[c].width);
  }
}

/// Opens the OS share sheet for the generated file, then shows an
/// "OPEN" snackbar. Mirrors the AG Reports share flow.
Future<void> shareReportXlsx(
  BuildContext context,
  ReportXlsxResult result,
  String title,
) async {
  // iOS requires a non-zero source rect for the share popover.
  final box = context.findRenderObject() as RenderBox?;
  final origin = (box != null && box.hasSize)
      ? box.localToGlobal(Offset.zero) & box.size
      : const Rect.fromLTWH(0, 0, 1, 1);
  await Share.shareXFiles(
    [
      XFile(
        result.file.path,
        mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ],
    subject: title,
    text:
        '$title: ${result.rowCount} record${result.rowCount == 1 ? "" : "s"}',
    sharePositionOrigin: origin,
  );
}

/// Excel sheet names: max 31 chars, no `[]:*?/\`, must be unique & non-empty.
String _uniqueSheetName(String raw, Set<String> used) {
  var base = raw.replaceAll(RegExp(r'[\[\]:*?/\\]'), ' ').trim();
  if (base.isEmpty) base = 'Sheet';
  if (base.length > 31) base = base.substring(0, 31);
  var name = base;
  var n = 2;
  while (used.contains(name)) {
    final suffix = ' ($n)';
    final maxBase = 31 - suffix.length;
    name = (base.length > maxBase ? base.substring(0, maxBase) : base) + suffix;
    n++;
  }
  used.add(name);
  return name;
}

String _formatValue(dynamic v) {
  if (v == null) return '';
  if (v is bool) return v ? 'Yes' : 'No';
  if (v is String) {
    final iso = RegExp(r'^\d{4}-\d{2}-\d{2}T');
    if (iso.hasMatch(v)) {
      final parsed = DateTime.tryParse(v);
      // Backend zero dates (`0001-01-01`) mean "no value" — blank the cell
      // instead of leaking the raw ISO sentinel.
      if (parsed != null && parsed.year <= 1) return '';
      if (parsed != null && parsed.year > 2000) {
        return DateFormat('dd MMM yyyy, hh:mm a').format(parsed.toLocal());
      }
    }
    return v;
  }
  return v.toString();
}
