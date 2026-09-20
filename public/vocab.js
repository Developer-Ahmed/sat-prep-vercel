import { escapeHtml, requestJson } from "/shared/browser.js";
import { renderAppNavigation, renderBrand } from "/shared/ui.js";

const app = document.querySelector("#app");
const ERROR_DISMISS_MS = 3000;
let errorDismissTimer = null;

const state = {
  kind: new URLSearchParams(window.location.search).get("kind") === "root" ? "root" : "word",
  setId: new URLSearchParams(window.location.search).get("set") || "",
  sets: [],
  dashboard: null,
  items: [],
  view: "dashboard",
  session: null,
  sessionType: "quiz",
  currentIndex: 0,
  selected: "",
  answered: false,
  revealed: false,
  correct: 0,
  missed: 0,
  loading: false,
  error: "",
  notice: "",
  search: "",
  reviewRequestId: "",
  reviewSavePromises: {}
};

document.title = "Vocabulary | PEAK1600";

async function request(path, options = {}) {
  return requestJson(path, options, { resourceLabel: "vocabulary data" });
}

async function get(path) {
  return request(path);
}

async function post(path, body) {
  return request(path, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function setLoading(value) {
  state.loading = Boolean(value);
  render();
}

function setError(error) {
  if (errorDismissTimer) clearTimeout(errorDismissTimer);
  errorDismissTimer = null;
  state.error = error ? String(error.message || error) : "";
  render();
  if (state.error) {
    errorDismissTimer = setTimeout(() => {
      state.error = "";
      errorDismissTimer = null;
      render();
    }, ERROR_DISMISS_MS);
  }
}

async function loadDashboard() {
  const setQuery = state.setId ? `&set=${encodeURIComponent(state.setId)}` : "";
  state.dashboard = await get(`/api/vocab/dashboard?kind=${state.kind}${setQuery}`);
  state.setId = String(state.dashboard.set.id);
}

async function loadBootstrap() {
  const setQuery = state.setId ? `&set=${encodeURIComponent(state.setId)}` : "";
  const bootstrap = await get(`/api/vocab/bootstrap?kind=${state.kind}${setQuery}`);
  state.sets = bootstrap.sets;
  state.dashboard = bootstrap.dashboard;
  state.setId = String(bootstrap.dashboard.set.id);
}

async function loadLibrary() {
  const query = encodeURIComponent(state.search);
  state.items = await get(`/api/vocab/items?kind=${state.kind}&set=${encodeURIComponent(state.setId)}&search=${query}`);
}

function updateVocabUrl() {
  const selected = state.sets.find((set) => String(set.id) === String(state.setId));
  const setQuery = selected ? `&set=${encodeURIComponent(selected.slug)}` : "";
  history.replaceState(null, "", `/vocab?kind=${state.kind}${setQuery}`);
}

async function switchKind(kind) {
  state.kind = kind === "root" ? "root" : "word";
  state.session = null;
  state.view = "dashboard";
  state.search = "";
  state.notice = "";
  setLoading(true);
  try {
    await flushVocabReviews();
    await loadBootstrap();
    updateVocabUrl();
  } finally {
    setLoading(false);
  }
}

async function switchSet(setId) {
  if (String(setId) === String(state.setId)) return;
  state.setId = String(setId);
  state.session = null;
  state.view = "dashboard";
  state.search = "";
  state.notice = "";
  updateVocabUrl();
  setLoading(true);
  try {
    await flushVocabReviews();
    await loadDashboard();
  } finally {
    setLoading(false);
  }
}

async function startSession(type) {
  state.error = "";
  state.notice = "";
  setLoading(true);
  try {
    state.session = await get(`/api/vocab/session?kind=${state.kind}&set=${encodeURIComponent(state.setId)}&limit=15`);
    state.sessionType = type;
    state.currentIndex = 0;
    state.selected = "";
    state.answered = false;
    state.revealed = false;
    state.correct = 0;
    state.missed = 0;
    state.reviewRequestId = crypto.randomUUID();
    state.view = "session";
  } catch (error) {
    setError(error);
  } finally {
    setLoading(false);
  }
}

function currentSessionEntry() {
  if (!state.session) return null;
  const collection = state.sessionType === "quiz" ? state.session.questions : state.session.items;
  return collection[state.currentIndex] || null;
}

function trackVocabReview(itemId, rating, requestId) {
  const request = post("/api/vocab/review", {
    itemId,
    setId: state.setId,
    rating,
    requestId
  });
  state.reviewSavePromises[requestId] = request;
  request
    .catch(setError)
    .finally(() => {
      if (state.reviewSavePromises[requestId] === request) delete state.reviewSavePromises[requestId];
    });
  return request;
}

async function flushVocabReviews() {
  while (Object.keys(state.reviewSavePromises).length) {
    await Promise.all(Object.values(state.reviewSavePromises));
  }
}

function answerQuiz(option) {
  if (state.answered) return;
  const question = currentSessionEntry();
  if (!question) return;
  state.selected = option;
  state.answered = true;
  const isCorrect = option === question.answer;
  if (isCorrect) state.correct += 1;
  else state.missed += 1;
  render();
  trackVocabReview(question.id, isCorrect ? "good" : "again", state.reviewRequestId);
}

function rateRecall(rating) {
  const item = currentSessionEntry();
  if (!item || !state.revealed || state.answered) return;
  state.answered = true;
  if (rating === "again") state.missed += 1;
  else state.correct += 1;
  render();
  trackVocabReview(item.id, rating, state.reviewRequestId);
  nextCard();
}

function nextCard() {
  const collection = state.sessionType === "quiz" ? state.session.questions : state.session.items;
  if (state.currentIndex >= collection.length - 1) {
    state.view = "complete";
    state.session = null;
    render();
    return;
  }
  state.currentIndex += 1;
  state.selected = "";
  state.answered = false;
  state.revealed = false;
  state.reviewRequestId = crypto.randomUUID();
  render();
}

async function openLibrary() {
  state.view = "library";
  setLoading(true);
  try {
    await loadLibrary();
  } finally {
    setLoading(false);
  }
}

async function addWord(form) {
  const data = new FormData(form);
  const term = data.get("term");
  const definition = data.get("definition");
  const example = data.get("example");
  state.error = "";
  try {
    await post("/api/vocab/words", { term, definition, example, setId: state.setId });
    form.reset();
    state.notice = `${term} was added.`;
    await Promise.all([loadDashboard(), loadLibrary()]);
    render();
  } catch (error) {
    setError(error);
  }
}

function renderTopNav() {
  return renderAppNavigation("vocab");
}

function renderKindTabs() {
  return `
    <nav class="vocab-kind-tabs" aria-label="Vocabulary study type">
      <button class="${state.kind === "word" ? "active" : ""}" data-kind="word">Words</button>
      <button class="${state.kind === "root" ? "active" : ""}" data-kind="root">Roots</button>
    </nav>
  `;
}

function renderSetSelector() {
  if (state.kind !== "word") return "";
  const activeSet = state.sets.find((set) => String(set.id) === String(state.setId));
  return `
    <section class="vocab-set-selector" aria-label="Vocabulary sets">
      <div class="vocab-set-heading">
        <span>Vocabulary set</span>
        <strong>${escapeHtml(activeSet?.name || "Choose a set")}</strong>
      </div>
      <select data-set-select aria-label="Select vocabulary set">
        ${state.sets.map((set) => `<option value="${set.id}" ${String(set.id) === String(state.setId) ? "selected" : ""}>${escapeHtml(set.name)} · ${escapeHtml(set.total)} words</option>`).join("")}
      </select>
    </section>
  `;
}

function stat(label, value, tone = "") {
  return `<div class="vocab-stat ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderDashboard() {
  const metrics = state.dashboard || {};
  const label = state.kind === "word" ? "Words" : "Roots";
  const total = Number(metrics.total) || 0;
  const mastered = Number(metrics.mastered) || 0;
  const mastery = total ? Math.round((mastered / total) * 100) : 0;
  return `
    <main class="vocab-shell" id="main-content">
      ${renderTopNav()}
      <div class="vocab-dashboard-grid">
        <aside class="vocab-sidebar">
          <div class="vocab-sidebar-heading">
            <span class="vocab-eyebrow">Your word library</span>
            <h1>Vocabulary</h1>
          </div>
          ${renderKindTabs()}
          ${renderSetSelector()}
          <section class="vocab-mastery-panel">
            <span>Mastery</span>
            <div class="mastery-ring" style="--mastery:${mastery}" aria-label="${mastery}% mastered"><strong>${mastery}%</strong></div>
            <p>${mastered} of ${total} ${label.toLowerCase()} mastered</p>
          </section>
          <button class="secondary full-width" data-action="library">Browse library</button>
        </aside>

        <div class="vocab-main-column">
          <header class="vocab-toolbar">
            <div>
              <p class="vocab-eyebrow">Today’s review</p>
              <h2>${metrics.due || 0} ${label.toLowerCase()} to study</h2>
              <p>Due now based on your review history.</p>
            </div>
            <span class="source-badge">Spaced review</span>
          </header>

          <section class="study-actions">
            <div class="study-action-main">
              <div>
                <span>Quiz</span>
                <h2>Practice meanings</h2>
                <p>${Math.min(15, Math.max(1, Number(metrics.due) || 15))} multiple-choice cards</p>
              </div>
              <button class="primary" data-action="start-quiz">Start studying</button>
            </div>
            <div class="study-secondary-actions">
              <button class="study-action-secondary" data-action="start-recall">
                <span>Recall cards</span>
                <strong>Think first, then reveal</strong>
              </button>
              <button class="study-action-secondary" data-action="library">
                <span>Full library</span>
                <strong>${metrics.total || 0} ${label.toLowerCase()}</strong>
              </button>
            </div>
          </section>

          <section class="vocab-stats" aria-label="${label} progress">
            ${stat("Due", metrics.due || 0, "due")}
            ${stat("New", metrics.new || 0)}
            ${stat("Learning", metrics.learning || 0)}
            ${stat("Mastered", metrics.mastered || 0, "mastered")}
            ${stat("Today", metrics.reviewedToday || 0)}
            ${stat("Accuracy", `${metrics.accuracy || 0}%`)}
          </section>
          ${state.kind === "word" ? renderAddWord() : renderRootFamilies()}
        </div>
      </div>
    </main>
  `;
}

function renderAddWord() {
  return `
    <details class="vocab-add-panel">
      <summary>Add a word</summary>
      <form id="add-word-form" class="vocab-form">
        <label>Word or phrase<input name="term" maxlength="100" required></label>
        <label>Definition<textarea name="definition" maxlength="600" rows="2" required></textarea></label>
        <label>Example sentence<textarea name="example" maxlength="800" rows="2"></textarea></label>
        <button class="primary" type="submit">Add word</button>
      </form>
    </details>
  `;
}

function renderRootFamilies() {
  return `
    <section class="root-note">
      <strong>42 useful roots and prefixes</strong>
      <span>Use familiar parts of a word to reason through an unfamiliar meaning.</span>
    </section>
  `;
}

function renderQuiz() {
  const question = currentSessionEntry();
  if (!question) return renderEmptySession();
  const total = state.session.questions.length;
  const progress = ((state.currentIndex + 1) / total) * 100;
  return `
    <main class="vocab-session-shell" id="main-content">
      ${renderSessionHeader(total, progress)}
      <article class="vocab-study-card">
        <p class="vocab-card-label">${state.kind === "word" ? "Vocabulary meaning" : "Word roots"}</p>
        <h2>${escapeHtml(question.prompt)}</h2>
        <p class="vocab-clue">${escapeHtml(question.clue)}</p>
        <div class="vocab-options">
          ${question.options.map((option) => {
            const selected = state.selected === option;
            const correct = state.answered && option === question.answer;
            const wrong = state.answered && selected && option !== question.answer;
            return `<button class="vocab-option ${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}" data-option="${escapeHtml(option)}" ${state.answered ? "disabled" : ""}>${escapeHtml(option)}</button>`;
          }).join("")}
        </div>
        ${state.answered ? renderQuizFeedback(question) : ""}
      </article>
    </main>
  `;
}

function renderQuizFeedback(question) {
  const correct = state.selected === question.answer;
  const selectedDetail = question.optionDetails?.[state.selected];
  if (!correct) {
    const correctReason = state.kind === "root"
        ? `The root “${question.item.term}” carries the meaning “${question.item.definition}.”`
        : `“${question.item.definition}” is the definition of “${question.item.term}.”`;
    const selectedReason = selectedDetail
      ? state.kind === "root"
        ? `“${selectedDetail.term}” means “${selectedDetail.definition}.” That meaning does not match the clue.`
        : `“${state.selected}” defines “${selectedDetail.term},” not “${question.item.term}.”`
      : `That choice does not match the displayed word.`;
    return `
      <section class="vocab-feedback wrong">
        <strong>Answer: ${escapeHtml(question.item.term)}</strong>
        <div class="feedback-comparison">
          <div class="feedback-reason correct-reason">
            <span>Why it fits</span>
            <h3>${escapeHtml(question.item.term)}</h3>
            <p><b>Definition:</b> ${escapeHtml(question.item.definition)}</p>
            <small>${escapeHtml(correctReason)}</small>
          </div>
          <div class="feedback-reason selected-reason">
            <span>Your choice</span>
            <h3>${escapeHtml(selectedDetail?.term || state.selected)}</h3>
            <p><b>Definition:</b> ${escapeHtml(selectedDetail?.definition || "Definition unavailable")}</p>
            <small>${escapeHtml(selectedReason)}</small>
          </div>
        </div>
        <button class="primary" data-action="next-card">${state.currentIndex === state.session.questions.length - 1 ? "Finish" : "Continue"}</button>
      </section>
    `;
  }
  return `
    <section class="vocab-feedback correct">
      <strong>Correct</strong>
      <p>${escapeHtml(question.item.definition)}</p>
      ${question.item.example ? `<small>${escapeHtml(question.item.example)}</small>` : ""}
      <button class="primary" data-action="next-card">${state.currentIndex === state.session.questions.length - 1 ? "Finish" : "Continue"}</button>
    </section>
  `;
}

function renderRecall() {
  const item = currentSessionEntry();
  if (!item) return renderEmptySession();
  const total = state.session.items.length;
  const progress = ((state.currentIndex + 1) / total) * 100;
  return `
    <main class="vocab-session-shell" id="main-content">
      ${renderSessionHeader(total, progress)}
      <article class="vocab-study-card recall-card">
        <p class="vocab-card-label">${state.kind === "root" ? "Root" : "Recall the meaning"}</p>
        <h2 class="recall-term">${escapeHtml(item.term)}</h2>
        ${state.revealed ? `
          <div class="recall-answer">
            <p>${escapeHtml(item.definition)}</p>
            ${item.example ? `<small>${escapeHtml(item.example)}</small>` : ""}
          </div>
          <div class="recall-ratings">
            <button class="rating-again" data-rating="again">Again</button>
            <button class="rating-hard" data-rating="hard">Hard</button>
            <button class="rating-good" data-rating="good">Good</button>
            <button class="rating-easy" data-rating="easy">Easy</button>
          </div>
        ` : `<button class="primary reveal-button" data-action="reveal">Reveal</button>`}
      </article>
    </main>
  `;
}

function renderSessionHeader(total, progress) {
  return `
    <header class="vocab-session-header">
      <a class="product-lockup" href="/" aria-label="PEAK1600 home">${renderBrand({ compact: true })}</a>
      <div class="vocab-progress-track"><span style="width:${progress}%"></span></div>
      <strong>${state.currentIndex + 1} of ${total}</strong>
      <button class="secondary" data-action="end-session">Exit review</button>
    </header>
  `;
}

function renderEmptySession() {
  return `
    <main class="vocab-session-shell" id="main-content">
      <section class="vocab-empty">
        <h2>Nothing is due right now</h2>
        <button class="primary" data-action="end-session">Back to vocabulary</button>
      </section>
    </main>
  `;
}

function renderComplete() {
  const total = state.correct + state.missed;
  return `
    <main class="vocab-session-shell" id="main-content">
      <section class="vocab-complete">
        <span>Session complete</span>
        <h1>${state.correct}/${total}</h1>
        <p>${state.missed ? `${state.missed} card${state.missed === 1 ? "" : "s"} will come back sooner so you can try again.` : "You remembered every card. They will return after a longer interval."}</p>
        <button class="primary" data-action="end-session">Back to vocabulary</button>
      </section>
    </main>
  `;
}

function renderLibrary() {
  return `
    <main class="vocab-shell" id="main-content">
      ${renderTopNav()}
      <header class="vocab-toolbar">
        <div><p class="vocab-eyebrow">${state.kind === "word" ? "Words" : "Roots"}</p><h1>Library</h1><p>${state.items.length} items in this view.</p></div>
        <button class="secondary" data-action="dashboard">Back to study</button>
      </header>
      ${renderKindTabs()}
      ${renderSetSelector()}
      <form id="vocab-search-form" class="vocab-search">
        <input name="search" value="${escapeHtml(state.search)}" placeholder="Search term or definition" aria-label="Search vocabulary">
        <button class="secondary" type="submit">Search</button>
      </form>
      <section class="vocab-library-list">
        ${state.items.map((item) => `
          <article class="vocab-library-row">
            <div>
              <h2>${escapeHtml(item.term)}</h2>
              <p>${escapeHtml(item.definition)}</p>
              ${item.example ? `<small>${escapeHtml(item.example)}</small>` : ""}
            </div>
            <span class="vocab-state ${escapeHtml(item.state)}">${escapeHtml(item.state)}</span>
          </article>
        `).join("") || `<div class="vocab-empty"><p>No matches.</p></div>`}
      </section>
      ${state.kind === "word" ? renderAddWord() : ""}
    </main>
  `;
}

function render() {
  app.innerHTML = `
    ${state.loading ? `<div class="busy" role="status" aria-live="polite">Loading vocabulary</div>` : ""}
    ${state.error ? `<div class="error" role="alert"><span>${escapeHtml(state.error)}</span><button class="error-dismiss" data-action="dismiss-error" aria-label="Dismiss error" title="Dismiss error">×</button></div>` : ""}
    ${state.notice ? `<div class="vocab-notice" role="status" aria-live="polite">${escapeHtml(state.notice)}</div>` : ""}
    ${state.view === "session" ? (state.sessionType === "quiz" ? renderQuiz() : renderRecall()) : ""}
    ${state.view === "complete" ? renderComplete() : ""}
    ${state.view === "library" ? renderLibrary() : ""}
    ${state.view === "dashboard" ? renderDashboard() : ""}
  `;
}

app.addEventListener("click", async (event) => {
  const setButton = event.target.closest("[data-set-id]");
  if (setButton) {
    await switchSet(setButton.dataset.setId);
    return;
  }
  const kindButton = event.target.closest("[data-kind]");
  if (kindButton) {
    await switchKind(kindButton.dataset.kind);
    return;
  }
  const option = event.target.closest("[data-option]");
  if (option) {
    await answerQuiz(option.dataset.option);
    return;
  }
  const rating = event.target.closest("[data-rating]");
  if (rating) {
    await rateRecall(rating.dataset.rating);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "dismiss-error") {
    setError("");
    return;
  }
  try {
    if (button.dataset.action === "start-quiz") await startSession("quiz");
    if (button.dataset.action === "start-recall") await startSession("recall");
    if (button.dataset.action === "library") await openLibrary();
    if (button.dataset.action === "dashboard" || button.dataset.action === "end-session") {
      state.view = "dashboard";
      state.session = null;
      render();
      await flushVocabReviews();
      await loadDashboard();
      render();
    }
    if (button.dataset.action === "reveal") {
      state.revealed = true;
      render();
    }
    if (button.dataset.action === "next-card") nextCard();
  } catch (error) {
    setError(error);
  }
});

app.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-set-select]");
  if (select) await switchSet(select.value);
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "add-word-form") await addWord(event.target);
  if (event.target.id === "vocab-search-form") {
    const data = new FormData(event.target);
    state.search = String(data.get("search") || "").trim();
    setLoading(true);
    try {
      await loadLibrary();
    } finally {
      setLoading(false);
    }
  }
});

state.loading = true;
render();

Promise.resolve()
  .then(loadBootstrap)
  .then(() => {
    state.loading = false;
    updateVocabUrl();
    render();
  })
  .catch((error) => {
    state.loading = false;
    setError(error);
  });
