import { escapeHtml } from "/shared/browser.js";
import {
  SIGN_IN_PATH,
  clerkLoadOptions,
  isAuthenticationPath,
  isKnownPath,
  isPublicPath,
  isProtectedPath,
  subscribeToSignOut
} from "/shared/auth-runtime.js";
import { renderBrand, renderThemeToggle } from "/shared/ui.js";

const app = document.querySelector("#app");
const CLERK_JS_VERSION = "6.29.3";
const CLERK_UI_VERSION = "1.29.1";

function renderMessage(title, detail) {
  app.innerHTML = `
    <main class="auth-page" id="main-content">
      <section class="auth-message" role="alert">
        <span class="auth-mark">P</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(detail)}</p>
      </section>
    </main>
  `;
}

function renderNotFound() {
  app.innerHTML = `
    <main class="auth-page auth-welcome" id="main-content">
      <section class="auth-message" role="alert">
        <span class="auth-mark">404</span>
        <h1>Page not found.</h1>
        <p>The page you requested does not exist.</p>
        <div class="auth-actions">
          <a class="auth-action primary" href="/">Return home</a>
        </div>
      </section>
    </main>
  `;
}

function renderAuthProgressArt() {
  return `
    <div class="auth-progress-art" aria-hidden="true">
      <div class="auth-progress-heading"><span>Your work adds up</span><strong>1600</strong></div>
      <svg viewBox="0 0 560 280" role="presentation">
        <g class="auth-progress-grid">
          <path d="M34 38H526"></path>
          <path d="M34 100H526"></path>
          <path d="M34 162H526"></path>
          <path d="M34 224H526"></path>
        </g>
        <g class="auth-progress-axis">
          <text x="0" y="42">1600</text>
          <text x="0" y="104">1200</text>
          <text x="0" y="166">800</text>
          <text x="0" y="228">400</text>
        </g>
        <path class="auth-progress-line" d="M44 220C105 220 118 193 168 190S246 166 284 157s58-44 105-48 62-58 126-66"></path>
        <g class="auth-progress-points">
          <circle cx="44" cy="220" r="5"></circle>
          <circle cx="168" cy="190" r="5"></circle>
          <circle cx="284" cy="157" r="5"></circle>
          <circle cx="389" cy="109" r="5"></circle>
          <circle cx="515" cy="43" r="7"></circle>
        </g>
      </svg>
      <div class="auth-progress-steps"><span>Practice</span><span>Understand</span><span>Return</span></div>
    </div>
  `;
}

function loadScript(src, attributes = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.crossOrigin = "anonymous";
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Unable to load ${src}`)), { once: true });
    document.head.append(script);
  });
}

function preloadScript(src) {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "script";
  link.href = src;
  link.crossOrigin = "anonymous";
  document.head.append(link);
}

function preloadApplicationRoute(pathname) {
  if (!isPublicPath(pathname) && !isProtectedPath(pathname)) return;
  const routeModule = pathname === "/" || pathname.startsWith("/home")
    ? "/home.js"
    : pathname.startsWith("/vocab")
    ? "/vocab.js"
    : pathname.startsWith("/about")
      ? "/about.js"
      : "/app.js";
  for (const href of ["/router.js", routeModule]) {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.append(link);
  }
}

async function loadClerk(config) {
  const proxyUrl = String(config.proxyUrl || "").replace(/\/+$/, "");
  const base = proxyUrl || `https://${config.frontendApi}`;
  const uiSrc = `${base}/npm/@clerk/ui@${CLERK_UI_VERSION}/dist/ui.browser.js`;
  const clerkSrc = `${base}/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`;
  const clerkAttributes = {
    "data-clerk-publishable-key": config.publishableKey,
    ...(proxyUrl ? { "data-clerk-proxy-url": proxyUrl } : {})
  };
  preloadScript(uiSrc);
  preloadScript(clerkSrc);
  await loadScript(uiSrc, clerkAttributes);
  await loadScript(clerkSrc, {
    ...clerkAttributes
  });
  await window.Clerk.load(clerkLoadOptions({
    ClerkUI: window.__internal_ClerkUICtor,
    proxyUrl
  }));
}

