#!/usr/bin/env node
/**
 * md-to-pdf.mjs — 零依赖 Markdown → PDF 转换器
 *
 * 用途：将周报数据快照等 Markdown 报告渲染为带样式的 HTML，再借助本机
 *      Chrome/Edge 的 headless「打印到 PDF」能力生成可直接插入周报的 PDF。
 *
 * 不引入 npm 依赖：内置轻量 Markdown 解析（覆盖本仓库报告用到的语法：
 *   标题 / 段落 / 引用块 / 有序·无序列表 / 表格 / 代码块 / 行内代码·加粗·链接 / 图片 / 分隔线）。
 *
 * 用法：
 *   node scripts/md-to-pdf.mjs <input.md> [output.pdf]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// ---------- 参数 ----------
const inputArg = process.argv[2];
if (!inputArg) {
  console.error('用法: node scripts/md-to-pdf.mjs <input.md> [output.pdf]');
  process.exit(1);
}
const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(process.argv[3] || inputPath.replace(/\.md$/i, '.pdf'));
const baseDir = path.dirname(inputPath);

if (!fs.existsSync(inputPath)) {
  console.error(`找不到输入文件: ${inputPath}`);
  process.exit(1);
}

// ---------- 极简 Markdown → HTML ----------
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 行内：代码 -> 图片 -> 链接 -> 加粗 -> 斜体
function inline(text) {
  const codeSpans = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => {
    codeSpans.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  t = escapeHtml(t);
  // 图片 ![alt](src)
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const resolved = /^https?:\/\//i.test(src) ? src : `file://${path.resolve(baseDir, src)}`;
    return `<img src="${resolved}" alt="${alt}" />`;
  });
  // 链接 [text](href)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => `<a href="${href}">${txt}</a>`);
  // 加粗 **x**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体 *x*（避开已消费的 **）
  t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // 还原行内代码
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
  return t;
}

function parseTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let listType = null; // 'ul' | 'ol'

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^```/.test(line)) {
      closeList();
      const lang = line.replace(/^```/, '').trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过结束 ```
      out.push(`<pre class="lang-${lang || 'text'}"><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 表格（当前行含 | 且下一行是分隔线）
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      closeList();
      const header = parseTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      let html = '<table><thead><tr>';
      header.forEach((h) => { html += `<th>${inline(h)}</th>`; });
      html += '</tr></thead><tbody>';
      rows.forEach((r) => {
        html += '<tr>';
        header.forEach((_, ci) => { html += `<td>${inline(r[ci] ?? '')}</td>`; });
        html += '</tr>';
      });
      html += '</tbody></table>';
      out.push(html);
      continue;
    }

    // 分隔线
    if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr />'); i++; continue; }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    // 引用块
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      i++; continue;
    }
    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
      i++; continue;
    }

    // 空行
    if (line.trim() === '') { closeList(); i++; continue; }

    // 普通段落
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return out.join('\n');
}

// ---------- HTML 模板（含中文字体与打印样式） ----------
const title = path.basename(inputPath, '.md');
const bodyHtml = mdToHtml(fs.readFileSync(inputPath, 'utf8'));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "PingFang SC", "STHeiti", "Heiti SC", "Microsoft YaHei", "Arial Unicode MS", sans-serif;
    color: #1f2933; font-size: 12.5px; line-height: 1.7; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 22px; border-bottom: 3px solid #6d28d9; padding-bottom: 8px; margin: 0 0 16px; color: #4c1d95; }
  h2 { font-size: 17px; margin: 22px 0 10px; color: #5b21b6; border-left: 4px solid #a78bfa; padding-left: 10px; }
  h3 { font-size: 14px; margin: 16px 0 8px; color: #4338ca; }
  p { margin: 8px 0; }
  a { color: #6d28d9; text-decoration: none; }
  strong { color: #b91c1c; }
  hr { border: none; border-top: 1px dashed #cbd5e1; margin: 18px 0; }
  blockquote {
    margin: 10px 0; padding: 8px 14px; background: #f5f3ff;
    border-left: 4px solid #a78bfa; color: #4b5563; border-radius: 0 6px 6px 0;
  }
  code {
    font-family: "SFMono-Regular", "Menlo", monospace; font-size: 11.5px;
    background: #f1f5f9; color: #be123c; padding: 1px 5px; border-radius: 4px;
  }
  pre {
    background: #1e293b; color: #e2e8f0; padding: 12px 14px; border-radius: 8px;
    overflow-x: auto; font-size: 11.5px; line-height: 1.55; page-break-inside: avoid;
  }
  pre code { background: none; color: inherit; padding: 0; }
  table {
    border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 11.5px;
    page-break-inside: avoid;
  }
  th, td { border: 1px solid #d9d9e3; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #ede9fe; color: #4c1d95; font-weight: 600; }
  tbody tr:nth-child(even) { background: #faf9ff; }
  img { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; margin: 8px 0; }
  h2, h3 { page-break-after: avoid; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

const tmpHtml = path.join(os.tmpdir(), `md2pdf-${Date.now()}.html`);
fs.writeFileSync(tmpHtml, html, 'utf8');

// ---------- 定位无头浏览器 ----------
const candidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const browser = candidates.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('未找到 Chrome/Edge/Chromium，无法生成 PDF。已生成 HTML：' + tmpHtml);
  process.exit(2);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2pdf-profile-'));
const res = spawnSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--user-data-dir=${userDataDir}`,
  '--no-pdf-header-footer',
  `--print-to-pdf=${outputPath}`,
  '--virtual-time-budget=8000',
  `file://${tmpHtml}`,
], { stdio: 'inherit' });

fs.rmSync(tmpHtml, { force: true });
fs.rmSync(userDataDir, { recursive: true, force: true });

if (res.status !== 0 || !fs.existsSync(outputPath)) {
  console.error('PDF 生成失败，退出码：' + res.status);
  process.exit(3);
}

const kb = (fs.statSync(outputPath).size / 1024).toFixed(1);
console.log(`✅ PDF 已生成: ${outputPath} (${kb} KB)`);
