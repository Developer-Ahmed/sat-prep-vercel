const app = document.querySelector("#app");

const subjects = {
  math: {
    key: "math",
    title: "SAT Math Practice",
    label: "SAT Math",
    shortLabel: "Math",
    route: "/",
    rowLabel: "SAT Math Rows",
    defaultCount: 22,
    defaultMinutes: 35,
    supportsRealistic: true,
    supportsSection: true,
    referenceSheet: true
  },
  english: {
    key: "english",
    title: "SAT Reading & Writing Practice",
    label: "SAT Reading & Writing",
    shortLabel: "English",
    route: "/english",
    rowLabel: "SAT Reading & Writing Rows",
    defaultCount: 27,
    defaultMinutes: 32,
    supportsRealistic: true,
    supportsSection: true,
    referenceSheet: false
  }
};

const topTabs = [
  { key: "math", label: "Math", route: "/" },
  { key: "english", label: "English", route: "/english" },
  { key: "new", label: "New Questions", route: "/new" },
  { key: "vocab", label: "Vocab", route: "/vocab" }
];

function initialPool() {
  return window.location.pathname.startsWith("/new") ? "new" : "main";
}

function initialSubject() {
  if (window.location.pathname.startsWith("/english")) return "english";
  if (window.location.pathname.startsWith("/new")) {
    return new URLSearchParams(window.location.search).get("subject") === "english" ? "english" : "math";
  }
  return "math";
}

const state = {
  subject: initialSubject(),
  pool: initialPool(),
  status: null,
  cacheJob: null,
  module: null,
  currentIndex: 0,
  currentDetail: null,
  loading: false,
  busyMessage: "",
  error: "",
  reviewOpen: false,
  resultsOpen: false,
  modules: [],
  reviewHideAnswers: false,
  autoSubmitting: false,
  reviewAttempts: {},
  referenceOpen: false,
  answerSaveTimers: {},
  questionStartedAt: null,
  activeTimePassIndex: null,
  localTimeSpent: {},
  localTimeSegments: {},
  eliminatedAnswers: {},
  showCategoryBreakdown: localStorage.getItem("showCategoryBreakdown") !== "false",
  importSource: "collegeboard",
  moduleOptions: {
    mode: "random",
    count: subjects[initialSubject()].defaultCount,
    durationMinutes: subjects[initialSubject()].defaultMinutes,
    includeAnswered: false
  }
};

function currentSubject() {
  return subjects[state.subject] || subjects.math;
}

function subjectPath(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}subject=${encodeURIComponent(state.subject)}&pool=${encodeURIComponent(state.pool)}`;
}

async function parseApiResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`The server returned ${response.status || "an error"} instead of SAT data. Check the deployment's API configuration.`);
  }
  if (!response.ok || !data.success) throw new Error(data.error || `Request failed (${response.status}).`);
  return data.data;
}

const api = {
  async get(path) {
    const res = await fetch(subjectPath(path));
    return parseApiResponse(res);
  },
  async post(path, body = {}) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, subject: state.subject, pool: state.pool })
    });
    return parseApiResponse(res);
  }
};

function resetTimeTracking() {
  state.questionStartedAt = null;
  state.activeTimePassIndex = null;
  state.localTimeSpent = {};
  state.localTimeSegments = {};
}

function clearPendingAnswerSaves() {
  for (const timer of Object.values(state.answerSaveTimers)) clearTimeout(timer);
  state.answerSaveTimers = {};
}

function setBusy(message) {
  state.loading = Boolean(message);
  state.busyMessage = message || "";
  render();
}

function setError(error) {
  state.error = error ? String(error.message || error) : "";
  render();
}

async function loadStatus() {
  state.status = await api.get("/api/status");
  state.importSource = "collegeboard";
  state.modules = await api.get("/api/modules");
  state.cacheJob = await api.get("/api/cache-status");
}

async function loadCacheStatus() {
  state.cacheJob = await api.get("/api/cache-status");
}

async function importQuestions() {
  setError("");
  setBusy(state.pool === "new" ? `Checking for new ${currentSubject().shortLabel} questions` : `Importing ${currentSubject().label} questions`);
  try {
    clearPendingAnswerSaves();
    state.status = await api.post(state.pool === "new" ? "/api/import-new" : "/api/import", { source: "collegeboard" });
    state.importSource = "collegeboard";
    state.modules = [];
    state.module = null;
    state.currentDetail = null;
    state.referenceOpen = false;
    resetTimeTracking();
    state.eliminatedAnswers = {};
  } catch (error) {
    setError(error);
  } finally {
    setBusy("");
  }
}

async function cacheAllQuestions() {
  setError("");
  try {
    state.cacheJob = await api.post("/api/cache-all");
    await loadStatus();
    render();
  } catch (error) {
    setError(error);
  }
}

async function createModule() {
  setError("");
  setBusy("Creating module");
  try {
    clearPendingAnswerSaves();
    const subject = currentSubject();
    const lockedSatMode =
      (state.pool === "new" && state.moduleOptions.mode === "adaptive") ||
      (state.pool === "main" && subject.supportsRealistic && (state.moduleOptions.mode === "realistic" || state.moduleOptions.mode === "section"));
    const options = lockedSatMode
      ? {
          mode: state.moduleOptions.mode,
          count: subject.defaultCount,
          durationMinutes: subject.defaultMinutes,
          includeAnswered: false
        }
      : state.moduleOptions;
    state.module = await api.post("/api/modules", options);
    state.currentIndex = 0;
    state.currentDetail = null;
    state.reviewOpen = false;
    state.resultsOpen = false;
    state.referenceOpen = false;
    state.reviewHideAnswers = false;
    state.autoSubmitting = false;
    state.reviewAttempts = {};
    resetTimeTracking();
    state.eliminatedAnswers = {};
    await loadCurrentQuestion();
  } catch (error) {
    setError(error);
  } finally {
    setBusy("");
  }
}

