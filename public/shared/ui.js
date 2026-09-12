const navigationItems = Object.freeze([
  { key: "home", label: "Home", shortLabel: "Home", href: "/" },
  { key: "math", label: "Math", shortLabel: "Math", href: "/math" },
  { key: "english", label: "Reading & Writing", shortLabel: "R&W", href: "/english" },
  { key: "vocab", label: "Vocabulary", shortLabel: "Vocab", href: "/vocab" },
  { key: "about", label: "About", shortLabel: "About", href: "/about" }
]);

export function renderBrand({ compact = false } = {}) {
  return `
    <span class="product-symbol" aria-hidden="true">
      <svg viewBox="0 0 36 36" focusable="false">
        <path class="product-symbol-primary" d="M3 29 14.7 8.4c.7-1.2 2.4-1.2 3.1 0l7 12.1-4 7-4.5-7.8L11 29Z"></path>
        <path class="product-symbol-accent" d="m19.2 29 7-12.2c.7-1.2 2.4-1.2 3.1 0L36 29h-6.5l-1.8-3.2-1.9 3.2Z"></path>
      </svg>
    </span>
    <strong class="product-name"><span>PEAK</span><b>1600</b></strong>
    ${compact ? "" : '<span class="product-tagline">SAT practice</span>'}
  `;
}

export function renderAppNavigation(active) {
  const signedIn = Boolean(window.Clerk?.isSignedIn);
  const account = window.Clerk?.isSignedIn
    ? '<div class="account-control" data-auth-user-button aria-label="Account"></div>'
    : '<div class="account-control" data-auth-user-button aria-label="Account"><a class="nav-sign-in" href="/sign-in" data-auth-fallback>Sign in</a></div>';
  return `
    <header class="top-navigation">
      <a class="product-lockup" href="/" aria-label="PEAK1600 home">
        ${renderBrand({ compact: true })}
      </a>
      <nav class="subject-tabs" aria-label="Primary navigation">
        ${navigationItems.map((item) => `
          <a class="${item.key === active ? "active" : ""}" href="${item.href}" aria-label="${item.label}" ${item.key === active ? 'aria-current="page"' : ""}>
            <span class="nav-label-full" aria-hidden="true">${item.label}</span>
            <span class="nav-label-short" aria-hidden="true">${item.shortLabel}</span>
          </a>
        `).join("")}
      </nav>
      <div class="account-area">
        ${signedIn ? '<span class="connection-status"><i aria-hidden="true"></i>Saved</span>' : ""}
        ${renderThemeToggle()}
        ${account}
      </div>
    </header>
  `;
}

export function renderThemeToggle() {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const nextTheme = theme === "light" ? "dark" : "light";
  return `
    <button class="theme-toggle" type="button" role="switch" aria-checked="${theme === "light"}" aria-label="Switch to ${nextTheme} mode" title="Switch to ${nextTheme} mode" data-theme-toggle>
      <span class="theme-toggle-track" aria-hidden="true"><i></i></span>
      <span data-theme-label>${theme === "light" ? "Light" : "Dark"}</span>
    </button>
  `;
}
