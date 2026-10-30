import 'dart:io';
import 'package:excel/excel.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'ag_report_configs.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';

class AgReportExportResult {
  final File file;
  final int rowCount;
  const AgReportExportResult({required this.file, required this.rowCount});
}

/// Generates an XLSX file mirroring the web frontend's `exportToCSV` layout:
/// title row, "<product> Admin Portal" subtitle, generated-at + total row,
/// blank separator, header row, alternating data rows, and footer total.
Future<AgReportExportResult> exportAgReportToXlsx({
  required AgReportConfig config,
  required List<Map<String, dynamic>> rows,
  String? subtitle,
  String? fileNameSuffix,
}) async {
  final excel = Excel.createExcel();
  const sheetName = 'Report';
  final sheet = excel[sheetName];
  // Excel.createExcel() inserts a default 'Sheet1' — drop it.
  if (excel.sheets.containsKey('Sheet1') && sheetName != 'Sheet1') {
    excel.delete('Sheet1');
  }

  final cols = config.columns;
  final colCount = cols.length;
  final now = DateTime.now();
  final dateStr = DateFormat('dd MMM yyyy, hh:mm a').format(now);

  final reportTitle = config.fileName
      .replaceAll('_', ' ')
      .splitMapJoin(
        RegExp(r'\b\w'),
        onMatch: (m) => m[0]!.toUpperCase(),
        onNonMatch: (s) => s,
      );

  CellStyle titleStyle = CellStyle(
    bold: true,
    fontSize: 16,
    fontColorHex: ExcelColor.fromHexString('#1F4E79'),
    horizontalAlign: HorizontalAlign.Left,
  );
  CellStyle subtitleStyle = CellStyle(
    fontSize: 13,
    italic: true,
    fontColorHex: ExcelColor.fromHexString('#555555'),
    horizontalAlign: HorizontalAlign.Left,
  );
  CellStyle infoStyle = CellStyle(
    fontSize: 13,
    fontColorHex: ExcelColor.fromHexString('#666666'),
    horizontalAlign: HorizontalAlign.Left,
  );
  CellStyle headerStyle = CellStyle(
    bold: true,
    fontSize: 13,
    fontColorHex: ExcelColor.fromHexString('#FFFFFF'),
    backgroundColorHex: ExcelColor.fromHexString('#1F4E79'),
    horizontalAlign: HorizontalAlign.Center,
    verticalAlign: VerticalAlign.Center,
  );
  CellStyle oddRowStyle = CellStyle(
    fontSize: 13,
    backgroundColorHex: ExcelColor.fromHexString('#FFFFFF'),
  );
  CellStyle evenRowStyle = CellStyle(
    fontSize: 13,
    backgroundColorHex: ExcelColor.fromHexString('#F2F7FB'),
  );
  CellStyle footerStyle = CellStyle(
    bold: true,
    fontSize: 13,
    fontColorHex: ExcelColor.fromHexString('#1F4E79'),
    backgroundColorHex: ExcelColor.fromHexString('#E8EEF4'),
  );

  int row = 0;

  // Row 0: Report title (merged across columns)
  final titleCell =
      sheet.cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row));
  titleCell.value = TextCellValue(reportTitle);
  titleCell.cellStyle = titleStyle;
  sheet.merge(
    CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row),
    CellIndex.indexByColumnRow(columnIndex: colCount - 1, rowIndex: row),
  );
  sheet.setRowHeight(row, 28);
  row++;

  // Row 1: Brand line
  sheet
      .cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
    ..value = TextCellValue('${Brand.current.productName} Admin Portal')
    ..cellStyle = subtitleStyle;
  sheet.merge(
    CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row),
    CellIndex.indexByColumnRow(columnIndex: colCount - 1, rowIndex: row),
  );
  row++;

  // Optional subtitle (active filters)
  if (subtitle != null && subtitle.isNotEmpty) {
    sheet
        .cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
      ..value = TextCellValue(subtitle)
      ..cellStyle = subtitleStyle;
    sheet.merge(
      CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row),
      CellIndex.indexByColumnRow(columnIndex: colCount - 1, rowIndex: row),
    );
    row++;
  }

  // Generated + total
  sheet
      .cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
    ..value =
        TextCellValue('Generated: $dateStr  |  Total Records: ${rows.length}')
    ..cellStyle = infoStyle;
  sheet.merge(
    CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row),
    CellIndex.indexByColumnRow(columnIndex: colCount - 1, rowIndex: row),
  );
  row++;

  // Blank separator
  row++;

  // Header row
  for (var c = 0; c < colCount; c++) {
    sheet
        .cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: row))
      ..value = TextCellValue(cols[c].label)
      ..cellStyle = headerStyle;
  }
  sheet.setRowHeight(row, 22);
  row++;

  // Data rows
  for (var i = 0; i < rows.length; i++) {
    final style = i % 2 == 0 ? oddRowStyle : evenRowStyle;
    final rowData = rows[i];
    for (var c = 0; c < colCount; c++) {
      final col = cols[c];
      final cell = sheet
          .cell(CellIndex.indexByColumnRow(columnIndex: c, rowIndex: row));
      final raw = rowData[col.key];
      if (col.hyperlink &&
          raw is String &&
          (raw.startsWith('http://') || raw.startsWith('https://'))) {
        cell.value = FormulaCellValue('HYPERLINK("$raw","View")');
        cell.cellStyle = CellStyle(
          fontSize: 13,
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
  sheet
      .cell(CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row))
    ..value = TextCellValue('Total: ${rows.length} record(s)')
    ..cellStyle = footerStyle;
  sheet.merge(
    CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row),
    CellIndex.indexByColumnRow(columnIndex: colCount - 1, rowIndex: row),
  );

  // Column widths
  for (var c = 0; c < colCount; c++) {
    sheet.setColumnWidth(c, cols[c].width);
  }

  final bytes = excel.save(fileName: 'in_memory.xlsx');
  if (bytes == null) {
    throw const FileSystemException('Failed to encode XLSX bytes');
  }

  final dir = await getTemporaryDirectory();
  final dateTag = DateFormat('yyyy-MM-dd').format(now);
  final safeSuffix = (fileNameSuffix ?? '').replaceAll(RegExp(r'\s+'), '_');
  final fullName = '${config.fileName}${safeSuffix}_$dateTag.xlsx';
  final file = File('${dir.path}/$fullName');
  await file.writeAsBytes(bytes, flush: true);
  return AgReportExportResult(file: file, rowCount: rows.length);
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
