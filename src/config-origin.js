import { runGit } from "./git.js";
import { stripControlChars } from "./sanitize.js";

/**
 * @typedef {"system" | "global" | "local" | "worktree" | "command" | "unknown"} GitConfigScope
 */

/**
 * @typedef {object} ConfigEntry
 * @property {GitConfigScope} scope
 * @property {string} origin
 * @property {string} key
 * @property {string} value
 */

/**
 * @typedef {object} ConfigOriginSummary
 * @property {ConfigEntry[]} hooksPathEntries
 * @property {ConfigEntry | null} effectiveHooksPath
 * @property {boolean | null} coreFileMode
 * @property {boolean | null} adviceIgnoredHook
 * @property {boolean} degradedScope
 */

/**
 * Normalize raw scope token from `git config --show-scope`.
 * @param {string} raw
 * @returns {GitConfigScope}
 */
function normalizeScope(raw) {
  const s = raw.trim().toLowerCase();
  if (s === "system" || s === "global" || s === "local" || s === "worktree" || s === "command") {
    return s;
  }
  return "unknown";
}

/**
 * Parse NUL-delimited `git config --list --null` output with `--show-origin` (and optionally `--show-scope`).
 * @param {string} stdout
 * @param {boolean} hasScope
 * @returns {ConfigEntry[]}
 */
export function parseGitConfigNullOutput(stdout, hasScope) {
  const tokens = stdout.split("\0");
  /** @type {ConfigEntry[]} */
  const entries = [];
  const step = hasScope ? 3 : 2;

  for (let i = 0; i + step - 1 < tokens.length; i += step) {
    const scope = hasScope ? normalizeScope(tokens[i] ?? "") : "unknown";
    const rawOrigin = tokens[hasScope ? i + 1 : i] ?? "";
    const keyVal = tokens[hasScope ? i + 2 : i + 1] ?? "";
    if (!keyVal && !rawOrigin) continue;

    const nlIdx = keyVal.indexOf("\n");
    const rawKey = nlIdx === -1 ? keyVal : keyVal.slice(0, nlIdx);
    const rawVal = nlIdx === -1 ? "true" : keyVal.slice(nlIdx + 1);

    const origin = stripControlChars(
      rawOrigin.startsWith("file:") ? rawOrigin.slice(5) : rawOrigin
    );

    entries.push({
      scope,
      origin,
      key: stripControlChars(rawKey.trim().toLowerCase()),
      value: stripControlChars(rawVal),
    });
  }

  return entries;
}

/**
 * Parse git boolean config value (`true`/`yes`/`on`/`1` vs `false`/`no`/`off`/`0`).
 * @param {string} val
 * @returns {boolean | null}
 */
function parseGitBool(val) {
  const v = val.trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "on" || v === "1") return true;
  if (v === "false" || v === "no" || v === "off" || v === "0" || v === "") return false;
  return null;
}

/**
 * Read `core.hooksPath`, `core.fileMode`, and `advice.ignoredHook` with their origins and scopes.
 * @param {string} cwd
 * @param {import("./git.js").GitVersion} gitVersion
 * @param {{ gitRunner?: import("./git.js").GitRunner, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<ConfigOriginSummary>}
 */
export async function readConfigOrigins(cwd, gitVersion, options = {}) {
  const runner = options.gitRunner ?? runGit;
  const env = options.env ?? process.env;

  const args = ["config", "--list", "--null", "--show-origin"];
  if (gitVersion.supportsShowScope) {
    args.push("--show-scope");
  }

  const res = await runner(args, { cwd, env });
  const entries = parseGitConfigNullOutput(res.stdout, gitVersion.supportsShowScope);

  const hooksPathEntries = entries.filter((e) => e.key === "core.hookspath");
  const effectiveHooksPath =
    hooksPathEntries.length > 0 ? (hooksPathEntries[hooksPathEntries.length - 1] ?? null) : null;

  let coreFileMode = null;
  let adviceIgnoredHook = null;
  for (const entry of entries) {
    if (entry.key === "core.filemode") {
      coreFileMode = parseGitBool(entry.value);
    } else if (entry.key === "advice.ignoredhook") {
      adviceIgnoredHook = parseGitBool(entry.value);
    }
  }

  return {
    hooksPathEntries,
    effectiveHooksPath,
    coreFileMode,
    adviceIgnoredHook,
    degradedScope: !gitVersion.supportsShowScope,
  };
}
