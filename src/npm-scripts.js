import path from "node:path";
import { safeReadFile, sanitizeSnippet } from "./sanitize.js";

const BUILTIN_PM_COMMANDS = new Set([
  "install",
  "i",
  "ci",
  "add",
  "remove",
  "rm",
  "uninstall",
  "update",
  "up",
  "upgrade",
  "exec",
  "dlx",
  "create",
  "init",
  "publish",
  "pack",
  "login",
  "logout",
  "whoami",
  "config",
  "env",
  "store",
  "why",
  "list",
  "ls",
  "outdated",
  "audit",
  "link",
  "unlink",
  "workspace",
  "workspaces",
  "cache",
  "version",
  "help",
  "run",
  "run-script",
  "test",
  "t",
]);

/**
 * @typedef {object} ScriptReference
 * @property {string} scriptName
 * @property {"npm" | "pnpm" | "yarn"} runner
 * @property {number} line
 * @property {"high" | "low"} confidence
 * @property {string} snippet
 */

/**
 * @typedef {object} PackageJsonInfo
 * @property {boolean} exists
 * @property {boolean} valid
 * @property {Record<string, string>} scripts
 * @property {Record<string, string>} dependencies
 * @property {Record<string, string>} devDependencies
 * @property {Record<string, unknown> | null} simpleGitHooksConfig
 */

/**
 * Safely read and parse `package.json` from `repoRoot`.
 * @param {string | null} repoRoot
 * @returns {PackageJsonInfo}
 */
export function readPackageJson(repoRoot) {
  const empty = {
    exists: false,
    valid: false,
    scripts: Object.create(null),
    dependencies: Object.create(null),
    devDependencies: Object.create(null),
    simpleGitHooksConfig: null,
  };
  if (!repoRoot) return empty;

  const pkgPath = path.join(repoRoot, "package.json");
  const read = safeReadFile(pkgPath, { allowedRoots: [repoRoot], maxBytes: 262144 });
  if (!read.ok) return empty;

  try {
    const parsed = JSON.parse(read.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...empty, exists: true, valid: false };
    }
    const toStringMap = (/** @type {unknown} */ obj) => {
      /** @type {Record<string, string>} */
      const out = Object.create(null);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
          if (typeof v === "string") out[k] = v;
        }
      }
      return out;
    };

    const sghRaw = /** @type {Record<string, unknown>} */ (parsed)["simple-git-hooks"];
    const simpleGitHooksConfig =
      sghRaw && typeof sghRaw === "object" && !Array.isArray(sghRaw)
        ? /** @type {Record<string, unknown>} */ (sghRaw)
        : null;

    return {
      exists: true,
      valid: true,
      scripts: toStringMap(/** @type {Record<string, unknown>} */ (parsed).scripts),
      dependencies: toStringMap(/** @type {Record<string, unknown>} */ (parsed).dependencies),
      devDependencies: toStringMap(/** @type {Record<string, unknown>} */ (parsed).devDependencies),
      simpleGitHooksConfig,
    };
  } catch {
    return { ...empty, exists: true, valid: false };
  }
}

/**
 * Extract `npm run <name>`, `npm test`, `pnpm <name>`, and `yarn <name>` script references.
 * Uses linear-time tokenization per line (no backtracking regexes).
 * @param {string} content
 * @returns {ScriptReference[]}
 */
export function extractScriptReferences(content) {
  /** @type {ScriptReference[]} */
  const refs = [];
  const lines = content.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx] ?? "";
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Tokenize on whitespace and common shell separators without regex backtracking.
    const tokens = trimmed.split(/[\s;&|()]+/).filter((t) => t.length > 0);
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (tok !== "npm" && tok !== "pnpm" && tok !== "yarn") continue;

      const next = tokens[i + 1];
      if (!next) continue;

      // Strip trailing/leading quotes from script name candidate
      const cleanNext = next.replace(/^['"]|['"]$/g, "");
      if (!cleanNext || cleanNext.startsWith("-")) continue;

      if (tok === "npm") {
        if (cleanNext === "run" || cleanNext === "run-script") {
          const target = (tokens[i + 2] ?? "").replace(/^['"]|['"]$/g, "");
          if (target && !target.startsWith("-")) {
            refs.push({
              scriptName: sanitizeSnippet(target, 80),
              runner: "npm",
              line: idx + 1,
              confidence: "high",
              snippet: sanitizeSnippet(trimmed, 80),
            });
          }
        } else if (cleanNext === "test" || cleanNext === "t") {
          refs.push({
            scriptName: "test",
            runner: "npm",
            line: idx + 1,
            confidence: "high",
            snippet: sanitizeSnippet(trimmed, 80),
          });
        }
      } else if (tok === "pnpm" || tok === "yarn") {
        if (cleanNext === "run" || cleanNext === "run-script") {
          const target = (tokens[i + 2] ?? "").replace(/^['"]|['"]$/g, "");
          if (target && !target.startsWith("-")) {
            refs.push({
              scriptName: sanitizeSnippet(target, 80),
              runner: tok,
              line: idx + 1,
              confidence: "high",
              snippet: sanitizeSnippet(trimmed, 80),
            });
          }
        } else if (cleanNext === "test" || cleanNext === "t") {
          refs.push({
            scriptName: "test",
            runner: tok,
            line: idx + 1,
            confidence: "high",
            snippet: sanitizeSnippet(trimmed, 80),
          });
        } else if (!BUILTIN_PM_COMMANDS.has(cleanNext)) {
          // `pnpm lint` or `yarn lint` could be a script or a binary in node_modules/.bin
          refs.push({
            scriptName: sanitizeSnippet(cleanNext, 80),
            runner: tok,
            line: idx + 1,
            confidence: "low",
            snippet: sanitizeSnippet(trimmed, 80),
          });
        }
      }
    }
  }

  return refs;
}
