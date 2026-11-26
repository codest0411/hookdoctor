import { huskyManager } from "./husky.js";
import { lefthookManager } from "./lefthook.js";
import { preCommitManager } from "./pre-commit.js";
import { simpleGitHooksManager } from "./simple-git-hooks.js";

/**
 * @typedef {"husky" | "lefthook" | "simple-git-hooks" | "pre-commit"} ManagerId
 */

/**
 * @typedef {object} ManagerDetectionInput
 * @property {string | null} repoRoot
 * @property {string | null} homeDir
 * @property {import("../npm-scripts.js").PackageJsonInfo} pkg
 * @property {import("../hooks-dir.js").HooksDirectoryInspection} hooksDir
 */

/**
 * @typedef {object} ManagerDetectionResult
 * @property {ManagerId} id
 * @property {string} name
 * @property {string} docsUrl
 * @property {boolean} setsHooksPath
 * @property {boolean} declared
 * @property {boolean} installed
 * @property {string[]} evidence
 * @property {string[]} installEvidence
 * @property {string | null} missingInstallReason
 * @property {boolean} hasInstallScript
 * @property {Map<string, { sourceFile: string, content: string }>} configuredHooks
 * @property {string | null} sourcedFilesDir
 */

export const ALL_MANAGERS = Object.freeze([
  huskyManager,
  lefthookManager,
  simpleGitHooksManager,
  preCommitManager,
]);

/**
 * Detect all declared and installed hook managers in the repository.
 * @param {ManagerDetectionInput} input
 * @returns {ManagerDetectionResult[]}
 */
export function detectManagers(input) {
  return ALL_MANAGERS.map((mgr) => mgr.detect(input));
}
