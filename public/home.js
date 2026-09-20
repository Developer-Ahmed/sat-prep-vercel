import { renderAppNavigation, renderBrand } from "/shared/ui.js";

const app = document.querySelector("#app");
document.title = "PEAK1600 | SAT Practice";

app.innerHTML = `
  <main class="home-page" id="main-content">
    ${renderAppNavigation("home")}
    <section class="home-hero">
      <div class="home-hero-copy">
        <span class="section-kicker">Practice with a plan</span>
        <h1>Know what to work on next.</h1>
        <p class="home-hero-lede">Practice, understand what slowed you down, and know where to return.</p>
        <div class="home-actions">
          <a class="primary button-link" href="/math">Start with Math</a>
          <a class="secondary button-link" href="/english">Start with Reading &amp; Writing</a>
        </div>
      </div>
    </section>

    <section class="home-system" aria-labelledby="home-system-title">
      <div class="home-section-heading">
        <span class="section-kicker">Built around your work</span>
        <h2 id="home-system-title">A clear loop, not another score screen.</h2>
        <p>Your misses, flags, and timing turn each session into a useful next step.</p>
      </div>
      <ol class="study-loop-visual" aria-label="Practice workflow">
        <li><span>01</span><div class="study-loop-mark" aria-hidden="true">P</div><strong>Practice</strong><small>Choose a session.</small></li>
        <li><span>02</span><div class="study-loop-mark" aria-hidden="true">R</div><strong>Review</strong><small>Find what slowed you down.</small></li>
        <li><span>03</span><div class="study-loop-mark" aria-hidden="true">↻</div><strong>Return</strong><small>Try the right concepts again.</small></li>
      </ol>
    </section>

    <section class="home-detail">
      <div>
        <span class="section-kicker">After a session</span>
        <h2>See the work behind the score.</h2>
      </div>
      <div class="review-snapshot" aria-label="Example practice review summary">
        <div><span>Correct</span><strong>18</strong></div>
        <div><span>Review again</span><strong>4</strong></div>
        <div><span>Flagged</span><strong>2</strong></div>
        <div class="review-snapshot-bar"><span style="width:82%"></span></div>
        <p>Open any missed question, hide the answer, and solve it again.</p>
        <a href="/about">Why I built it this way <span aria-hidden="true">→</span></a>
      </div>
    </section>

    <section class="home-paths" aria-label="Study areas">
      <a href="/math"><img src="/math-study.jpg" alt="A notebook with algebra, geometry, and graphs beside a calculator"><span>Math</span><strong>Build a set or take a full section.</strong><b>Open Math <span aria-hidden="true">→</span></b></a>
      <a href="/english"><img src="/reading-study.jpg" alt="An open reading passage being annotated by hand"><span>Reading &amp; Writing</span><strong>Practice passages, grammar, and synthesis.</strong><b>Open Reading &amp; Writing <span aria-hidden="true">→</span></b></a>
      <a href="/vocab"><img src="/vocab-study.jpg" alt="Vocabulary cards arranged beside a dictionary and notebook"><span>Vocabulary</span><strong>Learn meanings and roots over time.</strong><b>Open Vocabulary <span aria-hidden="true">→</span></b></a>
    </section>

    <footer class="home-footer">
      <a class="product-lockup" href="/" aria-label="PEAK1600 home">${renderBrand({ compact: true })}</a>
      <p>Made by a student who wanted a better way to understand his work.</p>
      <a href="/about">About the project</a>
    </footer>
  </main>
`;
