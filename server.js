'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const { extractText, cleanText } = require('./lib/extractText');
const { generateStudyKit, MODEL } = require('./lib/generate');

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_FILE_BYTES = (Number(process.env.MAX_FILE_MB)) * 1024 * 1024;
const MAX_TEXT_CHARS = Number(process.env.MAX_TEXT_CHARS) || 24000; // sent to the model
const PREVIEW_CHARS = 6000; // shown back to the user
const MIN_TEXT_CHARS = 20; // below this we treat the document as "empty"

const ALLOWED_EXTS = new Set([
  '.pdf', '.docx', '.pptx', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_EXTS.has(ext) || (file.mimetype || '').startsWith('image/')) {
      cb(null, true);
    } else {
      const err = new Error(
        `Unsupported file type${ext ? ` (${ext})` : ''}. Upload a PDF, DOCX, PPTX, TXT, or image.`,
      );
      err.statusCode = 415;
      cb(err);
    }
  },
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/analyze', (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    try {
      // ---- Upload-level errors ----
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: `File is too large. The limit is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
          });
        }
        return res
          .status(uploadErr.statusCode || 400)
          .json({ error: uploadErr.message || 'Upload failed.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file received. Please choose a file to upload.' });
      }

      // ---- How many questions? Default 5, clamp to 1-20. ----
      let numQuestions = parseInt(req.body.numQuestions, 10);
      if (!Number.isFinite(numQuestions) || numQuestions < 1) numQuestions = 5;
      numQuestions = Math.min(numQuestions, 20);

      // ---- Extract text ----
      let extracted;
      try {
        extracted = await extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
      } catch (e) {
        return res
          .status(e.statusCode || 422)
          .json({ error: e.message || 'Could not read this file.' });
      }

      const text = cleanText(extracted.text);
      if (!text || text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
        const hint =
          extracted.kind === 'pdf'
            ? ' If this is a scanned PDF it has no text layer — export the page as an image to use OCR.'
            : extracted.kind === 'image'
              ? ' The image may be too blurry or contain no readable text.'
              : '';
        return res.status(422).json({ error: `No readable text found in the document.${hint}` });
      }

      const truncated = text.length > MAX_TEXT_CHARS;
      const textForModel = truncated ? text.slice(0, MAX_TEXT_CHARS) : text;

      // ---- Generate summary + quiz ----
      const kit = await generateStudyKit(textForModel, numQuestions);

      if (!kit.questions.length) {
        return res.status(502).json({
          error:
            'The AI could not produce valid questions from this document. Try a different file or fewer questions.',
        });
      }

      return res.json({
        fileName: req.file.originalname,
        kind: extracted.kind,
        model: kit.model,
        charCount: text.length,
        truncated,
        requested: numQuestions,
        summary: kit.summary,
        questions: kit.questions,
        preview: text.slice(0, PREVIEW_CHARS),
        previewTruncated: text.length > PREVIEW_CHARS,
      });
    } catch (e) {
      return res
        .status(e.statusCode || 500)
        .json({ error: e.message || 'Something went wrong. Please try again.' });
    }
  });
});

// Fallback to the SPA for any unknown route.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Study AI  →  http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  if (process.env.OPENAI_API_KEY) {
    console.log('  OPENAI_API_KEY detected \u2713\n');
  } else {
    console.log('  \u26A0  OPENAI_API_KEY is not set. Add it to .env before analyzing files.\n');
  }
});
