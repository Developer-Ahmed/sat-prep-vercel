(() => {
  const storageKey = "peak1600-theme";
  const root = document.documentElement;

  function storedTheme() {
    try {
      const value = window.localStorage.getItem(storageKey);
      return value === "light" || value === "dark" ? value : "";
    } catch {
      return "";
    }
  }

  function updateControls(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const isLight = theme === "light";
      button.setAttribute("aria-checked", String(isLight));
      button.setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} mode`);
      button.title = `Switch to ${isLight ? "dark" : "light"} mode`;
      const label = button.querySelector("[data-theme-label]");
      const labelText = isLight ? "Light" : "Dark";
      if (label && label.textContent !== labelText) label.textContent = labelText;
    });
  }

  function applyTheme(theme, persist = false) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f8f7f3" : "#111714");
    if (persist) {
      try {
        window.localStorage.setItem(storageKey, theme);
      } catch {
        // The active theme still works when storage is unavailable.
      }
    }
    updateControls(theme);
  }

  applyTheme(storedTheme() || "light");

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-theme-toggle]")) return;
    applyTheme(root.dataset.theme === "light" ? "dark" : "light", true);
  });

  document.addEventListener("DOMContentLoaded", () => updateControls(root.dataset.theme));
})();
