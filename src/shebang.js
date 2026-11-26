import fs from "node:fs";
import { findExecutableOnPath } from "./path-lookup.js";
import { sanitizeSnippet } from "./sanitize.js";

const GIT_BASH_VIRTUAL_PATHS = new Set([
  "/bin/sh",
  "/bin/bash",
  "/usr/bin/sh",
  "/usr/bin/bash",
  "/usr/bin/env",
]);

/**
 * @typedef {"ok" | "empty-file" | "missing-shebang" | "crlf-shebang" | "invalid-shebang" | "interpreter-not-found" | "env-interpreter-not-found"} ShebangStatus
 */

/**
 * @typedef {object} ShebangAnalysis
 * @property {ShebangStatus} status
 * @property {string | null} firstLine
 * @property {boolean} hasCrlf
 * @property {string | null} interpreter
 * @property {string | null} envTarget
 * @property {string | null} resolvedInterpreter
 * @property {string | null} message
 */

/**
 * Analyze the shebang line of a hook file without executing anything.
 * Linear-time parsing only.
 * @param {string} content
 * @param {{ platform?: NodeJS.Platform, envPath?: string, pathExt?: string }} [options]
 * @returns {ShebangAnalysis}
 */
export function analyzeShebang(content, options = {}) {
  const platform = options.platform ?? process.platform;

  if (content.trim().length === 0) {
    return {
      status: "empty-file",
      firstLine: null,
      hasCrlf: false,
      interpreter: null,
      envTarget: null,
      resolvedInterpreter: null,
      message: "Hook file is empty.",
    };
  }

  const nlIdx = content.indexOf("\n");
  const rawFirstLine = nlIdx === -1 ? content : content.slice(0, nlIdx);
  const hasCrlf = rawFirstLine.endsWith("\r");
  const cleanFirstLine = sanitizeSnippet(hasCrlf ? rawFirstLine.slice(0, -1) : rawFirstLine, 120);

  if (!rawFirstLine.startsWith("#!")) {
    return {
      status: "missing-shebang",
      firstLine: cleanFirstLine,
      hasCrlf,
      interpreter: null,
      envTarget: null,
      resolvedInterpreter: null,
      message: "Missing `#!` shebang on the first line.",
    };
  }

  const afterHashBang = (hasCrlf ? rawFirstLine.slice(2, -1) : rawFirstLine.slice(2)).trim();
  if (!afterHashBang) {
    return {
      status: "invalid-shebang",
      firstLine: cleanFirstLine,
      hasCrlf,
      interpreter: null,
      envTarget: null,
      resolvedInterpreter: null,
      message: "Shebang `#!` has no interpreter specified.",
    };
  }

  // Split by ASCII whitespace in linear time.
  const parts = afterHashBang.split(/[ \t]+/).filter((p) => p.length > 0);
  const interpreter = parts[0] ?? "";

  if (hasCrlf) {
    return {
      status: "crlf-shebang",
      firstLine: cleanFirstLine,
      hasCrlf: true,
      interpreter: sanitizeSnippet(interpreter, 80),
      envTarget: null,
      resolvedInterpreter: null,
      message: "Shebang line ends with CRLF (\\r\\n); POSIX systems fail with 'No such file or directory'.",
    };
  }

  const isEnv = interpreter === "env" || interpreter.endsWith("/env");
  if (isEnv) {
    // Find first non-flag token after `env` (handles `env -S node` or `env node`).
    let envTarget = null;
    for (let i = 1; i < parts.length; i += 1) {
      const tok = parts[i] ?? "";
      if (!tok.startsWith("-")) {
        envTarget = tok;
        break;
      }
    }

    if (!envTarget) {
      return {
        status: "invalid-shebang",
        firstLine: cleanFirstLine,
        hasCrlf: false,
        interpreter: sanitizeSnippet(interpreter, 80),
        envTarget: null,
        resolvedInterpreter: null,
        message: "Shebang uses `env` without naming a target interpreter.",
      };
    }

    const found = findExecutableOnPath(envTarget, options);
    if (!found) {
      return {
        status: "env-interpreter-not-found",
        firstLine: cleanFirstLine,
        hasCrlf: false,
        interpreter: sanitizeSnippet(interpreter, 80),
        envTarget: sanitizeSnippet(envTarget, 80),
        resolvedInterpreter: null,
        message: `Interpreter \`${sanitizeSnippet(envTarget, 80)}\` from \`${cleanFirstLine}\` was not found on PATH.`,
      };
    }

    return {
      status: "ok",
      firstLine: cleanFirstLine,
      hasCrlf: false,
      interpreter: sanitizeSnippet(interpreter, 80),
      envTarget: sanitizeSnippet(envTarget, 80),
      resolvedInterpreter: found,
      message: null,
    };
  }

  // Direct interpreter path (e.g. /bin/sh, /usr/bin/python3).
  if (platform === "win32" && GIT_BASH_VIRTUAL_PATHS.has(interpreter)) {
    return {
      status: "ok",
      firstLine: cleanFirstLine,
      hasCrlf: false,
      interpreter: sanitizeSnippet(interpreter, 80),
      envTarget: null,
      resolvedInterpreter: interpreter,
      message: null,
    };
  }

  let existsAndExec = false;
  try {
    const stat = fs.statSync(interpreter);
    existsAndExec = stat.isFile() && (platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch {
    // interpreter missing or inaccessible; existsAndExec remains false
  }

  if (!existsAndExec) {
    return {
      status: "interpreter-not-found",
      firstLine: cleanFirstLine,
      hasCrlf: false,
      interpreter: sanitizeSnippet(interpreter, 80),
      envTarget: null,
      resolvedInterpreter: null,
      message: `Shebang interpreter \`${sanitizeSnippet(interpreter, 80)}\` does not exist or is not executable.`,
    };
  }

  return {
    status: "ok",
    firstLine: cleanFirstLine,
    hasCrlf: false,
    interpreter: sanitizeSnippet(interpreter, 80),
    envTarget: null,
    resolvedInterpreter: interpreter,
    message: null,
  };
}
