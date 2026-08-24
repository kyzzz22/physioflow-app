import { createId } from './ids.js';

export const QUESTION_TYPES = ['likert', 'single_choice', 'multiple_choice', 'vas_slider', 'sam_valence', 'sam_arousal', 'number', 'short_text', 'long_text'];
export const COMPARISON_OPS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than'];
export const LANGS = [['zh', '中文'], ['ja', '日本語'], ['en', 'English']];

export const newQuestion = () => ({
  question_id: createId('question'), type: 'likert', required: true,
  prompt_i18n: { zh: '请评价', ja: '評価してください', en: 'Please rate' },
  options_i18n: { zh: ['选项 1', '选项 2'], ja: ['選択肢 1', '選択肢 2'], en: ['Option 1', 'Option 2'] },
  scale_min: 1, scale_max: 5,
  min_label_i18n: { zh: '非常不同意', ja: '全く同意しない', en: 'Strongly disagree' },
  max_label_i18n: { zh: '非常同意', ja: '強く同意する', en: 'Strongly agree' },
  correct_answer: '', show_if: null, shuffle: false, time_limit_sec: null,
});

export function createQuestionnaire() { return { questionnaire_id: createId('questionnaire'), name: 'Questionnaire', questions: [newQuestion()], shuffle_questions: false, show_progress: true }; }

function issue(code, message, path) { return { code, message, path }; }

export function validateQuestionnaire(questionnaire) {
  const errors = [];
  const warnings = [];
  if (!questionnaire || typeof questionnaire !== 'object') return { valid: false, errors: [issue('questionnaire.missing', 'Questionnaire configuration is required', '')], warnings };
  if (!questionnaire.questionnaire_id?.trim()) errors.push(issue('questionnaire.id_missing', 'Questionnaire needs an ID', 'questionnaire_id'));
  if (!questionnaire.name?.trim()) errors.push(issue('questionnaire.name_missing', 'Questionnaire needs a name', 'name'));
  if (!Array.isArray(questionnaire.questions) || questionnaire.questions.length === 0) errors.push(issue('questionnaire.questions_empty', 'Questionnaire needs at least one question', 'questions'));
  const ids = new Set();
  const questions = Array.isArray(questionnaire.questions) ? questionnaire.questions : [];
  for (const [index, question] of questions.entries()) {
    const path = `questions.${index}`;
    if (!question?.question_id?.trim()) errors.push(issue('questionnaire.question_id_missing', `Question ${index + 1} needs an ID`, `${path}.question_id`));
    else if (ids.has(question.question_id)) errors.push(issue('questionnaire.question_id_duplicate', `Duplicate question ID ${question.question_id}`, `${path}.question_id`));
    else ids.add(question.question_id);
    if (!QUESTION_TYPES.includes(question?.type)) errors.push(issue('questionnaire.type_invalid', `Question ${index + 1} has unsupported type ${question?.type || '(missing)'}`, `${path}.type`));
    if (!Object.values(question?.prompt_i18n || {}).some(value => String(value || '').trim())) errors.push(issue('questionnaire.prompt_missing', `Question ${index + 1} needs a prompt`, `${path}.prompt_i18n`));
    if (['single_choice', 'multiple_choice'].includes(question?.type)) {
      const optionLists = Object.values(question.options_i18n || {}).filter(Array.isArray);
      if (!optionLists.some(options => options.filter(option => String(option).trim()).length >= 2)) errors.push(issue('questionnaire.options_missing', `Question ${index + 1} needs at least two options`, `${path}.options_i18n`));
      if (optionLists.some(options => new Set(options.map(option => String(option).trim()).filter(Boolean)).size !== options.map(option => String(option).trim()).filter(Boolean).length)) errors.push(issue('questionnaire.options_duplicate', `Question ${index + 1} has duplicate options`, `${path}.options_i18n`));
    }
    if (question?.scale_min !== undefined || question?.scale_max !== undefined || ['likert', 'sam_valence', 'sam_arousal', 'number', 'vas_slider'].includes(question?.type)) {
      const min = Number(question.scale_min), max = Number(question.scale_max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) errors.push(issue('questionnaire.scale_invalid', `Question ${index + 1} maximum must be greater than minimum`, `${path}.scale_max`));
      if (['likert', 'sam_valence', 'sam_arousal'].includes(question?.type) && Number.isFinite(min) && Number.isFinite(max) && (!Number.isInteger(min) || !Number.isInteger(max) || max - min > 20)) errors.push(issue('questionnaire.discrete_scale_invalid', `Question ${index + 1} needs an integer scale of at most 21 values`, `${path}.scale_max`));
    }
    if (question?.time_limit_sec !== null && question?.time_limit_sec !== undefined && (!Number.isFinite(Number(question.time_limit_sec)) || Number(question.time_limit_sec) <= 0)) errors.push(issue('questionnaire.time_limit_invalid', `Question ${index + 1} time limit must be positive`, `${path}.time_limit_sec`));
    if (question?.show_if?.question_id && !questions.some(candidate => candidate.question_id === question.show_if.question_id)) errors.push(issue('questionnaire.condition_target_missing', `Question ${index + 1} condition references a missing question`, `${path}.show_if.question_id`));
    if (question?.show_if?.question_id && questions.findIndex(candidate => candidate.question_id === question.show_if.question_id) >= index) errors.push(issue('questionnaire.condition_order_invalid', `Question ${index + 1} condition must reference an earlier question`, `${path}.show_if.question_id`));
    if (question?.show_if && !COMPARISON_OPS.includes(question.show_if.operator || 'equals')) errors.push(issue('questionnaire.condition_operator_invalid', `Question ${index + 1} has an unsupported condition operator`, `${path}.show_if.operator`));
    if (question?.shuffle && !['single_choice', 'multiple_choice'].includes(question.type)) warnings.push(issue('questionnaire.shuffle_ignored', `Question ${index + 1} option shuffle only applies to choice questions`, `${path}.shuffle`));
  }
  if (questionnaire.shuffle_questions && questions.some(question => question.show_if?.question_id)) errors.push(issue('questionnaire.shuffle_condition_conflict', 'Question shuffling cannot be combined with conditional display', 'shuffle_questions'));
  return { valid: errors.length === 0, errors, warnings };
}

