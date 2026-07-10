'use strict';

const fs = require('fs');
const path = require('path');

const PDF_MAGIC = '%PDF';

function isPdfBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf.slice(0, 4).toString('ascii') === PDF_MAGIC;
}

function isPdfFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 4) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return isPdfBuffer(buf);
  } catch {
    return false;
  }
}

function assertPdfBuffer(buf, context = 'download') {
  if (!isPdfBuffer(buf)) {
    const preview = buf && buf.length > 0
      ? buf.slice(0, 80).toString('utf8').replace(/\s+/g, ' ').slice(0, 60)
      : '(empty)';
    throw new Error(
      `ACCOUNTANT PDF REQUIRED: ${context} is not a PDF (expected %PDF magic bytes). Preview: ${preview}`,
    );
  }
}

function saveVerifiedPdf(filePath, body) {
  assertPdfBuffer(body, path.basename(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
  return filePath;
}

function walkAllFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAllFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function scanForNonPdfFiles(roots) {
  const report = {
    verified_pdfs: [],
    non_pdf_extension: [],
    fake_pdfs: [],
    empty_files: [],
  };
  const rootList = Array.isArray(roots) ? roots : [roots];
  for (const root of rootList) {
    if (!root || !fs.existsSync(root)) continue;
    for (const file of walkAllFiles(root)) {
      const ext = path.extname(file).toLowerCase();
      const size = fs.statSync(file).size;
      if (size === 0) {
        report.empty_files.push(file);
        continue;
      }
      if (ext !== '.pdf') {
        report.non_pdf_extension.push(file);
        continue;
      }
      if (isPdfFile(file)) report.verified_pdfs.push(file);
      else report.fake_pdfs.push(file);
    }
  }
  return report;
}

function removeInvalidFile(filePath, reason) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return { removed: true, path: filePath, reason };
  }
  return { removed: false, path: filePath, reason };
}

function formatScanReport(report) {
  return {
    verified_pdf_count: report.verified_pdfs.length,
    non_pdf_extension_count: report.non_pdf_extension.length,
    fake_pdf_count: report.fake_pdfs.length,
    empty_file_count: report.empty_files.length,
    non_pdf_extension: report.non_pdf_extension,
    fake_pdfs: report.fake_pdfs,
    empty_files: report.empty_files,
  };
}

const UUID_FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function savePlaywrightDownload(download, targetPath, context = 'download') {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await download.saveAs(targetPath);
  if (!isPdfFile(targetPath)) {
    const body = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : Buffer.alloc(0);
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    assertPdfBuffer(body, context);
  }
  return targetPath;
}

function safeMoveSync(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

function recoverAnonymousDownloads(dir, renameTo = null) {
  const recovered = [];
  if (!dir || !fs.existsSync(dir)) return recovered;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const base = entry.name;
    const ext = path.extname(base);
    const looksAnonymous = UUID_FILENAME_RE.test(base) || ext === '';
    if (!looksAnonymous) continue;

    const full = path.join(dir, base);
    if (!isPdfFile(full)) continue;

    const nextName = renameTo || `${base}.pdf`;
    const dest = path.join(dir, nextName);
    if (fs.existsSync(dest)) {
      recovered.push({ from: full, to: dest, action: 'already_named_pdf_exists' });
      continue;
    }
    safeMoveSync(full, dest);
    recovered.push({ from: full, to: dest, action: 'renamed_to_pdf' });
  }
  return recovered;
}

module.exports = {
  PDF_MAGIC,
  UUID_FILENAME_RE,
  isPdfBuffer,
  isPdfFile,
  assertPdfBuffer,
  saveVerifiedPdf,
  savePlaywrightDownload,
  scanForNonPdfFiles,
  formatScanReport,
  removeInvalidFile,
  recoverAnonymousDownloads,
  walkAllFiles,
  safeMoveSync,
};
