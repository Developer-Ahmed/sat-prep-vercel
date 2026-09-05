import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authSource = await readFile(new URL("../public/auth.js", import.meta.url), "utf8");
const authRuntimeSource = await readFile(new URL("../public/shared/auth-runtime.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const vocabSource = await readFile(new URL("../public/vocab.js", import.meta.url), "utf8");
const browserSource = await readFile(new URL("../public/shared/browser.js", import.meta.url), "utf8");

test("Clerk browser dependencies are reproducibly pinned", () => {
  assert.match(authSource, /CLERK_JS_VERSION = "\d+\.\d+\.\d+"/);
  assert.match(authSource, /CLERK_UI_VERSION = "\d+\.\d+\.\d+"/);
  assert.doesNotMatch(authSource, /@clerk\/(?:ui|clerk-js)@(?:latest|\d+)\//);
  assert.match(authSource, /data-clerk-proxy-url/);
  assert.match(authRuntimeSource, /proxyUrl \? \{ proxyUrl \} : \{\}/);
  assert.match(authRuntimeSource, /afterSignOutUrl: SIGN_IN_PATH/);
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