export function questionnaireScore(questionnaire, answers = {}) {
  const scored = (questionnaire?.questions || []).filter(question => question.correct_answer !== undefined && question.correct_answer !== null && String(question.correct_answer) !== '');
  const correct = scored.filter(question => {
    const actual = answers[question.question_id];
    const expected = question.correct_answer;
    if (Array.isArray(actual)) return [...actual].map(String).sort().join('\u0000') === String(expected).split('|').map(value => value.trim()).sort().join('\u0000');
    return String(actual ?? '') === String(expected);
  }).length;
  return { correct, total: scored.length, pct: scored.length ? Math.round((correct / scored.length) * 100) : null };
}

export function seededShuffle(items, seed = '') {
  let state = 2166136261;
  for (const character of String(seed)) { state ^= character.charCodeAt(0); state = Math.imul(state, 16777619); }
  const random = () => { state = (Math.imul(1664525, state >>> 0) + 1013904223) >>> 0; return state / 4294967296; };
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function csvRows(text) {
  const source = String(text);
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  if (quoted) throw new Error('CSV contains an unclosed quoted field');
  return rows;
}

export function parseQuestionnaireCsv(text, idFactory = createId) {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => header.trim().toLowerCase());
  return rows.slice(1).map((values, index) => {
    const row = Object.fromEntries(headers.map((header, cell) => [header, String(values[cell] || '').trim()]));
    const type = row.type || 'likert';
    if (!QUESTION_TYPES.includes(type)) throw new Error(`CSV row ${index + 2} has unsupported type ${type}`);
    const question = {
      ...newQuestion(), question_id: idFactory('question'), type, required: ['true', '1', 'yes'].includes(String(row.required || '').toLowerCase()),
      prompt_i18n: { zh: row.zh || row.en || '', ja: row.ja || row.en || '', en: row.en || row.zh || row.ja || '' }, correct_answer: row.answer || '',
    };
    if (row.options) question.options_i18n = { zh: row.options.split('|').map(item => item.trim()), ja: row.options.split('|').map(item => item.trim()), en: row.options.split('|').map(item => item.trim()) };
    if (row.min !== undefined && row.min !== '') question.scale_min = Number(row.min);
    if (row.max !== undefined && row.max !== '') question.scale_max = Number(row.max);
    if (row.time_limit_sec !== undefined && row.time_limit_sec !== '') question.time_limit_sec = Number(row.time_limit_sec);
    return question;
  });
}