async function createReviewModule(mode) {
  setError("");
  setBusy(mode === "incorrect" ? "Creating incorrect review" : "Creating flagged review");
  try {
    clearPendingAnswerSaves();
    state.module = await api.post("/api/review-modules", {
      mode,
      count: state.moduleOptions.count || currentSubject().defaultCount,
      durationMinutes: 0
    });
    state.currentIndex = 0;
    state.currentDetail = null;
    state.reviewOpen = false;
    state.resultsOpen = false;
    state.referenceOpen = false;
    state.reviewHideAnswers = true;
    state.autoSubmitting = false;
    state.reviewAttempts = {};
    resetTimeTracking();
    state.eliminatedAnswers = {};
    await loadCurrentQuestion();
  } catch (error) {
    setError(error);
  } finally {
    setBusy("");
  }
}

async function openModule(moduleId) {
  setError("");
  setBusy("Opening test");
  try {
    clearPendingAnswerSaves();
    state.module = await api.get(`/api/modules/${moduleId}`);
    state.currentIndex = 0;
    state.currentDetail = null;
    state.reviewOpen = false;
    state.resultsOpen = false;
    state.referenceOpen = false;
    state.reviewHideAnswers = Boolean(state.module.submitted_at);
    state.autoSubmitting = false;
    state.reviewAttempts = {};
    resetTimeTracking();
    state.eliminatedAnswers = {};
    await loadCurrentQuestion();
  } catch (error) {
    setError(error);
  } finally {
    setBusy("");
  }
}

async function loadCurrentQuestion() {
  if (!state.module) return;
  const row = state.module.questions[state.currentIndex];
  if (!row) return;
  state.currentDetail = null;
  state.questionStartedAt = null;
  state.activeTimePassIndex = null;
  render();
  try {
    state.currentDetail = await api.get(`/api/questions/${encodeURIComponent(row.row_id)}`);
  } catch (error) {
    setError(error);
  }
  startCurrentQuestionTimer();
  render();
}

async function reloadModule() {
  if (!state.module) return;
  state.module = await api.get(`/api/modules/${state.module.id}`);
}

function currentQuestion() {
  return state.module?.questions[state.currentIndex] || null;
}

function isReviewMode() {
  return Boolean(state.module?.submitted_at) || Boolean(state.module?.kind?.startsWith("review_"));
}

function shouldTrackQuestionTime() {
  return Boolean(state.module?.kind === "practice" && !state.module.submitted_at && currentQuestion());
}

function startCurrentQuestionTimer() {
  if (!shouldTrackQuestionTime()) {
    state.questionStartedAt = null;
    state.activeTimePassIndex = null;
    return;
  }
  const row = currentQuestion();
  state.activeTimePassIndex = nextTimePassIndex(row);
  state.questionStartedAt = Date.now();
}

function savedTimeFor(row) {
  if (!row) return 0;
  if (Object.hasOwn(state.localTimeSpent, row.row_id)) return state.localTimeSpent[row.row_id];
  return Number(row.time_spent_seconds) || 0;
}

function timeSegmentsFor(row) {
  if (!row) return [];
  const segments = Object.hasOwn(state.localTimeSegments, row.row_id)
    ? state.localTimeSegments[row.row_id]
    : row.time_segments || [];
  return segments
    .map((segment) => ({
      pass_index: Math.max(0, Math.floor(Number(segment.pass_index) || 0)),
      seconds: Math.max(0, Math.floor(Number(segment.seconds) || 0))
    }))
    .filter((segment) => segment.pass_index > 0 && segment.seconds > 0)
    .sort((a, b) => a.pass_index - b.pass_index);
}

function nextTimePassIndex(row) {
  const segments = timeSegmentsFor(row);
  return segments.reduce((max, segment) => Math.max(max, segment.pass_index), 0) + 1;
}

function addLocalTimeSegment(row, passIndex, elapsed) {
  if (!row || !passIndex || elapsed <= 0) return;
  const segments = timeSegmentsFor(row).map((segment) => ({ ...segment }));
  const existing = segments.find((segment) => segment.pass_index === passIndex);
  if (existing) {
    existing.seconds += elapsed;
  } else {
    segments.push({ pass_index: passIndex, seconds: elapsed });
  }
  segments.sort((a, b) => a.pass_index - b.pass_index);
  state.localTimeSegments[row.row_id] = segments;
  row.time_segments = segments;
}

function displayTimeFor(row) {
  const base = savedTimeFor(row);
  if (row === currentQuestion() && state.questionStartedAt) {
    return base + Math.max(0, Math.floor((Date.now() - state.questionStartedAt) / 1000));
  }
  return base;
}

async function flushCurrentTime({ restart = true } = {}) {
  if (!shouldTrackQuestionTime() || !state.questionStartedAt) return;
  const row = currentQuestion();
  const elapsed = Math.max(0, Math.floor((Date.now() - state.questionStartedAt) / 1000));
  const total = savedTimeFor(row) + elapsed;
  const passIndex = state.activeTimePassIndex || nextTimePassIndex(row);
  state.localTimeSpent[row.row_id] = total;
  row.time_spent_seconds = total;
  addLocalTimeSegment(row, passIndex, elapsed);
  state.questionStartedAt = restart && shouldTrackQuestionTime() ? Date.now() : null;
  state.activeTimePassIndex = restart && shouldTrackQuestionTime() ? passIndex : null;
  try {
    await api.post(`/api/modules/${state.module.id}/time`, {
      rowId: row.row_id,
      timeSpentSeconds: total,
      passIndex,
      elapsedSeconds: elapsed
    });
  } catch (error) {
    console.warn(error);
  }
}

