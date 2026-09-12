import { renderAppNavigation } from "/shared/ui.js";

const app = document.querySelector("#app");
document.title = "PEAK1600 | SAT Practice";

app.innerHTML = `
  <main class="home-page" id="main-content">
    ${renderAppNavigation("home")}
    <section class="home-hero">
      <div class="home-hero-copy">
        <span class="section-kicker">One SAT practice workspace</span>
        <h1>PEAK1600</h1>
        <p class="home-hero-lede">Build Math and Reading &amp; Writing modules from the question catalog, return to every missed or flagged problem, and keep vocabulary review moving on schedule.</p>
        <div class="home-actions">
          <a class="primary button-link" href="/math">Practice Math</a>
          <a class="secondary button-link" href="/english">Practice Reading &amp; Writing</a>
        </div>
      </div>
      <div class="product-map" aria-label="PEAK1600 study areas">
        <header><span>Today</span><strong>Choose where to focus</strong></header>
        <a href="/math"><span class="product-map-index">01</span><span><strong>Math practice</strong><small>Random, realistic, or full-section sessions</small></span><b>Open</b></a>
        <a href="/english"><span class="product-map-index">02</span><span><strong>Reading &amp; Writing</strong><small>Practice ordered around the SAT module structure</small></span><b>Open</b></a>
        <a href="/vocab"><span class="product-map-index">03</span><span><strong>Vocabulary</strong><small>Meaning questions, recall cards, and word roots</small></span><b>Open</b></a>
      </div>
    </section>

    <section class="home-system" aria-labelledby="home-system-title">
      <div class="home-section-heading">
        <span class="section-kicker">The working loop</span>
        <h2 id="home-system-title">Practice, inspect, return.</h2>
        <p>The app keeps those three steps connected, so finishing a module does not erase the useful part: what happened inside it.</p>
      </div>
      <div class="home-steps">
        <article><span>01</span><h3>Build a session</h3><p>Choose a short random set, an SAT-shaped module, or a full section. Unanswered questions are used first.</p></article>
        <article><span>02</span><h3>Work without interruption</h3><p>Move freely, flag uncertainty, cross out choices, and review before submitting. Results wait until the end.</p></article>
        <article><span>03</span><h3>Use the evidence</h3><p>Revisit incorrect and flagged questions, inspect time by attempt, and see results by domain and skill.</p></article>
      </div>
    </section>

    <section class="home-detail">
      <div>
        <span class="section-kicker">Deliberately connected</span>
        <h2>Questions and vocabulary belong in the same study record.</h2>
      </div>
      <div class="home-detail-copy">
        <p>Question practice shows where reasoning breaks down. Vocabulary review strengthens one of the inputs that Reading &amp; Writing depends on. PEAK1600 keeps both visible without forcing them into the same kind of exercise.</p>
        <a href="/vocab">Open vocabulary study <span aria-hidden="true">→</span></a>
      </div>
    </section>

    <footer class="home-footer">
      <a class="product-lockup" href="/" aria-label="PEAK1600 home"><span class="product-symbol" aria-hidden="true">P</span><strong class="product-name"><span>PEAK</span><b>1600</b></strong></a>
      <p>Focused SAT practice, built around the work that comes next.</p>
      <a href="/about">About the project</a>
    </footer>
  </main>
`;