export const PRESETS = {
  sam_valence: () => ({ question_id: createId('question'), type: 'sam_valence', required: true, prompt_i18n: { zh: '此刻您的愉悦程度如何？', ja: '現在の快・不快の程度を教えてください。', en: 'How pleasant do you feel right now?' }, scale_min: 1, scale_max: 9 }),
  sam_arousal: () => ({ question_id: createId('question'), type: 'sam_arousal', required: true, prompt_i18n: { zh: '此刻您的唤醒程度如何？', ja: '現在の覚醒度を教えてください。', en: 'How aroused do you feel right now?' }, scale_min: 1, scale_max: 9 }),
  likert5: () => ({ question_id: createId('question'), type: 'likert', required: true, prompt_i18n: { zh: '请评价', ja: '評価してください', en: 'Please rate' }, scale_min: 1, scale_max: 5, min_label_i18n: { zh: '非常不同意', ja: '全く同意しない', en: 'Strongly disagree' }, max_label_i18n: { zh: '非常同意', ja: '強く同意する', en: 'Strongly agree' } }),
  likert7: () => ({ question_id: createId('question'), type: 'likert', required: true, prompt_i18n: { zh: '请评价', ja: '評価してください', en: 'Please rate' }, scale_min: 1, scale_max: 7 }),
  nps: () => ({ question_id: createId('question'), type: 'likert', required: true, prompt_i18n: { zh: '您向朋友推荐的可能性有多大？', ja: '友人に勧める可能性はどのくらいですか？', en: 'How likely are you to recommend to a friend?' }, scale_min: 0, scale_max: 10, min_label_i18n: { zh: '完全不可能', ja: '全く勧めない', en: 'Not at all likely' }, max_label_i18n: { zh: '非常可能', ja: '非常に勧める', en: 'Extremely likely' } }),
  vas: () => ({ question_id: createId('question'), type: 'vas_slider', required: true, prompt_i18n: { zh: '请拖动滑块', ja: 'スライダーを動かしてください', en: 'Drag the slider' }, scale_min: 0, scale_max: 100, min_label_i18n: { zh: '最低', ja: '最低', en: 'Lowest' }, max_label_i18n: { zh: '最高', ja: '最高', en: 'Highest' } }),
  single: () => ({ question_id: createId('question'), type: 'single_choice', required: true, prompt_i18n: { zh: '请选择', ja: '選択してください', en: 'Choose one' }, options_i18n: { zh: ['选项1', '选项2', '选项3'], ja: ['選択肢1', '選択肢2', '選択肢3'], en: ['Option 1', 'Option 2', 'Option 3'] } }),
  multiple: () => ({ question_id: createId('question'), type: 'multiple_choice', required: true, prompt_i18n: { zh: '请选择（可多选）', ja: '選択してください（複数可）', en: 'Choose (multiple allowed)' }, options_i18n: { zh: ['选项1', '选项2'], ja: ['選択肢1', '選択肢2'], en: ['Option 1', 'Option 2'] } }),
  short: () => ({ question_id: createId('question'), type: 'short_text', required: false, prompt_i18n: { zh: '请输入', ja: '入力してください', en: 'Please enter' } }),
  long: () => ({ question_id: createId('question'), type: 'long_text', required: false, prompt_i18n: { zh: '请详细描述', ja: '詳しく記述してください', en: 'Please describe in detail' } }),
  number: () => ({ question_id: createId('question'), type: 'number', required: true, prompt_i18n: { zh: '请输入数字', ja: '数値を入力してください', en: 'Enter a number' }, scale_min: 0, scale_max: 100 }),
};

/** Upsert a questionnaire into a project questionnaire library (pure). */
export function saveQuestionnaireToLibrary(library, questionnaire) {
  const next = (library || []).filter(item => item.questionnaire_id !== questionnaire.questionnaire_id);
  return [...next, structuredClone(questionnaire)];
}

/** Remove a questionnaire from the project library by id (pure). */
export function removeQuestionnaireFromLibrary(library, questionnaireId) {
  return (library || []).filter(item => item.questionnaire_id !== questionnaireId);
}
