import fs from "node:fs";
import path from "node:path";
import { STANDARD_GIT_HOOKS, formatDisplayPath, safeReadFile } from "../sanitize.js";

const STANDARD_HOOK_SET = new Set(STANDARD_GIT_HOOKS);
const PRE_COMMIT_CONFIGS = [".pre-commit-config.yaml", ".pre-commit-config.yml"];

/**
 * Python `pre-commit` framework descriptor and detector.
 * Docs: https://pre-commit.com/
 */
export const preCommitManager = {
  id: /** @type {const} */ ("pre-commit"),
  name: "pre-commit",
  docsUrl: "https://pre-commit.com/",
  setsHooksPath: false,

  /**
   * @param {import("./index.js").ManagerDetectionInput} input
   * @returns {import("./index.js").ManagerDetectionResult}
   */
  detect(input) {
    const { repoRoot, homeDir, hooksDir } = input;
    /** @type {string[]} */
    const evidence = [];
    /** @type {Map<string, { sourceFile: string, content: string }>} */
    const configuredHooks = new Map();

    let configFound = false;
    if (repoRoot) {
      for (const name of PRE_COMMIT_CONFIGS) {
        const fullPath = path.join(repoRoot, name);
        try {
          if (fs.statSync(fullPath).isFile()) {
            configFound = true;
            const display = formatDisplayPath(fullPath, repoRoot, homeDir);
            evidence.push(`\`${display}\` exists`);
            configuredHooks.set("pre-commit", { sourceFile: display, content: "" });
            break;
          }
        } catch {
          // missing
        }
      }
    }

    const declared = configFound;
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
        if (
          read.ok &&
          (read.content.includes("pre_commit") || read.content.includes("pre-commit"))
        ) {
          matchingHooks.push(entry.name);
        }
      }
      if (matchingHooks.length > 0) {
        installed = true;
        installEvidence.push(
          `pre-commit hook wrapper found in effective hooks dir for: ${matchingHooks.join(", ")}`
        );
      } else {
        missingInstallReason =
          "`.pre-commit-config.yaml` exists, but `pre-commit install` has not installed hook wrappers in the effective hooks directory.";
      }
    }

    return {
      id: "pre-commit",
      name: "pre-commit",
      docsUrl: this.docsUrl,
      setsHooksPath: false,
      declared,
      installed,
      evidence,
      installEvidence,
      missingInstallReason,
      hasInstallScript: false,
      configuredHooks,
      sourcedFilesDir: null,
    };
  },
};
