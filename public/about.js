import { renderAppNavigation } from "/shared/ui.js";

const app = document.querySelector("#app");
document.title = "About Ahmed | PEAK1600";

app.innerHTML = `
  <main class="about-page" id="main-content">
    ${renderAppNavigation("about")}
    <section class="profile-hero">
      <div class="profile-monogram" aria-hidden="true">AB</div>
      <div>
        <span class="section-kicker">About me</span>
        <h1>Hi, I’m Ahmed.</h1>
        <p>I built PEAK1600 because I wanted one place where I could practice, understand my mistakes, and come back to the concepts I had not learned yet.</p>
      </div>
    </section>

    <section class="profile-story">
      <figure class="profile-build-visual">
        <img src="/building-peak.jpg" alt="A notebook and laptop used to plan a study interface">
        <figcaption>Planning the flow from practice to review.</figcaption>
      </figure>
      <div class="profile-story-copy">
        <span class="section-kicker">Why this exists</span>
        <h2>I did not want another app that only counted answers.</h2>
        <blockquote>“I do not want to memorize and move on. I want to understand why it works.”</blockquote>
        <p>My questions, vocabulary, timing, and review were spread across different tools. PEAK1600 brings them together and makes it easy to return to the exact concepts that still need work.</p>
      </div>
    </section>

    <section class="profile-values" aria-label="Product values">
      <article><span>01</span><h3>Understand</h3><p>Find where your reasoning changed.</p></article>
      <article><span>02</span><h3>Stay honest</h3><p>Practice data is useful; it is not an official score.</p></article>
      <article><span>03</span><h3>Try again</h3><p>Missed and flagged questions remain available.</p></article>
    </section>

    <section class="profile-note">
      <div><span class="section-kicker">Independent project</span><h2>Built by Ahmed</h2></div>
      <p>PEAK1600 is not affiliated with or endorsed by College Board. SAT is a registered trademark of College Board.</p>
      <a class="secondary button-link" href="/">Return home</a>
    </section>
  </main>
`;
