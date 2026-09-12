import { renderAppNavigation } from "/shared/ui.js";

const app = document.querySelector("#app");
document.title = "About Ahmed | PEAK1600";

app.innerHTML = `
  <main class="about-page" id="main-content">
    ${renderAppNavigation("about")}
    <section class="profile-hero">
      <div class="profile-monogram" aria-hidden="true">AB</div>
      <div>
        <span class="section-kicker">About the maker</span>
        <h1>Hi, I’m Ahmed.</h1>
        <p>I built PEAK1600 after wanting a more direct way to work through SAT questions, understand mistakes, and study vocabulary without scattering progress across different tools.</p>
      </div>
    </section>

    <section class="profile-story">
      <div class="profile-story-heading">
        <span class="section-kicker">Why this exists</span>
        <h2>The project began with a practical question.</h2>
      </div>
      <div class="profile-story-copy">
        <p>Could SAT practice feel less like managing software and more like sitting down to do the work?</p>
        <p>That question shaped the product: keep the test experience focused, preserve the details that matter after submission, and make it easy to return to unfinished learning. What started as a personal study tool is becoming a product that other students can use with their own private progress.</p>
      </div>
    </section>

    <section class="profile-values" aria-label="Product values">
      <article><span>01</span><h3>Clarity over spectacle</h3><p>The interface should make the next action obvious and leave room for the question itself.</p></article>
      <article><span>02</span><h3>Evidence over guesses</h3><p>Review history, timing, and category results should make practice decisions easier to explain.</p></article>
      <article><span>03</span><h3>Respect for the student</h3><p>Progress belongs to the person doing the work, with account isolation and restrained data collection.</p></article>
    </section>

    <section class="profile-note">
      <h2>An independent project</h2>
      <p>PEAK1600 is independently built and is not affiliated with or endorsed by College Board. SAT is a registered trademark of College Board.</p>
      <a class="secondary button-link" href="/">Return home</a>
    </section>
  </main>
`;