function isIncorrectReviewModule() {
  return state.module?.kind === "review_incorrect";
}

function answerFor(rowId) {
  if (isReviewMode()) {
    if (Object.hasOwn(state.reviewAttempts, rowId)) return state.reviewAttempts[rowId];
    if (state.reviewHideAnswers) return "";
  }
  const row = state.module?.questions.find((question) => question.row_id === rowId);
  return row?.answer || "";
}

function flaggedFor(rowId) {
  const row = state.module?.questions.find((question) => question.row_id === rowId);
  return Boolean(row?.module_flagged ?? row?.flagged);
}

function eliminatedFor(rowId, choiceKey) {
  return Boolean(state.eliminatedAnswers[rowId]?.[choiceKey]);
}

function toggleEliminated(rowId, choiceKey) {
  const choices = state.eliminatedAnswers[rowId] || {};
  state.eliminatedAnswers[rowId] = {
    ...choices,
    [choiceKey]: !choices[choiceKey]
  };
  render();
}

function hasAnswerOptions(content) {
  return Boolean(content.answerOptions && Object.keys(content.answerOptions).length);
}

async function saveAnswer(rowId, answer, flagged = flaggedFor(rowId), { reload = true } = {}) {
  await api.post(`/api/modules/${state.module.id}/answers`, { rowId, answer, flagged });
  if (reload) {
    await reloadModule();
    render();
  }
}

function queueAnswerSave(rowId, answer) {
  clearTimeout(state.answerSaveTimers[rowId]);
  state.answerSaveTimers[rowId] = setTimeout(() => {
    delete state.answerSaveTimers[rowId];
    saveAnswer(rowId, answer, flaggedFor(rowId), { reload: false }).catch(setError);
  }, 300);
}

async function flushPendingAnswerSaves() {
  const pendingRowIds = Object.keys(state.answerSaveTimers);
  if (!pendingRowIds.length) return;
  clearPendingAnswerSaves();
  await Promise.all(pendingRowIds.map((rowId) => {
    const row = state.module?.questions.find((question) => question.row_id === rowId);
    return row ? saveAnswer(rowId, row.answer || "", flaggedFor(rowId), { reload: false }) : Promise.resolve();
  }));
}

async function saveFlag(rowId, flagged) {
  await api.post(`/api/modules/${state.module.id}/flag`, { rowId, flagged });
  await reloadModule();
  render();
}

async function removeCurrentIncorrectQuestion() {
  const row = currentQuestion();
  if (!row) return;
  await api.post(`/api/questions/${encodeURIComponent(row.row_id)}/clear-incorrect`);
  state.module.questions = state.module.questions.filter((question) => question.row_id !== row.row_id);
  state.module.questionIds = state.module.questionIds.filter((rowId) => rowId !== row.row_id);
      state.reviewAttempts = Object.fromEntries(
    Object.entries(state.reviewAttempts).filter(([rowId]) => rowId !== row.row_id)
  );
  delete state.eliminatedAnswers[row.row_id];
  state.currentIndex = Math.min(state.currentIndex, Math.max(0, state.module.questions.length - 1));
  state.currentDetail = null;
  await loadStatus();
  if (state.module.questions.length) {
    await loadCurrentQuestion();
  } else {
    state.module = null;
    render();
  }
}

async function setCurrentIndex(index) {
  await flushPendingAnswerSaves();
  await flushCurrentTime({ restart: false });
  state.currentIndex = Math.max(0, Math.min(index, state.module.questions.length - 1));
  state.reviewOpen = false;
  await loadCurrentQuestion();
}

async function submitModule() {
  if (state.autoSubmitting || state.module?.submitted_at) return;
  state.autoSubmitting = true;
  setError("");
  setBusy("Submitting module");
  try {
    await flushPendingAnswerSaves();
    await flushCurrentTime({ restart: false });
    const submittedModule = await api.post(`/api/modules/${state.module.id}/submit`);
    state.reviewOpen = false;
    state.reviewHideAnswers = false;
    await loadStatus();
    if (submittedModule.next_section_module_id) {
      state.module = await api.get(`/api/modules/${submittedModule.next_section_module_id}`);
      state.currentIndex = 0;
      state.currentDetail = null;
      state.resultsOpen = false;
      state.reviewAttempts = {};
      resetTimeTracking();
      state.eliminatedAnswers = {};
      await loadCurrentQuestion();
      return;
    }
    state.module = submittedModule;
    state.resultsOpen = true;
    await loadCurrentQuestion();
  } catch (error) {
    setError(error);
  } finally {
    state.autoSubmitting = false;
    setBusy("");
  }
}

