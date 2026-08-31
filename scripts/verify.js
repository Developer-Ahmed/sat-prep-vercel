import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDirectories = ["api", "public", "scripts", "server", "test"];

async function filesUnder(path) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(target));
    else output.push(target);
  }
  return output;
}

function command(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
  process.stdout.write(result.stdout || "");
}

const files = (await Promise.all(sourceDirectories.map((directory) => filesUnder(resolve(rootDir, directory))))).flat();
for (const file of files.filter((file) => extname(file) === ".js")) {
  command(process.execPath, ["--check", file]);
}

for (const file of files.filter((file) => file.includes(`${join(rootDir, "public")}/`))) {
  const source = await readFile(file, "utf8").catch(() => "");
  if (/DATABASE_(?:ADMIN_)?URL|CLERK_SECRET_KEY|CLERK_WEBHOOK_SIGNING_SECRET|\b(?:sk_(?:test|live)|whsec)_[A-Za-z0-9+/=_-]{16,}/.test(source)) {
    throw new Error(`Public asset references a server secret: ${relative(rootDir, file)}`);
  }
}

const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(resolve(rootDir, "package-lock.json"), "utf8"));
const lockedDependencies = packageLock.packages?.[""]?.dependencies || {};
if (JSON.stringify(packageJson.dependencies) !== JSON.stringify(lockedDependencies)) {
  throw new Error("package.json dependencies do not match package-lock.json.");
}
JSON.parse(await readFile(resolve(rootDir, "vercel.json"), "utf8"));

command(process.execPath, ["--test"]);
command(process.platform === "win32" ? "npm.cmd" : "npm", ["ls", "--omit=dev"]);
console.log(`Release verification passed (${files.filter((file) => extname(file) === ".js").length} JavaScript files checked).`);
