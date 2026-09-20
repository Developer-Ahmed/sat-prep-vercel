import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeQuestionContent, sanitizeQuestionHtml } from "../server/platform/question-content.js";

test("question HTML removes executable and document-level content", () => {
  const dirty = `
    <p onclick="steal()">Safe <strong>question</strong></p>
    <script>alert(1)</script>
    <iframe src="https://attacker.example"></iframe>
    <img src="javascript:alert(1)" onerror="steal()" alt="diagram">
    <svg viewBox="0 0 10 10"><style>body{display:none}</style><path d="M0 0 L10 10" onload="steal()" /></svg>
  `;
  const clean = sanitizeQuestionHtml(dirty);
  assert.match(clean, /<strong>question<\/strong>/);
  assert.match(clean, /<svg viewBox="0 0 10 10">/);
  assert.match(clean, /<path d="M0 0 L10 10"><\/path>/);
  assert.doesNotMatch(clean, /script|iframe|onclick|onerror|onload|javascript:|display:none/i);
});

test("question content preserves SAT tables, MathML, and safe answer formatting", () => {
  const content = sanitizeQuestionContent({
    stimulus: '<table><thead><tr><th scope="col">x</th></tr></thead><tbody><tr><td>2</td></tr></tbody></table>',
    stem: '<math alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>',
    answerOptions: { A: '<span style="text-align: center" data-bad="x">Choice</span>' },
    rationale: '<p>Because <em>x</em> is positive.</p>',
    correct_answer: ["A"]
  });
  assert.match(content.stimulus, /<table>/);
  assert.match(content.stem, /<msup>/);
  assert.match(content.answerOptions.A, /style="text-align:center"/);
  assert.doesNotMatch(content.answerOptions.A, /data-bad/);
  assert.deepEqual(content.correct_answer, ["A"]);
});

test("question HTML preserves safe SVG presentation without allowing executable CSS", () => {
  const dirty = `
    <svg viewBox="0 0 20 20">
      <defs><path id="axis-mark" d="M0 0 L0 2"></path></defs>
      <path d="M0 0 L20 20" style="fill:none;stroke:#000000;stroke-width:1.5;stroke-linejoin:miter"></path>
      <use xlink:href="#axis-mark" style="fill:currentColor"></use>
      <text style="font-family:Noto Serif;font-size:15px;font-style:italic;text-anchor:middle;dominant-baseline:middle">x</text>
      <path d="M0 0" style="fill:url(https://attacker.example/image);stroke:url(javascript:alert(1))"></path>
    </svg>
  `;
  const clean = sanitizeQuestionHtml(dirty);
  assert.match(clean, /id="axis-mark"/);
  assert.match(clean, /style="fill:none;stroke:#000000;stroke-width:1\.5;stroke-linejoin:miter"/);
  assert.match(clean, /xlink:href="#axis-mark"/);
  assert.match(clean, /font-family:Noto Serif/);
  assert.doesNotMatch(clean, /attacker|javascript/i);
});
