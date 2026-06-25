'use strict';

const ALLOWED_EXT = [
  'pdf', 'docx', 'pptx', 'txt', 'md',
  'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'tif',
];

// ---- Element refs ----
const form = document.getElementById('uploadForm');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const dzPrompt = document.getElementById('dzPrompt');
const fileChip = document.getElementById('fileChip');
const chipExt = document.getElementById('chipExt');
const chipName = document.getElementById('chipName');
const chipRemove = document.getElementById('chipRemove');
const numQuestions = document.getElementById('numQuestions');
const submitBtn = document.getElementById('submitBtn');

const errorBox = document.getElementById('errorBox');
const errorMsg = document.getElementById('errorMsg');
const loadingBox = document.getElementById('loadingBox');
const loadingMsg = document.getElementById('loadingMsg');
const loadingSub = document.getElementById('loadingSub');

const results = document.getElementById('results');
const resultsMeta = document.getElementById('resultsMeta');
const summaryText = document.getElementById('summaryText');
const quizList = document.getElementById('quizList');
const scorePill = document.getElementById('scorePill');
const resetQuizBtn = document.getElementById('resetQuizBtn');
const previewToggle = document.getElementById('previewToggle');
const previewBody = document.getElementById('previewBody');
const previewText = document.getElementById('previewText');
const previewNote = document.getElementById('previewNote');
const againBtn = document.getElementById('againBtn');
const footModel = document.getElementById('footModel');

let selectedFile = null;
let lastQuestions = [];
let loadingTimer = null;

// ---- Health check (model name in footer) ----
fetch('/api/health')
  .then((r) => r.json())
  .then((d) => {
    if (d && d.model) footModel.textContent = `Powered by OpenAI · ${d.model}`;
    if (d && d.hasKey === false) {
      showError('Heads up: the server has no OPENAI_API_KEY set. Add it to your .env file and restart.');
    }
  })
  .catch(() => {});

// ---- File selection helpers ----
function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function setFile(file) {
  if (!file) return;
  const ext = extOf(file.name);
  const isImage = file.type && file.type.startsWith('image/');
  if (!ALLOWED_EXT.includes(ext) && !isImage) {
    showError(`"${file.name}" is not a supported type. Use PDF, DOCX, TXT, or an image.`);
    return;
  }
  hideError();
  selectedFile = file;
  chipExt.textContent = (ext || 'file').toUpperCase();
  chipName.textContent = file.name;
  dzPrompt.hidden = true;
  fileChip.hidden = false;
  dropzone.classList.add('has-file');
  submitBtn.disabled = false;
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  dzPrompt.hidden = false;
  fileChip.hidden = true;
  dropzone.classList.remove('has-file');
  submitBtn.disabled = true;
}

// ---- Dropzone interactions ----
dropzone.addEventListener('click', () => {
  if (!selectedFile) fileInput.click();
});
dropzone.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !selectedFile) {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) setFile(fileInput.files[0]);
});
chipRemove.addEventListener('click', (e) => {
  e.stopPropagation();
  clearFile();
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  }),
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === 'dragleave' && dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove('dragging');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) setFile(file);
});