async function resetProgress() {
  if (!confirm(`Reset ${currentSubject().label} progress and modules?`)) return;
  setBusy("Resetting progress");
  try {
    clearPendingAnswerSaves();
    state.status = await api.post("/api/reset-progress");
    state.modules = [];
    state.module = null;
    state.currentDetail = null;
    resetTimeTracking();
  } catch (error) {
    setError(error);
  } finally {
    setBusy("");
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatQuestionTime(row) {
  const seconds = displayTimeFor(row);
  return seconds > 0 ? formatTime(seconds) : "Not tracked";
}

function renderTimeBreakdown(row) {
  const totalSeconds = displayTimeFor(row);
  if (totalSeconds <= 0) {
    return `<p class="time-breakdown-static">Time spent: Not tracked</p>`;
  }

  const segments = timeSegmentsFor(row);
  return `
    <details class="time-breakdown">
      <summary>
        <span>Time spent</span>
        <strong>${formatTime(totalSeconds)}</strong>
      </summary>
      <div class="time-breakdown-list">
        ${segments.length
          ? segments.map((segment) => `
              <div>
                <span>Pass ${segment.pass_index}</span>
                <strong>${formatTime(segment.seconds)}</strong>
              </div>
            `).join("")
          : `<div><span>Pass breakdown was not tracked for this module.</span></div>`}
      </div>
    </details>
  `;
}

function formatDifficulty(value) {
  const labels = {
    E: "Easy",
    M: "Medium",
    H: "Hard"
  };
  return labels[String(value || "").toUpperCase()] || value || "Unknown";
}

function sanitizeFreeResponse(value) {
  const raw = String(value ?? "");
  const mixedNumber = raw.match(/^\s*-?\d+\s+\d+\s*\//);
  let text = (mixedNumber ? mixedNumber[0].trim().split(/\s+/)[0] : raw).replace(/[^0-9./-]/g, "");
  const negative = text.startsWith("-");
  text = text.replace(/-/g, "");
  if (negative) text = `-${text}`;

  const decimalIndex = text.indexOf(".");
  if (decimalIndex !== -1) {
    text = `${text.slice(0, decimalIndex + 1)}${text.slice(decimalIndex + 1).replace(/\./g, "")}`;
  }

  const slashIndex = text.indexOf("/");
  if (slashIndex !== -1) {
    text = `${text.slice(0, slashIndex + 1)}${text.slice(slashIndex + 1).replace(/\//g, "")}`;
  }

  const zeroDenominator = text.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+)?)\/0+$/);
  if (zeroDenominator) text = `${zeroDenominator[1]}/`;

  return text.slice(0, text.startsWith("-") ? 6 : 5);
}

function remainingSeconds() {
  if (!state.module?.duration_seconds) return null;
  const created = new Date(state.module.created_at).getTime();
  const elapsed = Math.floor((Date.now() - created) / 1000);
  return state.module.duration_seconds - elapsed;
}

