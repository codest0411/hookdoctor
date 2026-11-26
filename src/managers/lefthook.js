import fs from "node:fs";
import path from "node:path";
import { STANDARD_GIT_HOOKS, formatDisplayPath, safeReadFile } from "../sanitize.js";

const STANDARD_HOOK_SET = new Set(STANDARD_GIT_HOOKS);
const LEFTHOOK_CONFIG_NAMES = [
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
  ".lefthook.yaml",
  "lefthook.json",
  "lefthook-local.yml",
  "lefthook-local.yaml",
];

/**
 * Simple line-based parser to extract hook names and `run:` commands from lefthook.yml/json.
 * @param {string} content
 * @param {boolean} isJson
 * @returns {Map<string, string>} hookName -> concatenated command lines
 */
function parseLefthookConfig(content, isJson) {
  /** @type {Map<string, string>} */
  const hooks = new Map();
  if (isJson) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (STANDARD_HOOK_SET.has(k)) {
            hooks.set(k, JSON.stringify(v));
          }
        }
      }
    } catch {
      // ignore invalid json
    }
    return hooks;
  }

  const lines = content.split(/\r?\n/);
  let currentHook = null;
  /** @type {string[]} */
  let currentLines = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level key (no leading whitespace)
    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
      if (currentHook) {
        hooks.set(currentHook, currentLines.join("\n"));
        currentHook = null;
        currentLines = [];
      }
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        if (STANDARD_HOOK_SET.has(key)) {
          currentHook = key;
        }
      }
      continue;
    }

    if (currentHook) {
      currentLines.push(trimmed);
    }
  }
  if (currentHook) {
    hooks.set(currentHook, currentLines.join("\n"));
  }
  return hooks;
}

/**
 * Lefthook manager descriptor and detector.
 * Docs: https://lefthook.dev/configuration/
 */
export const lefthookManager = {
  id: /** @type {const} */ ("lefthook"),
  name: "Lefthook",
  docsUrl: "https://lefthook.dev/configuration/",
  setsHooksPath: false,

  /**
   * @param {import("./index.js").ManagerDetectionInput} input
   * @returns {import("./index.js").ManagerDetectionResult}
   */
  detect(input) {
    const { repoRoot, homeDir, pkg, hooksDir } = input;
    /** @type {string[]} */
    const evidence = [];
    /** @type {Map<string, { sourceFile: string, content: string }>} */
    const configuredHooks = new Map();

    const hasDep =
      Boolean(pkg.dependencies.lefthook) ||
      Boolean(pkg.devDependencies.lefthook) ||
      Boolean(pkg.dependencies["@evilmartians/lefthook"]) ||
      Boolean(pkg.devDependencies["@evilmartians/lefthook"]) ||
      Boolean(pkg.dependencies["lefthook-plugin"]) ||
      Boolean(pkg.devDependencies["lefthook-plugin"]);
    if (hasDep) evidence.push("`lefthook` declared in package.json");

    let configFound = false;
    if (repoRoot) {
      for (const name of LEFTHOOK_CONFIG_NAMES) {
        const fullPath = path.join(repoRoot, name);
        try {
          if (fs.statSync(fullPath).isFile()) {
            configFound = true;
            const display = formatDisplayPath(fullPath, repoRoot, homeDir);
            evidence.push(`\`${display}\` exists`);
            const read = safeReadFile(fullPath, { allowedRoots: [repoRoot], maxBytes: 131072 });
            if (read.ok) {
              const parsed = parseLefthookConfig(read.content, name.endsWith(".json"));
              for (const [hookName, cmdText] of parsed.entries()) {
                configuredHooks.set(hookName, { sourceFile: display, content: cmdText });
              }
            }
          }
        } catch {
          // missing
        }
      }
    }

    const declared = hasDep || configFound;
    let installed = false;
    /** @type {string[]} */
    const installEvidence = [];
    let missingInstallReason = null;

    if (declared) {
      const allowedRoots = [hooksDir.effectiveHooksDir];
      if (repoRoot) allowedRoots.push(repoRoot);
      const matchingHooks = [];
      for (const entry of hooksDir.effectiveHooks) {
        if (!STANDARD_HOOK_SET.has(entry.name)) continue;
        const read = safeReadFile(entry.fullPath, { allowedRoots, maxBytes: 16384 });
        if (read.ok && read.content.toLowerCase().includes("lefthook")) {
          matchingHooks.push(entry.name);
        }
      }
      if (matchingHooks.length > 0) {
        installed = true;
        installEvidence.push(
          `Lefthook runner found in effective hooks dir for: ${matchingHooks.join(", ")}`
        );
      } else {
        missingInstallReason =
          "Lefthook is declared by the project, but no Lefthook hook runners were found in the effective hooks directory.";
      }
    }

    const prepare = pkg.scripts.prepare ?? "";
    const postinstall = pkg.scripts.postinstall ?? "";
    const hasInstallScript =
      prepare.includes("lefthook") || postinstall.includes("lefthook");

    return {
      id: "lefthook",
      name: "Lefthook",
      docsUrl: this.docsUrl,
      setsHooksPath: false,
      declared,
      installed,
      evidence,
      installEvidence,
      missingInstallReason,
      hasInstallScript,
      configuredHooks,
      sourcedFilesDir: null,
    };
  },
};
