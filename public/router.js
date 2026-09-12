if (window.location.pathname === "/" || window.location.pathname.startsWith("/home")) {
  import("/home.js");
} else if (window.location.pathname.startsWith("/about")) {
  import("/about.js");
} else if (window.location.pathname.startsWith("/vocab")) {
  import("/vocab.js");
} else {
  import("/app.js");
}
