export const SIGN_IN_PATH = "/sign-in";
export const PUBLIC_ROUTE_ROOTS = Object.freeze(["/", "/home", "/about"]);
export const PROTECTED_ROUTE_ROOTS = Object.freeze(["/math", "/english", "/new", "/vocab"]);

function matchesRoute(pathname, route) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isAuthenticationPath(pathname) {
  return matchesRoute(pathname, SIGN_IN_PATH) || matchesRoute(pathname, "/sign-up");
}

export function isProtectedPath(pathname) {
  return PROTECTED_ROUTE_ROOTS.includes(pathname);
}

export function isPublicPath(pathname) {
  return PUBLIC_ROUTE_ROOTS.includes(pathname);
}

export function isKnownPath(pathname) {
  return isPublicPath(pathname) || isProtectedPath(pathname) || isAuthenticationPath(pathname);
}

export function clerkLoadOptions({ ClerkUI, proxyUrl = "" }) {
  return {
    ui: { ClerkUI },
    afterSignOutUrl: SIGN_IN_PATH,
    ...(proxyUrl ? { proxyUrl } : {})
  };
}

export function subscribeToSignOut(clerk, onSignOut) {
  let handled = false;
  return clerk.addListener(({ session, user }) => {
    if (handled || session !== null || user !== null) return;
    handled = true;
    onSignOut();
  });
}
