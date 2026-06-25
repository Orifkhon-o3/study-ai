'use strict';

const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// JSON Schema for OpenAI Structured Outputs (strict mode).
// strict mode rules: every property must be listed in `required`,
// and every object must set `additionalProperties: false`.
const STUDY_KIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description: 'A concise, self-contained summary of the document (roughly 3-6 sentences).',
    },
    questions: {
      type: 'array',
      description: 'Multiple-choice questions derived strictly from the document.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string', description: 'The question stem.' },
          options: {
            type: 'array',
            description: 'Exactly four answer options.',
            items: { type: 'string' },
          },
          correctIndex: {
            type: 'integer',
            description: 'Zero-based index (0-3) of the correct option in `options`.',
          },
          explanation: {
            type: 'string',
            description: 'One short sentence explaining why the correct option is right.',
          },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['summary', 'questions'],
};

let client;
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw withStatus('Server is missing the OPENAI_API_KEY environment variable.', 500);
  }
  // The SDK reads OPENAI_API_KEY from the environment automatically.
  if (!client) client = new OpenAI();
  return client;
}

/**
 * Ask the model for a summary + `numQuestions` MCQs, returned as validated JSON.
 */
async function generateStudyKit(text, numQuestions) {
  const openai = getClient();

  const system =
    'You are Study AI, an assistant that turns study material into a concise summary and ' +
    'high-quality multiple-choice questions. Work ONLY from the supplied text and never invent ' +
    'facts it does not contain. Every question must have exactly four options with exactly one ' +
    'correct answer. Make distractors plausible but clearly incorrect to someone who understood ' +
    'the material, and vary which option position is correct across questions.';

  const user =
    `Write a concise summary and exactly ${numQuestions} multiple-choice question(s) based on the ` +
    `study material below.\n\n--- STUDY MATERIAL START ---\n${text}\n--- STUDY MATERIAL END ---`;

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'study_kit', strict: true, schema: STUDY_KIT_SCHEMA },
      },
    });
  } catch (e) {
    const status = e && e.status >= 400 && e.status < 500 ? e.status : 502;
    throw withStatus(friendlyOpenAIError(e), status);
  }

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw withStatus('The AI returned an empty response. Please try again.', 502);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw withStatus('The AI returned malformed data. Please try again.', 502);
  }

  return {
    summary: (parsed.summary || '').trim(),
    questions: sanitizeQuestions(parsed.questions, numQuestions),
    model: MODEL,
  };
}

/** Keep only well-formed questions (4 non-empty options + valid correctIndex). */
function sanitizeQuestions(questions, requested) {
  if (!Array.isArray(questions)) return [];
  return questions
    .filter(
      (q) =>
        q &&
        typeof q.question === 'string' &&
        q.question.trim().length > 0 &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        q.options.every((o) => typeof o === 'string' && o.trim().length > 0) &&
        Number.isInteger(q.correctIndex) &&
        q.correctIndex >= 0 &&
        q.correctIndex <= 3,
    )
    .map((q) => ({
      question: q.question.trim(),
      options: q.options.map((o) => o.trim()),
      correctIndex: q.correctIndex,
      explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '',
    }))
    .slice(0, requested);
}

function friendlyOpenAIError(e) {
  const status = e && e.status;
  if (status === 401) return 'OpenAI rejected the API key (401). Check that OPENAI_API_KEY is valid.';
  if (status === 403) return 'OpenAI denied access (403). Your key may not have access to this model.';
  if (status === 404) return `OpenAI could not find the model "${MODEL}" (404). Check OPENAI_MODEL.`;
  if (status === 429) return 'OpenAI rate limit or quota reached (429). Wait a moment and try again.';
  if (status === 400) return `OpenAI rejected the request (400): ${e?.message || 'bad request'}.`;
  if (e?.name === 'APIConnectionTimeoutError') return 'OpenAI request timed out. Please try again.';
  if (e?.name === 'APIConnectionError') return 'Could not reach OpenAI. Check your connection and try again.';
  return `OpenAI request failed: ${e?.message || 'unknown error'}.`;
}

function withStatus(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

module.exports = { generateStudyKit, MODEL };
