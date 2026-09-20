import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authSource = await readFile(new URL("../public/auth.js", import.meta.url), "utf8");
const authRuntimeSource = await readFile(new URL("../public/shared/auth-runtime.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const vocabSource = await readFile(new URL("../public/vocab.js", import.meta.url), "utf8");
const browserSource = await readFile(new URL("../public/shared/browser.js", import.meta.url), "utf8");
const sharedUiSource = await readFile(new URL("../public/shared/ui.js", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../public/theme.js", import.meta.url), "utf8");
const analyticsSource = await readFile(new URL("../public/analytics.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const designSource = await readFile(new URL("../public/design.css", import.meta.url), "utf8");
const humanSource = await readFile(new URL("../public/human.css", import.meta.url), "utf8");
const homeSource = await readFile(new URL("../public/home.js", import.meta.url), "utf8");
const aboutSource = await readFile(new URL("../public/about.js", import.meta.url), "utf8");

test("primary navigation exposes the current product areas without the retired new-question tab", () => {
  for (const href of ["/", "/math", "/english", "/vocab", "/about"]) {
    assert.match(sharedUiSource, new RegExp(`href: "${href.replace("/", "\\/")}"`));
  }
  assert.doesNotMatch(sharedUiSource, /New Questions/i);
});

test("the product identity uses a dedicated summit mark and authentication progress visual", () => {
  assert.match(sharedUiSource, /class="product-symbol-primary"/);
  assert.match(sharedUiSource, /class="product-symbol-accent"/);
  assert.doesNotMatch(sharedUiSource, /product-symbol" aria-hidden="true">P</);
  assert.match(authSource, /function renderAuthProgressArt\(\)/);
  assert.match(authSource, /Practice[\s\S]{0,80}Understand[\s\S]{0,80}Return/);
  assert.doesNotMatch(authSource, /auth-peak-art/);
});

test("Clerk authentication stays fluid without nesting cards or duplicate account actions", () => {
  assert.match(authSource, /cardBox: \{ width: "100%", maxWidth: "100%", minWidth: "0"/);
  assert.match(authSource, /main: \{ width: "100%", maxWidth: "100%", minWidth: "0"/);
  assert.match(authSource, /footerAction: \{ display: "none" \}/);
  assert.match(designSource, /#clerk-authentication \.cl-cardBox,[\s\S]{0,420}width: 100%/);
  assert.match(designSource, /\.auth-panel \{[\s\S]{0,260}background: transparent[\s\S]{0,260}padding: 0/);
});

test("the validated theme preference runs before styles paint", () => {
  assert.match(themeSource, /value === "light" \|\| value === "dark"/);
  assert.match(themeSource, /localStorage\.setItem\(storageKey, theme\)/);
  assert.ok(indexSource.indexOf('src="/theme.js"') < indexSource.indexOf('href="/design.css"'));
});

test("the human-centered presentation layer loads last and supports both themes", () => {
  assert.ok(indexSource.indexOf('href="/human.css"') > indexSource.indexOf('href="/design.css"'));
  assert.match(humanSource, /html\[data-theme="light"\]/);
  assert.match(humanSource, /html\[data-theme="dark"\]/);
  assert.match(humanSource, /url\("\/student-study\.jpg"\)/);
  assert.match(humanSource, /@media \(max-width: 620px\)/);
  assert.match(humanSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test("public pages use original visuals and concise study-focused language", () => {
  for (const asset of ["math-study.jpg", "reading-study.jpg", "vocab-study.jpg"]) {
    assert.match(homeSource, new RegExp(`/${asset.replace(".", "\\.")}`));
  }
  assert.match(homeSource, /class="study-loop-visual"/);
  assert.match(homeSource, /class="review-snapshot"/);
  assert.match(aboutSource, /\/building-peak\.jpg/);
  assert.match(aboutSource, /concepts I had not learned yet/);
  assert.doesNotMatch(`${homeSource}\n${aboutSource}`, /During the test, the question stays at the center/);
  assert.doesNotMatch(aboutSource, /I am continuing to improve PEAK1600/);
});

test("Vercel analytics loads once outside local development without reporting URL parameters", () => {
  assert.match(indexSource, /<script src="\/analytics\.js" defer><\/script>/);
  assert.match(analyticsSource, /localHosts\.has\(window\.location\.hostname\)/);
  assert.match(analyticsSource, /script\.src = "\/_vercel\/insights\/script\.js"/);
  assert.match(analyticsSource, /window\.va\("beforeSend"/);
  assert.match(analyticsSource, /url\.search = ""/);
  assert.match(analyticsSource, /url\.hash = ""/);
  assert.doesNotMatch(indexSource, /@vercel\/analytics\/next/);
});

test("light-mode controls retain legible selected and disabled states", () => {
  assert.match(designSource, /\.button-link \{[\s\S]{0,240}text-decoration: none/);
  assert.match(designSource, /html\[data-theme="light"\] \.mode-segments button\.active \{[\s\S]{0,220}color: var\(--blue-dark\)/);
  assert.match(designSource, /html\[data-theme="light"\] \.source-badge \{[\s\S]{0,180}color: #086b63/);
  assert.match(designSource, /html\[data-theme="light"\] input:disabled,[\s\S]{0,280}opacity: 1/);
  assert.match(designSource, /html\[data-theme="light"\] button\.primary:disabled \{[\s\S]{0,220}opacity: 1/);
  assert.match(designSource, /html\[data-theme="light"\] \.study-action-main \.primary,[\s\S]{0,220}color: #ffffff/);
});

test("question workspace uses split passages for English and inline source material for Math", () => {
  assert.match(appSource, /const showSourcePane = state\.subject === "english" && Boolean\(content\.stimulus\)/);
  assert.match(appSource, /showSourcePane \? "has-stimulus" : "single-pane"/);
  assert.match(appSource, /!showSourcePane && content\.stimulus[\s\S]{0,180}question-inline-material/);
  assert.match(designSource, /\.content-block img,[\s\S]{0,180}background: #ffffff/);
  assert.match(designSource, /\.content-block svg,[\s\S]{0,180}\.choice-html svg/);
});

test("transient application errors dismiss themselves without stale timers", () => {
  for (const source of [appSource, vocabSource]) {
    assert.match(source, /const ERROR_DISMISS_MS = 3000/);
    assert.match(source, /if \(errorDismissTimer\) clearTimeout\(errorDismissTimer\)/);
    assert.match(source, /errorDismissTimer = setTimeout\(\(\) => \{[\s\S]{0,180}state\.error = ""[\s\S]{0,180}ERROR_DISMISS_MS/);
    assert.match(source, /data-action="dismiss-error" aria-label="Dismiss error"/);
    assert.match(source, /dismiss-error[\s\S]{0,100}setError\(""\)/);
  }
  assert.match(designSource, /\.error-dismiss \{[\s\S]{0,480}width: 32px/);
});

test("Clerk browser dependencies are reproducibly pinned", () => {
  assert.match(authSource, /CLERK_JS_VERSION = "\d+\.\d+\.\d+"/);
  assert.match(authSource, /CLERK_UI_VERSION = "\d+\.\d+\.\d+"/);
  assert.doesNotMatch(authSource, /@clerk\/(?:ui|clerk-js)@(?:latest|\d+)\//);
  assert.match(authSource, /data-clerk-proxy-url/);
  assert.match(authRuntimeSource, /proxyUrl \? \{ proxyUrl \} : \{\}/);
  assert.match(authRuntimeSource, /afterSignOutUrl: SIGN_IN_PATH/);
});

test("Clerk dependencies download in parallel without changing execution order", () => {
  assert.match(authSource, /preloadScript\(uiSrc\);\s*preloadScript\(clerkSrc\);/);
  assert.match(authSource, /await loadScript\(uiSrc, clerkAttributes\);\s*await loadScript\(clerkSrc,/);
  assert.doesNotMatch(authSource, /Promise\.all\(\[\s*loadScript\(uiSrc/);
});

test("application route code preloads while Clerk initializes", () => {
  assert.match(authSource, /if \(!isPublicPath\(pathname\) && !isProtectedPath\(pathname\)\) return/);
  assert.match(authSource, /pathname === "\/" \|\| pathname\.startsWith\("\/home"\)[\s\S]{0,120}"\/home\.js"/);
  assert.match(authSource, /pathname\.startsWith\("\/vocab"\)[\s\S]{0,120}"\/vocab\.js"/);
  assert.match(authSource, /pathname\.startsWith\("\/about"\)[\s\S]{0,120}"\/about\.js"/);
  assert.match(authSource, /for \(const href of \["\/router\.js", routeModule\]\)/);
  assert.match(authSource, /link\.rel = "modulepreload"/);
  assert.match(authSource, /const pathname = window\.location\.pathname;[\s\S]{0,300}preloadApplicationRoute\(pathname\);[\s\S]{0,120}fetch\("\/api\/auth-config"\)/);
});

test("signed-out authentication routes mount Clerk instead of entering the app router", () => {
  assert.match(authSource, /!window\.Clerk\.isSignedIn && \(isProtectedPath\(pathname\) \|\| isAuthenticationPath\(pathname\)\)/);
  assert.match(authSource, /if \(signingUp\) \{[\s\S]{0,500}mountSignUp[\s\S]{0,500}mountSignIn/);
});

test("multiple-choice answers update immediately and save without reloading the module", () => {
  assert.match(appSource, /row\.answer = target\.value;\s*render\(\);\s*queueAnswerSave\(row\.row_id, target\.value\);/);
  assert.doesNotMatch(appSource, /if \(target\.matches\("\[data-answer\]"\)\)[\s\S]{0,300}await saveAnswer\(row\.row_id, target\.value\)/);
});

test("flagging is optimistic and question prefetching stays bounded", () => {
  assert.match(appSource, /row\.module_flagged = Boolean\(flagged\);[\s\S]{0,300}state\.flagSavePromises\[rowId\] = request;\s*render\(\);/);
  assert.doesNotMatch(appSource, /async function saveFlag[\s\S]{0,600}reloadModule/);
  assert.match(appSource, /prefetchQuestion\(state\.currentIndex \+ 1\)/);
  assert.doesNotMatch(appSource, /prefetchQuestion\(state\.currentIndex \+ 2\)/);
});

test("module question content is seeded once for instant navigation", () => {
  assert.match(appSource, /Object\.assign\(state\.questionDetails, state\.module\?\.questionDetails \|\| \{\}\)/);
  assert.match(appSource, /state\.module = await api\.(?:get|postScoped)[\s\S]{0,500}seedModuleQuestionDetails\(\)/);
});

test("module mutations send only contract fields while catalog actions add explicit scope", () => {
  assert.match(appSource, /body: JSON\.stringify\(body\)/);
  assert.match(appSource, /async postScoped\(path, body = \{\}\)/);
  assert.match(appSource, /api\.post\(`\/api\/modules\/\$\{state\.module\.id\}\/flag`, \{ rowId, flagged: Boolean\(flagged\) \}\)/);
  assert.match(appSource, /api\.post\(`\/api\/modules\/\$\{state\.module\.id\}\/answers`, \{ rowId, answer, flagged \}\)/);
  assert.match(appSource, /api\.postScoped\("\/api\/modules", options\)/);
  assert.match(appSource, /api\.postScoped\("\/api\/reset-progress"\)/);
});

test("browser-rendered user and upstream text crosses an escaping or sanitizing boundary", () => {
  assert.match(authSource, /import \{ escapeHtml \} from "\/shared\/browser\.js"/);
  assert.match(appSource, /import \{ escapeHtml, requestJson \} from "\/shared\/browser\.js"/);
  assert.match(vocabSource, /import \{ escapeHtml, requestJson \} from "\/shared\/browser\.js"/);
  assert.match(appSource, /normalizeDisplayHtml\(content\.stem\)/);
  assert.match(appSource, /escapeHtml\(row\.question_id \|\| row\.row_id\)/);
  assert.match(vocabSource, /escapeHtml\(item\.term\)/);
  assert.match(vocabSource, /escapeHtml\(item\.definition\)/);
  assert.doesNotMatch(`${authSource}\n${appSource}\n${vocabSource}\n${browserSource}`, /\beval\s*\(|new Function\s*\(/);
});