// ---- Submit ----
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedFile) return;

  hideError();
  results.hidden = true;
  setLoading(true, selectedFile);
  submitBtn.disabled = true;

  const body = new FormData();
  body.append('file', selectedFile);
  const n = parseInt(numQuestions.value, 10);
  if (Number.isFinite(n)) body.append('numQuestions', String(n));

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Server returned an unexpected response (${res.status}).`);
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    renderResults(data);
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
    submitBtn.disabled = !selectedFile;
  }
});

// ---- Loading state with honest, rotating status ----
function setLoading(on, file) {
  clearInterval(loadingTimer);
  loadingBox.hidden = !on;
  if (!on) return;

  const isImage = file && file.type && file.type.startsWith('image/');
  const steps = isImage
    ? ['Running OCR on your image…', 'Reading the recognized text…', 'Writing your summary & questions…']
    : ['Reading your file…', 'Extracting the text…', 'Writing your summary & questions…'];

  loadingSub.textContent = isImage
    ? 'OCR can take a little longer on the first run.'
    : 'This usually takes a few seconds.';

  let i = 0;
  loadingMsg.textContent = steps[0];
  loadingTimer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    loadingMsg.textContent = steps[i];
  }, 2200);
}

// ---- Error helpers ----
function showError(msg) {
  errorMsg.textContent = msg;
  errorBox.hidden = false;
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideError() {
  errorBox.hidden = true;
}

// ---- Render results ----
function renderResults(data) {
  // Meta tags
  resultsMeta.innerHTML = '';
  const tags = [];
  if (data.fileName) tags.push({ text: data.fileName });
  tags.push({ text: `${data.questions.length} question${data.questions.length === 1 ? '' : 's'}` });
  tags.push({ text: `${data.charCount.toLocaleString()} chars` });
  if (data.truncated) tags.push({ text: 'truncated for AI', warn: true });
  for (const t of tags) {
    const span = document.createElement('span');
    span.className = 'tag' + (t.warn ? ' warn' : '');
    span.textContent = t.text;
    resultsMeta.appendChild(span);
  }

  summaryText.textContent = data.summary || 'No summary was produced.';

  lastQuestions = data.questions;
  buildQuiz(lastQuestions);

  // Preview
  previewText.textContent = data.preview || '';
  if (data.previewTruncated) {
    previewNote.textContent = 'Preview truncated — the full text was used for analysis where it fit the limit.';
    previewNote.hidden = false;
  } else {
    previewNote.hidden = true;
  }
  previewBody.hidden = true;
  previewToggle.setAttribute('aria-expanded', 'false');

  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Quiz building & interaction ----
function buildQuiz(questions) {
  quizList.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  questions.forEach((q, qi) => {
    const li = document.createElement('li');
    li.className = 'q';

    const stem = document.createElement('div');
    stem.className = 'q-stem';
    stem.innerHTML = `<span class="q-num">${String(qi + 1).padStart(2, '0')}</span><span>${escapeHtml(q.question)}</span>`;
    li.appendChild(stem);

    const opts = document.createElement('div');
    opts.className = 'opts';

    q.options.forEach((optText, oi) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt';
      btn.innerHTML =
        `<span class="opt-key">${letters[oi]}</span>` +
        `<span class="opt-text">${escapeHtml(optText)}</span>` +
        `<span class="opt-mark" aria-hidden="true"></span>`;
      btn.addEventListener('click', () => answer(li, q, oi));
      opts.appendChild(btn);
    });

    li.appendChild(opts);
    quizList.appendChild(li);
  });

  updateScore();
}

function answer(li, q, chosen) {
  if (li.dataset.answered === 'true') return;
  li.dataset.answered = 'true';
  li.dataset.correct = chosen === q.correctIndex ? 'true' : 'false';

  const buttons = li.querySelectorAll('.opt');
  buttons.forEach((b, i) => {
    b.disabled = true;
    const mark = b.querySelector('.opt-mark');
    if (i === q.correctIndex) {
      b.classList.add('correct');
      mark.textContent = '✓';
    } else if (i === chosen) {
      b.classList.add('incorrect');
      mark.textContent = '✕';
    }
  });

  if (q.explanation) {
    const ex = document.createElement('p');
    ex.className = 'q-explain';
    ex.innerHTML = `<b>Why</b>${escapeHtml(q.explanation)}`;
    li.appendChild(ex);
  }

  updateScore();
}

function updateScore() {
  const total = lastQuestions.length;
  const answered = quizList.querySelectorAll('.q[data-answered="true"]').length;
  const correct = quizList.querySelectorAll('.q[data-correct="true"]').length;
  scorePill.textContent = answered === 0 ? `0 / ${total}` : `${correct} / ${answered}`;
}

resetQuizBtn.addEventListener('click', () => {
  buildQuiz(lastQuestions);
  quizList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// ---- Preview toggle ----
previewToggle.addEventListener('click', () => {
  const open = previewBody.hidden;
  previewBody.hidden = !open;
  previewToggle.setAttribute('aria-expanded', String(open));
});

// ---- Reset everything ----
againBtn.addEventListener('click', () => {
  clearFile();
  results.hidden = true;
  hideError();
  numQuestions.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---- Util ----
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
