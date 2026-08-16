'use strict';

/**
 * Sprint 18 - S18-T02 数据导出服务
 *
 *   toCSV(columns, rows)：RFC 4180 兼容 CSV（含 UTF-8 BOM，Excel 直接打开中文不乱码）
 *   toXLSX(columns, rows)：用 adm-zip 手工打包最小 xlsx（无新增第三方依赖）
 *
 * columns: [{ key, label }]，rows: 对象数组。导出内容为真实数据库数据，无 mock。
 */

const AdmZip = require('adm-zip');

function escCSV(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(columns, rows) {
  const header = columns.map((c) => escCSV(c.label || c.key)).join(',');
  const lines = rows.map((r) => columns.map((c) => escCSV(r[c.key])).join(','));
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(i) {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** 生成最小合法 .xlsx（单 sheet，inlineStr 单元格）。返回 Buffer。 */
function toXLSX(columns, rows) {
  const headerCells = columns
    .map((c, i) => `<c r="${colName(i)}1" t="inlineStr"><is><t>${xmlEscape(c.label || c.key)}</t></is></c>`)
    .join('');
  const body = rows
    .map((r, ri) => {
      const cells = columns
        .map((c, ci) => `<c r="${colName(ci)}${ri + 2}" t="inlineStr"><is><t>${xmlEscape(r[c.key])}</t></is></c>`)
        .join('');
      return `<row r="${ri + 2}">${cells}</row>`;
    })
    .join('');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1">${headerCells}</row>${body}</sheetData>
</worksheet>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRels, 'utf8'));
  zip.addFile('xl/workbook.xml', Buffer.from(workbook, 'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRels, 'utf8'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet, 'utf8'));
  return zip.toBuffer();
}

module.exports = { toCSV, toXLSX, escCSV };
