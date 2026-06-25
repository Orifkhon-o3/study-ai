'use strict';

const path = require('path');
const mammoth = require('mammoth');
const officeParser = require('officeparser');
const Tesseract = require('tesseract.js');
// `unpdf` is ESM-only, so it is loaded with a dynamic import inside extractText().

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif',
]);

/**
 * Pull raw text out of an uploaded file buffer.
 * Returns { text, kind } where kind is one of: pdf | docx | pptx | text | image.
 * Throws an Error with a `.statusCode` for unsupported / unreadable files.
 */
async function extractText(buffer, originalName, mimeType) {
  const ext = path.extname(originalName || '').toLowerCase();
  const mime = mimeType || '';

  // ---- PDF ----
  if (ext === '.pdf' || mime === 'application/pdf') {
    const { extractText: pdfExtractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await pdfExtractText(pdf, { mergePages: true });
    return { text: text || '', kind: 'pdf' };
  }

  // ---- DOCX ----
  if (
    ext === '.docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value || '', kind: 'docx' };
  }

  // ---- Legacy .doc (not supported by mammoth) ----
  if (ext === '.doc' || mime === 'application/msword') {
    throw withStatus(
      'Legacy .doc files are not supported. Save the file as .docx, PDF, or TXT and try again.',
      415,
    );
  }

  // ---- PPTX ----
  if (
    ext === '.pptx' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    const ast = await officeParser.parseOffice(buffer);
    const text = await ast.toText();
    return { text: text || '', kind: 'pptx' };
  }

  // ---- Legacy .ppt (not supported) ----
  if (ext === '.ppt' || mime === 'application/vnd.ms-powerpoint') {
    throw withStatus(
      'Legacy .ppt files are not supported. Save the file as .pptx, PDF, or TXT and try again.',
      415,
    );
  }

  // ---- Plain text / markdown ----
  if (
    ext === '.txt' || ext === '.md' ||
    mime === 'text/plain' || mime === 'text/markdown'
  ) {
    return { text: buffer.toString('utf-8'), kind: 'text' };
  }

  // ---- Images -> OCR ----
  if (IMAGE_EXTS.has(ext) || mime.startsWith('image/')) {
    const { data } = await Tesseract.recognize(buffer, 'eng');
    return { text: (data && data.text) || '', kind: 'image' };
  }

  throw withStatus(
    `Unsupported file type${ext ? ` (${ext})` : ''}. Upload a PDF, DOCX, PPTX, TXT, or image.`,
    415,
  );
}

/** Tidy up whitespace so the model (and the preview) get clean text. */
function cleanText(raw) {
  if (!raw) return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function withStatus(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

module.exports = { extractText, cleanText, IMAGE_EXTS };
