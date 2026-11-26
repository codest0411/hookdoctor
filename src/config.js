import path from "node:path";
import { HookDoctorError } from "./git.js";
import { safeReadFile, sanitizeSnippet } from "./sanitize.js";

const VALID_FAIL_ON = new Set(["error", "warn", "never"]);
const VALID_MANAGERS = new Set(["husky", "lefthook", "simple-git-hooks", "pre-commit"]);
const RULE_ID_RE = /^HD\d{3}$/;

/**
 * @typedef {object} HookDoctorConfig
 * @property {Map<string, string>} ignore
 * @property {string[]} expectedManagers
 * @property {"error" | "warn" | "never" | null} failOn
 */

/**
 * Load and strictly validate `.hookdoctorrc.json` (if present or explicitly specified).
 * Prototype-pollution safe: returns a Map for `ignore` and validates every key and type.
 * @param {string | null} repoRoot
 * @param {string | null} explicitConfigPath
 * @returns {HookDoctorConfig}
 */
export function loadConfig(repoRoot, explicitConfigPath) {
  /** @type {HookDoctorConfig} */
  const defaults = {
    ignore: new Map(),
    expectedManagers: [],
    failOn: null,
  };

  let configPath;
  /** @type {string[]} */
  const allowedRoots = [];
  /** @type {string[]} */
  const allowedExact = [];

  if (explicitConfigPath) {
    configPath = path.resolve(explicitConfigPath);
    allowedExact.push(configPath);
  } else if (repoRoot) {
    configPath = path.join(repoRoot, ".hookdoctorrc.json");
    allowedRoots.push(repoRoot);
  } else {
    return defaults;
  }

  const read = safeReadFile(configPath, {
    allowedRoots,
    allowedExactFiles: allowedExact,
    maxBytes: 65536,
  });

  if (!read.ok) {
    if (explicitConfigPath) {
      throw new HookDoctorError(
        "INVALID_CONFIG",
        `Could not read config file: ${read.reason ?? "not found"}`
      );
    }
    return defaults;
  }

  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(read.content);
  } catch {
    throw new HookDoctorError("INVALID_CONFIG", "Config file is not valid JSON.");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HookDoctorError("INVALID_CONFIG", "Config root must be a JSON object.");
  }

  const allowedKeys = new Set(["ignore", "expectedManagers", "failOn"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      throw new HookDoctorError(
        "INVALID_CONFIG",
        `Unknown config property: "${sanitizeSnippet(key, 40)}"`
      );
    }
  }

  const obj = /** @type {Record<string, unknown>} */ (raw);

  // Validate `ignore`: array of { rule: "HD00X", reason: "non-empty string" }
  if (obj.ignore !== undefined) {
    if (!Array.isArray(obj.ignore)) {
      throw new HookDoctorError("INVALID_CONFIG", "`ignore` must be an array.");
    }
    for (const item of obj.ignore) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new HookDoctorError("INVALID_CONFIG", "Each `ignore` entry must be an object.");
      }
      const entry = /** @type {Record<string, unknown>} */ (item);
      if (typeof entry.rule !== "string" || !RULE_ID_RE.test(entry.rule)) {
        throw new HookDoctorError(
          "INVALID_CONFIG",
          "Each `ignore` entry must have a valid `rule` ID (e.g. `HD006`)."
        );
      }
      if (typeof entry.reason !== "string" || entry.reason.trim().length < 3) {
        throw new HookDoctorError(
          "INVALID_CONFIG",
          `Ignored rule \`${entry.rule}\` requires a non-empty \`reason\` (min 3 chars).`
        );
      }
      defaults.ignore.set(entry.rule, sanitizeSnippet(entry.reason.trim(), 200));
    }
  }

  // Validate `expectedManagers`
  if (obj.expectedManagers !== undefined) {
    if (!Array.isArray(obj.expectedManagers)) {
      throw new HookDoctorError("INVALID_CONFIG", "`expectedManagers` must be an array.");
    }
    for (const m of obj.expectedManagers) {
      if (typeof m !== "string" || !VALID_MANAGERS.has(m)) {
        throw new HookDoctorError(
          "INVALID_CONFIG",
          `Invalid manager in \`expectedManagers\`: "${sanitizeSnippet(String(m), 40)}"`
        );
      }
      defaults.expectedManagers.push(m);
    }
  }

  // Validate `failOn`
  if (obj.failOn !== undefined) {
    if (typeof obj.failOn !== "string" || !VALID_FAIL_ON.has(obj.failOn)) {
      throw new HookDoctorError(
        "INVALID_CONFIG",
        "`failOn` must be one of: error, warn, never."
      );
    }
    defaults.failOn = /** @type {"error" | "warn" | "never"} */ (obj.failOn);
  }

  return defaults;
}
