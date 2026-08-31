import { isAbsolute, relative, resolve } from "node:path";

export function resolvePublicPath(publicDirectory, pathname) {
  const safePath = pathname === "/" ? "/index.html" : String(pathname || "");
  const filePath = resolve(publicDirectory, `.${safePath}`);
  const relativePath = relative(publicDirectory, filePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return filePath;
}