function moduleSummary() {
  const questions = state.module?.questions || [];
  const answered = isReviewMode()
    ? questions.filter((question) => Boolean((state.reviewAttempts[question.row_id] || "").trim())).length
    : questions.filter((question) => Boolean(question.answer?.trim())).length;
  const flagged = questions.filter((question) => Boolean(question.module_flagged ?? question.flagged)).length;
  return { answered, unanswered: questions.length - answered, flagged };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeDisplayHtml(html) {
  const fenceClosers = [];
  return String(html || "")
    .replace(/<div\b(?=[^>]*\bclass=["'][^"']*\bsr-only\b[^"']*["'])(?=[^>]*\baria-label=["'][^"']*long description[^"']*["'])[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/(<span\b(?=[^>]*\baria-hidden=["']true["'])[^>]*>\s*_{2,}\s*<\/span>)\s*<span\b(?=[^>]*\bclass=["'][^"']*\bsr-only\b[^"']*["'])[^>]*>\s*blank\s*<\/span>/gi, "$1")
    .replace(/(_{2,})\s*blank\b/gi, "$1")
    .replace(/<mfenced([^>]*)>|<\/mfenced>/gi, (tag, attrs) => {
      if (tag.startsWith("</")) {
        return `</mrow><mo>${escapeHtml(fenceClosers.pop() || ")")}</mo></mrow>`;
      }
      const open = htmlAttribute(attrs, "open") || "(";
      const close = htmlAttribute(attrs, "close") || ")";
      fenceClosers.push(close);
      return `<mrow><mo>${escapeHtml(open)}</mo><mrow>`;
    });
}

function htmlAttribute(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return match?.[1] || "";
}

function statCard(label, value) {
  const displayValue = typeof value === "string" ? escapeHtml(value) : formatNumber(value);
  return `
    <div class="stat">
      <span>${label}</span>
      <strong>${displayValue}</strong>
    </div>
  `;
}

function renderSubjectTabs() {
  return `
    <nav class="subject-tabs" aria-label="SAT subject tabs">
      ${topTabs.map((tab) => `
        <a class="${tab.key === (state.pool === "new" ? "new" : state.subject) ? "active" : ""}" href="${tab.route}">
          ${escapeHtml(tab.label)}
        </a>
      `).join("")}
    </nav>
  `;
}

function renderNewSubjectSwitch() {
  if (state.pool !== "new") return "";
  return `
    <nav class="new-subject-tabs" aria-label="New question subject">
      <a class="${state.subject === "math" ? "active" : ""}" href="/new?subject=math">Math</a>
      <a class="${state.subject === "english" ? "active" : ""}" href="/new?subject=english">English</a>
    </nav>
  `;
}

function accuracyPercent(correct, answered) {
  return answered ? Math.round((correct / answered) * 100) : 0;
}

function renderPerformanceBreakdown() {
  const domains = state.status?.performanceByDomain || [];
  const buttonLabel = state.showCategoryBreakdown ? "Hide" : "Show";

  if (!state.showCategoryBreakdown) {
    return `
      <section class="analytics-panel collapsed">
        <div class="section-title">
          <div>
            <h2>Category Breakdown</h2>
            <p>Hidden for now.</p>
          </div>
          <button class="secondary analytics-toggle" data-action="toggle-category-breakdown">${buttonLabel}</button>
        </div>
      </section>
    `;
  }

  if (!domains.length) {
    return `
      <section class="analytics-panel">
        <div class="section-title">
          <div>
            <h2>Category Breakdown</h2>
            <p>Import questions to see totals by domain and category.</p>
          </div>
          <button class="secondary analytics-toggle" data-action="toggle-category-breakdown">${buttonLabel}</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="analytics-panel">
      <div class="section-title">
        <div>
          <h2>Category Breakdown</h2>
          <p>Correct out of answered, plus total available questions.</p>
        </div>
        <button class="secondary analytics-toggle" data-action="toggle-category-breakdown">${buttonLabel}</button>
      </div>
      <div class="domain-grid">
        ${domains.map((domain) => {
          const percent = accuracyPercent(domain.correct, domain.answered);
          return `
            <article class="domain-card">
              <header>
                <div>
                  <h3>${escapeHtml(domain.domain)}</h3>
                  <p>${domain.correct}/${domain.answered} correct · ${percent}% · ${domain.total} total</p>
                </div>
                <strong>${domain.total}</strong>
              </header>
              <div class="skill-list">
                ${domain.skills.map((skill) => {
                  const skillPercent = accuracyPercent(skill.correct, skill.answered);
                  return `
                    <div class="skill-row">
                      <div class="skill-row-top">
                        <span>${escapeHtml(skill.skill)}</span>
                        <strong>${skill.correct}/${skill.answered}</strong>
                      </div>
                      <div class="skill-meter" aria-label="${skillPercent}% correct">
                        <span style="width: ${skillPercent}%"></span>
                      </div>
                      <small>${skill.incorrect} incorrect · ${skill.total} total</small>
                    </div>
                  `;
                }).join("")}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderHistory() {
  if (!state.modules?.length) return "";
  return `
    <section class="history-panel">
      <div class="section-title">
        <h2>Previous Tests</h2>
      </div>
      <div class="history-list">
        ${state.modules.map((module) => `
          <button class="history-row" data-open-module="${module.id}">
            <span>
              <strong>${escapeHtml(module.title)}</strong>
              <small>${new Date(module.created_at).toLocaleString()} · ${module.submitted_at ? "Submitted" : "In progress"}</small>
            </span>
            <span class="history-stats">
              ${module.question_count} Q · ${module.correct} C · ${module.incorrect} I · ${module.flagged} F
            </span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderDashboard() {
  const status = state.status || {};
  const subject = currentSubject();
  const cache = state.cacheJob?.cache || status.contentCache || {};
  const cacheJob = state.cacheJob || {};
  const imported = status.total > 0;
  const newPool = state.pool === "new";
  const realisticMode = !newPool && subject.supportsRealistic && state.moduleOptions.mode === "realistic";
  const sectionMode = !newPool && subject.supportsSection && state.moduleOptions.mode === "section";
  const adaptiveMode = newPool && state.moduleOptions.mode === "adaptive";
  const lockedSatMode = realisticMode || sectionMode || adaptiveMode;
  const cacheLabel = `${formatNumber(cache.cached)}/${formatNumber(cache.total)}`;
  const cachePercent = cache.total ? Math.round((cache.cached / cache.total) * 100) : 0;

  return `
    <section class="dashboard">
      ${renderSubjectTabs()}
      ${renderNewSubjectSwitch()}
      <div class="toolbar">
        <div>
          <h1>${escapeHtml(newPool ? `New SAT ${subject.shortLabel} Questions` : subject.title)}</h1>
          <p>${status.lastImport ? `Last import ${new Date(status.lastImport).toLocaleString()} · ${escapeHtml(status.activeSourceLabel || "")}` : "No local question import yet"}</p>
        </div>
        <div class="toolbar-actions">
          <button class="secondary" data-action="import">${newPool ? "Check for New Questions" : imported ? "Refresh Import" : "Import Questions"}</button>
          <button class="ghost" data-action="reset">Reset Progress</button>
        </div>
      </div>

      <div class="stats">
        ${statCard(newPool ? "New Questions" : subject.rowLabel, status.total)}
        ${newPool ? "" : statCard("Bluebook Excluded", status.excluded)}
        ${newPool ? "" : statCard("Practice Pool", status.available)}
        ${statCard("Unanswered", status.unanswered)}
        ${statCard("Answered", status.answered)}
        ${statCard("Correct", status.correct)}
        ${statCard("Incorrect", status.incorrect)}
        ${statCard("Flagged", status.flagged)}
        ${statCard("Content Cached", cacheLabel)}
      </div>

      <section class="cache-panel">
        <div>
          <h2>Offline Cache</h2>
          <p>${cacheJob.running
            ? `Caching ${formatNumber(cacheJob.completed)} / ${formatNumber(cacheJob.total)} · current ${escapeHtml(cacheJob.current || "")}`
            : `${cachePercent}% cached · ${formatNumber(cache.remaining)} remaining`}</p>
          ${cacheJob.error ? `<p class="cache-error">Last issue: ${escapeHtml(cacheJob.error)}</p>` : ""}
        </div>
        <button class="secondary" data-action="cache-all" ${imported && !cacheJob.running && cache.remaining ? "" : "disabled"}>
          ${cacheJob.running ? "Caching..." : cache.remaining ? "Cache All Questions" : "Fully Cached"}
        </button>
      </section>

      ${renderPerformanceBreakdown()}
      <div class="module-panel">
        <div class="field-group">
          <label>
            Module Mode
            <select data-option="mode">
              <option value="random" ${state.moduleOptions.mode === "random" ? "selected" : ""}>Random</option>
              ${newPool ? `<option value="adaptive" ${adaptiveMode ? "selected" : ""}>Adaptive Section</option>` : ""}
              ${!newPool && subject.supportsRealistic ? `<option value="realistic" ${realisticMode ? "selected" : ""}>Realistic SAT</option>` : ""}
              ${!newPool && subject.supportsSection ? `<option value="section" ${sectionMode ? "selected" : ""}>Section</option>` : ""}
            </select>
          </label>
          <label>
            Source
            <select data-option="importSource" disabled>
              <option value="collegeboard" selected>College Board official</option>
            </select>
          </label>
          <label>
            Questions
            <input data-option="count" type="number" min="1" max="98" value="${lockedSatMode ? subject.defaultCount : state.moduleOptions.count}" ${lockedSatMode ? "disabled" : ""}>
          </label>
          <label>
            Minutes
            <input data-option="durationMinutes" type="number" min="0" max="180" value="${lockedSatMode ? subject.defaultMinutes : state.moduleOptions.durationMinutes}" ${lockedSatMode ? "disabled" : ""}>
          </label>
          <label class="check">
            <input data-option="includeAnswered" type="checkbox" ${state.moduleOptions.includeAnswered ? "checked" : ""} ${lockedSatMode ? "disabled" : ""}>
            Include answered
          </label>
        </div>
        <div class="module-panel-actions">
          <button class="primary" data-action="create-module" ${imported ? "" : "disabled"}>${adaptiveMode ? "New Adaptive Section" : sectionMode ? "New Section" : realisticMode ? "New Realistic Module" : "New Module"}</button>
          <button class="secondary" data-action="review-incorrect" ${status.incorrect ? "" : "disabled"}>Review Incorrect</button>
          <button class="secondary" data-action="review-flagged" ${status.flagged ? "" : "disabled"}>Review Flagged</button>
        </div>
      </div>
      ${renderHistory()}
    </section>
  `;
}

function renderModuleHeader() {
  if (!state.module) return "";
  const summary = moduleSummary();
  const remaining = remainingSeconds();
  const submitted = isReviewMode();
  const hasResults = Boolean(state.module.submitted_at) && state.module.kind === "practice";

  return `
    <section class="module-header">
      <div>
        <h2>${escapeHtml(state.module.title)}</h2>
        <p>${summary.answered} answered · ${summary.unanswered} unanswered · ${summary.flagged} flagged</p>
      </div>
      <div class="module-actions">
        ${remaining !== null && !submitted ? `<span class="timer">${formatTime(remaining)}</span>` : ""}
        ${submitted ? `
          <label class="check review-toggle">
            <input data-action="toggle-hide-answers" type="checkbox" ${state.reviewHideAnswers ? "checked" : ""}>
            Hide answers
          </label>
        ` : ""}
        ${currentSubject().referenceSheet ? `<button class="secondary" data-action="show-reference">Reference</button>` : ""}
        ${hasResults ? `<button class="secondary" data-action="show-results">Results</button>` : ""}
        ${!submitted ? `<button class="secondary" data-action="review">Review</button>` : ""}
        <button class="ghost" data-action="back-dashboard">Dashboard</button>
      </div>
    </section>
  `;
}

function renderNav() {
  if (!state.module) return "";
  return `
    <nav class="question-nav" aria-label="Question navigation">
      ${state.module.questions.map((question, index) => {
        const answered = Boolean(question.answer?.trim());
        const flagged = Boolean(question.module_flagged ?? question.flagged);
        const active = index === state.currentIndex;
        const resultClass = question.is_correct === 1 ? " correct" : question.is_correct === 0 ? " incorrect" : "";
        return `
          <button
            class="${active ? "active" : ""} ${answered ? "answered" : ""} ${flagged ? "flagged" : ""}${resultClass}"
            data-jump="${index}"
            title="Question ${index + 1}"
          >
            ${index + 1}
          </button>
        `;
      }).join("")}
    </nav>
  `;
}

function renderQuestionBody() {
  const row = currentQuestion();
  if (!row) return "";
  if (!state.currentDetail) {
    return `<div class="question-card loading-card">Loading question...</div>`;
  }

  const { content } = state.currentDetail;
  const answer = answerFor(row.row_id);
  const submitted = isReviewMode();
  const revealAnswers = submitted && !state.reviewHideAnswers;
  const flagged = flaggedFor(row.row_id);

  const answerBlock = hasAnswerOptions(content)
    ? renderOptions(row, content, answer, revealAnswers)
    : renderFreeResponse(row, answer, revealAnswers);

  return `
    <article class="question-card">
      <header class="question-title">
        <div>
          <span class="eyebrow">Question ${state.currentIndex + 1}${submitted ? ` · ${escapeHtml(formatDifficulty(row.difficulty))}` : ""}</span>
          <h3>ID ${escapeHtml(row.question_id || row.row_id)}</h3>
          ${submitted ? `<p>${escapeHtml(row.domain_desc || currentSubject().shortLabel)} · ${escapeHtml(row.skill_desc || "")}</p>` : ""}
          ${submitted && state.module?.kind === "practice" ? renderTimeBreakdown(row) : ""}
        </div>
        <div class="question-actions">
          ${isIncorrectReviewModule() ? `<button class="secondary danger-soft" data-action="remove-incorrect">Remove from Incorrect</button>` : ""}
          <button class="${flagged ? "flag-on" : "secondary"}" data-action="toggle-flag">${flagged ? "Flagged" : "Flag"}</button>
        </div>
      </header>

      ${content.stimulus ? `<div class="content-block">${normalizeDisplayHtml(content.stimulus)}</div>` : ""}
      ${content.stem ? `<div class="content-block stem">${normalizeDisplayHtml(content.stem)}</div>` : ""}
      ${answerBlock}
      ${revealAnswers ? renderExplanation(content, row) : ""}
    </article>
  `;
}

function renderOptions(row, content, answer, revealAnswers) {
  return `
    <div class="answers">
      ${Object.entries(content.answerOptions).map(([key, html], index) => {
        const selected = answer === key;
        const eliminated = eliminatedFor(row.row_id, key);
        const correct = revealAnswers && (content.correct_answer || []).includes(key);
        const wrong = revealAnswers && selected && !correct;
        return `
          <label class="option ${selected ? "selected" : ""} ${eliminated ? "eliminated" : ""} ${correct ? "correct" : ""} ${wrong ? "incorrect" : ""}">
            <input
              type="radio"
              name="answer-${escapeHtml(row.row_id)}"
              value="${escapeHtml(key)}"
              ${selected ? "checked" : ""}
              ${revealAnswers ? "disabled" : ""}
              data-answer="${escapeHtml(key)}"
            >
            <span class="choice-letter">${String.fromCharCode(65 + index)}</span>
            <span class="choice-html">${normalizeDisplayHtml(html)}</span>
            <button
              type="button"
              class="eliminate-button"
              data-action="toggle-eliminate"
              data-choice="${escapeHtml(key)}"
              aria-label="${eliminated ? "Restore" : "Cross out"} answer ${escapeHtml(key)}"
              title="${eliminated ? "Restore answer" : "Cross out answer"}"
            >
              ${eliminated ? "Undo" : "Cross out"}
            </button>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderFreeResponse(row, answer, revealAnswers) {
  return `
    <div class="free-response">
      <label>
        Answer
        <input
          data-free-answer
          value="${escapeHtml(answer)}"
          maxlength="6"
          ${revealAnswers ? "disabled" : ""}
          autocomplete="off"
        >
      </label>
    </div>
  `;
}

function renderExplanation(content, row) {
  const answer = answerFor(row.row_id);
  const correct = Array.isArray(content.correct_answer) ? content.correct_answer.join(", ") : "";
  return `
    <section class="results-detail">
      <div class="answer-line">
        <span>Your answer: <strong>${escapeHtml(answer || "Blank")}</strong></span>
        <span>Correct answer: <strong>${escapeHtml(correct)}</strong></span>
      </div>
      ${content.rationale ? `<div class="content-block rationale">${normalizeDisplayHtml(content.rationale)}</div>` : ""}
    </section>
  `;
}

function renderQuestionFooter() {
  if (!state.module) return "";
  const first = state.currentIndex === 0;
  const last = state.currentIndex === state.module.questions.length - 1;
  return `
    <footer class="question-footer">
      <button class="secondary" data-action="prev" ${first ? "disabled" : ""}>Previous</button>
      <button class="secondary" data-action="next" ${last ? "disabled" : ""}>Next</button>
    </footer>
  `;
}

function renderReview() {
  if (!state.reviewOpen || !state.module) return "";
  return `
    <section class="overlay">
      <div class="dialog">
        <header>
          <h2>Review</h2>
          <button class="ghost icon" data-action="close-review">×</button>
        </header>
        <div class="review-grid">
          ${state.module.questions.map((question, index) => {
            const answered = Boolean(question.answer?.trim());
            const flagged = Boolean(question.module_flagged ?? question.flagged);
            return `
              <button data-jump="${index}" class="${answered ? "answered" : ""} ${flagged ? "flagged" : ""}">
                <strong>${index + 1}</strong>
                <span>${answered ? "Answered" : "Blank"}${flagged ? " · Flagged" : ""}</span>
              </button>
            `;
          }).join("")}
        </div>
        <footer>
          <button class="secondary" data-action="close-review">Return</button>
          <button class="primary" data-action="submit">Submit</button>
        </footer>
      </div>
    </section>
  `;
}

function renderResults() {
  if (!state.resultsOpen || !isReviewMode()) return "";
  const correct = state.module.questions.filter((question) => question.is_correct === 1).length;
  const incorrect = state.module.questions.filter((question) => question.is_correct === 0).length;
  const skipped = state.module.questions.filter((question) => question.status === "skipped").length;

  return `
    <section class="overlay">
      <div class="dialog">
        <header>
          <h2>Results</h2>
          <button class="ghost icon" data-action="close-results">×</button>
        </header>
        <div class="stats compact">
          ${statCard("Correct", correct)}
          ${statCard("Incorrect", incorrect)}
          ${statCard("Skipped", skipped)}
        </div>
        <div class="review-grid results-grid">
          ${state.module.questions.map((question, index) => {
            const label = question.status || "skipped";
            return `
              <button data-jump="${index}" class="${question.is_correct === 1 ? "correct" : question.is_correct === 0 ? "incorrect" : ""}">
                <strong>${index + 1}</strong>
                <span>${label} · ${formatQuestionTime(question)}</span>
              </button>
            `;
          }).join("")}
        </div>
        <footer>
          <button class="secondary" data-action="close-results">Return</button>
        </footer>
      </div>
    </section>
  `;
}

function renderReferenceSheet() {
  if (!state.referenceOpen) return "";
  return `
    <section class="overlay">
      <div class="dialog reference-dialog">
        <header>
          <h2>Reference Sheet</h2>
          <button class="ghost icon" data-action="close-reference">×</button>
        </header>
        <div class="reference-image-wrap">
          <img src="/reference_sheet.png" alt="SAT math reference sheet">
        </div>
        <footer>
          <button class="secondary" data-action="close-reference">Return</button>
        </footer>
      </div>
    </section>
  `;
}

function renderModule() {
  if (!state.module) return "";
  return `
    <main class="module-shell">
      ${renderModuleHeader()}
      <div class="practice-layout">
        ${renderNav()}
        <div>
          ${renderQuestionBody()}
          ${renderQuestionFooter()}
        </div>
      </div>
      ${renderReview()}
      ${renderResults()}
      ${renderReferenceSheet()}
    </main>
  `;
}

function render() {
  app.innerHTML = `
    ${state.loading ? `<div class="busy">${escapeHtml(state.busyMessage)}</div>` : ""}
    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
    ${renderDashboard()}
    ${renderModule()}
  `;
}

function updateOption(target) {
  const key = target.dataset.option;
  if (!key) return;
  if (key === "mode") {
    const subject = currentSubject();
    const allowedModes = state.pool === "new" ? ["random", "adaptive"] : ["random"];
    if (state.pool === "main" && subject.supportsRealistic) allowedModes.push("realistic");
    if (state.pool === "main" && subject.supportsSection) allowedModes.push("section");
    state.moduleOptions.mode = allowedModes.includes(target.value) ? target.value : "random";
    if (target.value === "realistic" || target.value === "section" || target.value === "adaptive") {
      state.moduleOptions.count = subject.defaultCount;
      state.moduleOptions.durationMinutes = subject.defaultMinutes;
      state.moduleOptions.includeAnswered = false;
    }
    return;
  }
  if (key === "importSource") {
    state.importSource = "collegeboard";
    return;
  }
  if (target.type === "checkbox") {
    state.moduleOptions[key] = target.checked;
  } else {
    state.moduleOptions[key] = Number(target.value);
  }
}

app.addEventListener("change", async (event) => {
  const target = event.target;
  const optionKey = target.dataset.option;
  updateOption(target);

  if (optionKey) {
    render();
    return;
  }

  if (target.matches("[data-action='toggle-hide-answers']")) {
    state.reviewHideAnswers = target.checked;
    render();
    return;
  }

  const row = currentQuestion();
  if (!row) return;

  if (target.matches("[data-answer]")) {
    if (isReviewMode()) {
      state.reviewAttempts[row.row_id] = target.value;
      render();
      return;
    }
    await saveAnswer(row.row_id, target.value);
  }
});

app.addEventListener("input", async (event) => {
  const target = event.target;
  updateOption(target);
  if (!target.matches("[data-free-answer]")) return;
  const row = currentQuestion();
  if (!row) return;
  const limitedValue = sanitizeFreeResponse(target.value);
  if (target.value !== limitedValue) target.value = limitedValue;
  if (isReviewMode()) {
    state.reviewAttempts[row.row_id] = limitedValue;
    return;
  }
  row.answer = limitedValue;
  queueAnswerSave(row.row_id, limitedValue);
});

app.addEventListener("click", async (event) => {
  const openModuleButton = event.target.closest("[data-open-module]");
  if (openModuleButton) {
    await openModule(Number(openModuleButton.dataset.openModule));
    return;
  }

  const jump = event.target.closest("[data-jump]");
  if (jump) {
    state.reviewOpen = false;
    state.resultsOpen = false;
    await setCurrentIndex(Number(jump.dataset.jump));
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const row = currentQuestion();

  try {
    if (action === "import") await importQuestions();
    if (action === "cache-all") await cacheAllQuestions();
    if (action === "create-module") await createModule();
    if (action === "review-incorrect") await createReviewModule("incorrect");
    if (action === "review-flagged") await createReviewModule("flagged");
    if (action === "reset") await resetProgress();
    if (action === "toggle-category-breakdown") {
      state.showCategoryBreakdown = !state.showCategoryBreakdown;
      localStorage.setItem("showCategoryBreakdown", String(state.showCategoryBreakdown));
      render();
    }
    if (action === "back-dashboard") {
      await flushPendingAnswerSaves();
      await flushCurrentTime({ restart: false });
      state.module = null;
      state.currentDetail = null;
      state.reviewAttempts = {};
      state.reviewHideAnswers = false;
      resetTimeTracking();
      state.referenceOpen = false;
      state.eliminatedAnswers = {};
      await loadStatus();
      render();
    }
    if (action === "prev") await setCurrentIndex(state.currentIndex - 1);
    if (action === "next") await setCurrentIndex(state.currentIndex + 1);
    if (action === "review") {
      await flushPendingAnswerSaves();
      await flushCurrentTime({ restart: false });
      state.reviewOpen = true;
      render();
    }
    if (action === "close-review") {
      state.reviewOpen = false;
      startCurrentQuestionTimer();
      render();
    }
    if (action === "show-results") {
      state.resultsOpen = true;
      render();
    }
    if (action === "close-results") {
      state.resultsOpen = false;
      render();
    }
    if (action === "show-reference") {
      state.referenceOpen = true;
      render();
    }
    if (action === "close-reference") {
      state.referenceOpen = false;
      render();
    }
    if (action === "submit") await submitModule();
    if (action === "remove-incorrect") await removeCurrentIncorrectQuestion();
    if (action === "toggle-eliminate" && row) {
      event.preventDefault();
      event.stopPropagation();
      toggleEliminated(row.row_id, button.dataset.choice);
    }
    if (action === "toggle-flag" && row) {
      if (isReviewMode()) {
        await saveFlag(row.row_id, !flaggedFor(row.row_id));
      } else {
        await saveAnswer(row.row_id, answerFor(row.row_id), !flaggedFor(row.row_id));
      }
    }
  } catch (error) {
    setError(error);
  }
});

setInterval(() => {
  const timer = document.querySelector(".timer");
  if (timer && state.module && !isReviewMode() && state.module.duration_seconds) {
    const remaining = remainingSeconds();
    timer.textContent = formatTime(remaining);
    if (remaining <= 0 && !state.autoSubmitting) {
      submitModule().catch(setError);
    }
  }
}, 1000);

setInterval(() => {
  if (!state.cacheJob?.running) return;
  loadCacheStatus()
    .then(async () => {
      if (!state.cacheJob?.running) await loadStatus();
      render();
    })
    .catch(setError);
}, 2000);

state.loading = true;
state.busyMessage = "Loading SAT data";
render();

loadStatus()
  .then(() => {
    state.loading = false;
    render();
  })
  .catch((error) => {
    state.loading = false;
    setError(error);
    render();
  });
