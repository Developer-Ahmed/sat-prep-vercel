const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

if (!localHosts.has(window.location.hostname)) {
  window.va = window.va || function queueAnalyticsEvent(...args) {
    window.vaq = window.vaq || [];
    window.vaq.push(args);
  };

  window.va("beforeSend", (event) => {
    try {
      const url = new URL(event.url);
      url.search = "";
      url.hash = "";
      return { ...event, url: url.toString() };
    } catch {
      return event;
    }
  });

  const script = document.createElement("script");
  script.src = "/_vercel/insights/script.js";
  script.defer = true;
  script.dataset.sdkn = "@vercel/analytics";
  document.head.appendChild(script);
}