function renderAuthentication() {
  if (isProtectedPath(window.location.pathname)) {
    app.innerHTML = `
      <main class="auth-page auth-welcome" id="main-content">
        <section class="auth-brand-pane">
          <a class="product-lockup auth-product" href="/" aria-label="PEAK1600 home">${renderBrand()}</a>
          ${renderAuthProgressArt()}
          <div class="auth-copy">
            <span class="section-kicker">Practice with a plan</span>
            <h1>Know what to work on next.</h1>
            <p>Your questions, review, timing, and vocabulary stay together.</p>
          </div>
        </section>
        <section class="auth-entry-pane" aria-label="Account access">
          <div class="auth-theme-control">${renderThemeToggle()}</div>
          <div class="auth-intro auth-entry-card">
            <span class="section-kicker">Your study record</span>
            <h2>Continue to PEAK1600</h2>
            <p>Sign in to return to your questions, tests, and vocabulary progress.</p>
          </div>
          <div class="auth-actions" aria-label="Account options">
            <a class="auth-action primary" href="/sign-in">Sign in</a>
            <a class="auth-action secondary" href="/sign-up">Create account</a>
          </div>
        </section>
      </main>
    `;
    return;
  }

  const signingUp = window.location.pathname === "/sign-up"
    || window.location.pathname.startsWith("/sign-up/");
  app.innerHTML = `
    <main class="auth-page" id="main-content">
      <section class="auth-brand-pane">
        <a class="product-lockup auth-product" href="/" aria-label="PEAK1600 home">${renderBrand()}</a>
        ${renderAuthProgressArt()}
        <div class="auth-copy">
          <span class="section-kicker">Practice with a plan</span>
          <h1>Know what to work on next.</h1>
          <p>Practice, understand what happened, and come back to the work that still matters.</p>
        </div>
      </section>
      <section class="auth-entry-pane" aria-label="${signingUp ? "Create account" : "Sign in"}">
        <div class="auth-theme-control">${renderThemeToggle()}</div>
        <nav class="auth-mode-switch" aria-label="Account action">
          <a class="${signingUp ? "" : "active"}" href="/sign-in">Sign in</a>
          <a class="${signingUp ? "active" : ""}" href="/sign-up">Create account</a>
        </nav>
        <div class="auth-panel">
          <div class="auth-panel-title">
            <span class="section-kicker">Secure account</span>
            <h2>${signingUp ? "Create your account" : "Welcome back"}</h2>
          </div>
          <div id="clerk-authentication"></div>
        </div>
      </section>
    </main>
  `;
  const target = document.querySelector("#clerk-authentication");
  const appearance = {
    variables: {
      colorPrimary: "var(--teal)",
      colorBackground: "var(--panel)",
      colorInputBackground: "var(--panel-soft)",
      colorInputText: "var(--text)",
      colorText: "var(--text)",
      colorTextSecondary: "var(--muted)",
      colorNeutral: "var(--text)",
      borderRadius: "8px"
    },
    elements: {
      rootBox: { width: "100%", maxWidth: "100%", minWidth: "0" },
      cardBox: { width: "100%", maxWidth: "100%", minWidth: "0", boxShadow: "none" },
      card: { width: "100%", maxWidth: "100%", minWidth: "0", boxShadow: "var(--shadow-small)", border: "1px solid var(--line)", padding: "24px", background: "var(--panel)" },
      header: { display: "none" },
      main: { width: "100%", maxWidth: "100%", minWidth: "0" },
      form: { width: "100%", maxWidth: "100%", minWidth: "0" },
      formFieldRow: { width: "100%", maxWidth: "100%", minWidth: "0" },
      footerAction: { display: "none" },
      footer: { background: "transparent" },
      socialButtonsBlockButton: { borderColor: "var(--line)", minHeight: "44px" },
      formButtonPrimary: { minHeight: "44px", fontWeight: "700" },
      formFieldInput: { borderColor: "var(--line)" },
      dividerLine: { background: "var(--line)" }
    }
  };
  if (signingUp) {
    window.Clerk.mountSignUp(target, {
      appearance,
      routing: "path",
      path: "/sign-up",
      signInUrl: "/sign-in",
      forceRedirectUrl: "/"
    });
  } else {
    window.Clerk.mountSignIn(target, {
      appearance,
      routing: "path",
      path: "/sign-in",
      signUpUrl: "/sign-up",
      forceRedirectUrl: "/"
    });
  }
}

let mountedUserButton = null;
function mountUserButton() {
  const target = document.querySelector("[data-auth-user-button]");
  if (!target || target === mountedUserButton || !window.Clerk?.isSignedIn) return;
  mountedUserButton = target;
  target.querySelector("[data-auth-fallback]")?.remove();
  window.Clerk.mountUserButton(target, {
    appearance: { elements: { avatarBox: { width: "32px", height: "32px" } } }
  });
}

function monitorSignOut() {
  const unsubscribe = subscribeToSignOut(window.Clerk, () => {
    window.location.replace(SIGN_IN_PATH);
  });
  window.addEventListener("pagehide", unsubscribe, { once: true });
}

async function start() {
  const pathname = window.location.pathname;
  const publicRoute = isPublicPath(pathname);
  try {
    if (!isKnownPath(pathname)) {
      renderNotFound();
      return;
    }

    preloadApplicationRoute(pathname);
    if (publicRoute) await import("/router.js");
    const response = await fetch("/api/auth-config");
    const payload = await response.json();
    if (!response.ok || !payload.success || !payload.data?.configured) {
      if (publicRoute) return;
      renderMessage("Authentication is not configured", "Add the Clerk environment variables, then restart or redeploy the app.");
      return;
    }

    await loadClerk(payload.data);
    if (!window.Clerk.isSignedIn && (isProtectedPath(pathname) || isAuthenticationPath(pathname))) {
      renderAuthentication();
      return;
    }

    if (window.Clerk.isSignedIn && isAuthenticationPath(pathname)) {
      window.location.replace("/");
      return;
    }

    if (window.Clerk.isSignedIn) monitorSignOut();
    const observer = new MutationObserver(mountUserButton);
    observer.observe(app, { childList: true, subtree: true });
    if (!publicRoute) await import("/router.js");
    mountUserButton();
  } catch (error) {
    console.error(error);
    if (publicRoute) return;
    renderMessage("Unable to start sign-in", "Check the Clerk configuration and your network connection, then reload the page.");
  }
}

start();
