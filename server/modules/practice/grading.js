function htmlToText(html) {
  return String(html || "")
    .replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, "\"")
    .replace(/&rdquo;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsToMathAnswer(value) {
  return String(value || "")
    .replace(/\bthe fraction\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+over\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\b/gi, "$1/$2")
    .replace(/\b(-?(?:\d+(?:\.\d*)?|\.\d+))\s+over\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\b/gi, "$1/$2")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(half|halves|thirds?|fourths?|quarters?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|elevenths?|twelfths?)\b/gi, (_, numerator, denominator) => {
      const numerators = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
      };
      const denominators = {
        half: 2, halves: 2, third: 3, thirds: 3, fourth: 4, fourths: 4,
        quarter: 4, quarters: 4, fifth: 5, fifths: 5, sixth: 6, sixths: 6,
        seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9,
        tenth: 10, tenths: 10, eleventh: 11, elevenths: 11, twelfth: 12, twelfths: 12
      };
      return `${numerators[numerator.toLowerCase()]}/${denominators[denominator.toLowerCase()]}`;
    })
    .replace(/\beither\b/gi, " ")
    .replace(/\bor\b/gi, " ")
    .trim();
}

function cleanCorrectAnswer(value) {
  return wordsToMathAnswer(value)
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/g, "")
    .trim();
}

export function deriveLegacyCorrectAnswers(answer) {
  const explicit = answer?.correct_choice || answer?.correctChoice || answer?.correct_answer || answer?.correctAnswer;
  if (Array.isArray(explicit)) return explicit.map(cleanCorrectAnswer).filter(Boolean);
  if (explicit) return [cleanCorrectAnswer(explicit).toUpperCase()].filter(Boolean);

  const rationale = htmlToText(answer?.rationale);
  const choiceMatch = rationale.match(/\bChoice\s+([A-D])\s+is\s+correct\b/i);
  if (choiceMatch) return [choiceMatch[1].toUpperCase()];

  const sprMatch = rationale.match(/\bThe\s+correct\s+answer\s+is\s+(.+?)(?:\.\s+[A-Z]|$)/i);
  if (!sprMatch) return [];
  return sprMatch[1]
    .split(/\s+or\s+|,\s*/i)
    .map(cleanCorrectAnswer)
    .filter(Boolean);
}

function normalizeAnswer(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseNumericAnswer(value) {
  const normalized = normalizeAnswer(value).replaceAll(",", "");
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return Number(normalized);
  const fraction = normalized.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\/([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
  if (!fraction) return null;
  const numerator = Number(fraction[1]);
  const denominator = Number(fraction[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function decimalEntryMatches(normalizedAnswer, answerNumber, candidateNumber) {
  const decimalMatch = normalizedAnswer.match(/^[+-]?(?:\d*)\.(\d+)$/);
  if (!decimalMatch || decimalMatch[1].length < 3) return false;
  const places = decimalMatch[1].length;
  const factor = 10 ** places;
  const truncated = candidateNumber < 0
    ? Math.ceil(candidateNumber * factor) / factor
    : Math.floor(candidateNumber * factor) / factor;
  const rounded = Math.round(candidateNumber * factor) / factor;
  return Math.abs(answerNumber - truncated) < 1e-9 || Math.abs(answerNumber - rounded) < 1e-9;
}

export function answersMatch(answer, candidate) {
  const normalizedAnswer = normalizeAnswer(answer);
  const normalizedCandidate = normalizeAnswer(cleanCorrectAnswer(candidate));
  if (normalizedAnswer === normalizedCandidate) return true;

  const answerNumber = parseNumericAnswer(normalizedAnswer);
  const candidateNumber = parseNumericAnswer(normalizedCandidate);
  if (answerNumber === null || candidateNumber === null) return false;
  if (Math.abs(answerNumber - candidateNumber) < 1e-9) return true;
  return decimalEntryMatches(normalizedAnswer, answerNumber, candidateNumber);
}

function deriveCorrectAnswersFromRationale(rationale) {
  const text = htmlToText(rationale);
  const sprMatch = text.match(/\bThe\s+correct\s+answer\s+is\s+(.+?)(?:\.\s+[A-Z]|$)/i);
  if (!sprMatch) return [];
  return sprMatch[1]
    .split(/\s+or\s+|,\s*/i)
    .map(cleanCorrectAnswer)
    .filter(Boolean);
}

export function correctAnswersForContent(content) {
  const answers = [
    ...(Array.isArray(content?.correct_answer) ? content.correct_answer : []),
    ...deriveCorrectAnswersFromRationale(content?.rationale)
  ]
    .map(cleanCorrectAnswer)
    .filter((answer) => answer && !/^(?:either|or)$/i.test(answer));
  return [...new Set(answers)];
}

export function gradeAnswer(content, answer) {
  if (!answer || !String(answer).trim()) return { status: "skipped", isCorrect: null };
  const isCorrect = correctAnswersForContent(content).some((candidate) => answersMatch(answer, candidate));
  return { status: isCorrect ? "correct" : "incorrect", isCorrect };
}

export function normalizeContentCorrectAnswers(content) {
  return { ...content, correct_answer: correctAnswersForContent(content) };
}
