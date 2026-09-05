import { escapeHtml } from "/shared/browser.js";
import {
  SIGN_IN_PATH,
  clerkLoadOptions,
  isAuthenticationPath,
  isKnownPath,
  isProtectedPath,
  subscribeToSignOut
} from "/shared/auth-runtime.js";

const app = document.querySelector("#app");
const CLERK_JS_VERSION = "6.29.3";
const CLERK_UI_VERSION = "1.29.1";

function renderMessage(title, detail) {
  app.innerHTML = `
    <main class="auth-page" id="main-content">
      <section class="auth-message" role="alert">
        <span class="auth-mark">SAT</span>
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

async function loadClerk(config) {
  const proxyUrl = String(config.proxyUrl || "").replace(/\/+$/, "");
  const base = proxyUrl || `https://${config.frontendApi}`;
  const clerkAttributes = {
    "data-clerk-publishable-key": config.publishableKey,
    ...(proxyUrl ? { "data-clerk-proxy-url": proxyUrl } : {})
  };
  await loadScript(`${base}/npm/@clerk/ui@${CLERK_UI_VERSION}/dist/ui.browser.js`, clerkAttributes);
  await loadScript(`${base}/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`, {
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
        <section class="auth-intro">
          <span class="auth-mark">SAT</span>
          <h1>SAT Practice</h1>
          <p>A focused place for practice tests, question review, and vocabulary study.</p>
          <div class="auth-actions" aria-label="Account options">
            <a class="auth-action primary" href="/sign-in">Continue to sign in</a>
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
      <section class="auth-intro">
        <span class="auth-mark">SAT</span>
        <h1>${signingUp ? "Create your study account." : "Welcome back."}</h1>
        <p>${signingUp
          ? "Keep your practice history and vocabulary progress together."
          : "Continue to your SAT practice workspace."}</p>
      </section>
      <section class="auth-panel" aria-label="${signingUp ? "Create account" : "Sign in"}">
        <div id="clerk-authentication"></div>
      </section>
    </main>
  `;
  const target = document.querySelector("#clerk-authentication");
  const appearance = {
    elements: {
      rootBox: { width: "100%", maxWidth: "100%", minWidth: "0" },
      cardBox: { width: "100%", maxWidth: "100%", minWidth: "0" },
      card: { width: "100%", maxWidth: "100%", minWidth: "0" }
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
  try {
    if (!isKnownPath(window.location.pathname)) {
      renderNotFound();
      return;
    }

    const response = await fetch("/api/auth-config");
    const payload = await response.json();
    if (!response.ok || !payload.success || !payload.data?.configured) {
      renderMessage("Authentication is not configured", "Add the Clerk environment variables, then restart or redeploy the app.");
      return;
    }

    await loadClerk(payload.data);
    if (!window.Clerk.isSignedIn) {
      renderAuthentication();
      return;
    }

    if (isAuthenticationPath(window.location.pathname)) {
      window.location.replace("/");
      return;
    }

    monitorSignOut();
    const observer = new MutationObserver(mountUserButton);
    observer.observe(app, { childList: true, subtree: true });
    await import("/router.js");
    mountUserButton();
  } catch (error) {
    console.error(error);
    renderMessage("Unable to start sign-in", "Check the Clerk configuration and your network connection, then reload the page.");
  }
}

start();
