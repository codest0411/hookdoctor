import path from "node:path";
import { formatDisplayPath, safeReadFile } from "./sanitize.js";

/**
 * @typedef {object} NpmrcAndEnvSummary
 * @property {boolean} projectIgnoreScripts
 * @property {string | null} projectNpmrcPath
 * @property {boolean} userIgnoreScripts
 * @property {string | null} userNpmrcPath
 * @property {{ huskyDisabled: boolean, npmIgnoreScripts: boolean, ci: boolean }} envFlags
 */

/**
 * Parse `.npmrc` content line-by-line for `ignore-scripts=true`.
 * @param {string} content
 * @returns {boolean}
 */
export function parseNpmrcIgnoreScripts(content) {
  const lines = content.split(/\r?\n/);
  let ignoreScripts = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim().toLowerCase();
    if (key === "ignore-scripts") {
      ignoreScripts = val === "true";
    }
  }
  return ignoreScripts;
}

/**
 * Inspect project `.npmrc`, user `~/.npmrc`, and relevant environment flags.
 * Never exposes or returns raw environment variable values.
 * @param {string | null} repoRoot
 * @param {string | null} homeDir
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {NpmrcAndEnvSummary}
 */
export function readNpmrcAndEnv(repoRoot, homeDir, env = process.env) {
  let projectIgnoreScripts = false;
  let projectNpmrcPath = null;
  if (repoRoot) {
    const candidate = path.join(repoRoot, ".npmrc");
    const res = safeReadFile(candidate, { allowedRoots: [repoRoot], maxBytes: 32768 });
    if (res.ok) {
      projectNpmrcPath = formatDisplayPath(candidate, repoRoot, homeDir);
      projectIgnoreScripts = parseNpmrcIgnoreScripts(res.content);
    }
  }

  let userIgnoreScripts = false;
  let userNpmrcPath = null;
  if (homeDir) {
    const candidate = path.join(homeDir, ".npmrc");
    const res = safeReadFile(candidate, {
      allowedRoots: [],
      allowedExactFiles: [candidate],
      maxBytes: 32768,
    });
    if (res.ok) {
      userNpmrcPath = formatDisplayPath(candidate, repoRoot, homeDir);
      userIgnoreScripts = parseNpmrcIgnoreScripts(res.content);
    }
  }

  const huskyDisabled = env.HUSKY === "0";
  const npmIgnoreScripts =
    env.npm_config_ignore_scripts === "true" || env.npm_config_ignore_scripts === "1";
  const ciVal = (env.CI ?? "").trim().toLowerCase();
  const ci = ciVal.length > 0 && ciVal !== "false" && ciVal !== "0";

  return {
    projectIgnoreScripts,
    projectNpmrcPath,
    userIgnoreScripts,
    userNpmrcPath,
    envFlags: {
      huskyDisabled,
      npmIgnoreScripts,
      ci,
    },
  };
}
