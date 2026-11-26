import fs from "node:fs";
import path from "node:path";
import { STANDARD_GIT_HOOKS, formatDisplayPath, safeReadFile } from "../sanitize.js";

const STANDARD_HOOK_SET = new Set(STANDARD_GIT_HOOKS);
const SGH_JSON_FILES = [".simple-git-hooks.json", "simple-git-hooks.json"];

/**
 * simple-git-hooks manager descriptor and detector.
 * Docs: https://www.npmjs.com/package/simple-git-hooks
 */
export const simpleGitHooksManager = {
  id: /** @type {const} */ ("simple-git-hooks"),
  name: "simple-git-hooks",
  docsUrl: "https://www.npmjs.com/package/simple-git-hooks",
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
      Boolean(pkg.dependencies["simple-git-hooks"]) ||
      Boolean(pkg.devDependencies["simple-git-hooks"]);
    if (hasDep) evidence.push("`simple-git-hooks` declared in package.json");

    if (pkg.simpleGitHooksConfig) {
      evidence.push("`simple-git-hooks` key present in package.json");
      for (const [k, v] of Object.entries(pkg.simpleGitHooksConfig)) {
        if (STANDARD_HOOK_SET.has(k) && typeof v === "string") {
          configuredHooks.set(k, { sourceFile: "package.json", content: v });
        }
      }
    }

    let standaloneConfigFound = false;
    if (repoRoot) {
      for (const name of SGH_JSON_FILES) {
        const fullPath = path.join(repoRoot, name);
        try {
          if (fs.statSync(fullPath).isFile()) {
            standaloneConfigFound = true;
            const display = formatDisplayPath(fullPath, repoRoot, homeDir);
            evidence.push(`\`${display}\` exists`);
            const read = safeReadFile(fullPath, { allowedRoots: [repoRoot], maxBytes: 65536 });
            if (read.ok) {
              try {
                const parsed = JSON.parse(read.content);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  for (const [k, v] of Object.entries(parsed)) {
                    if (STANDARD_HOOK_SET.has(k) && typeof v === "string") {
                      configuredHooks.set(k, { sourceFile: display, content: v });
                    }
                  }
                }
              } catch {
                // ignore invalid json
              }
            }
          }
        } catch {
          // missing
        }
      }
    }

    const declared = hasDep || Boolean(pkg.simpleGitHooksConfig) || standaloneConfigFound;
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
          (read.content.includes("SIMPLE_GIT_HOOKS") || read.content.includes("simple-git-hooks"))
        ) {
          matchingHooks.push(entry.name);
        }
      }
      if (matchingHooks.length > 0) {
        installed = true;
        installEvidence.push(
          `simple-git-hooks script found in effective hooks dir for: ${matchingHooks.join(", ")}`
        );
      } else {
        missingInstallReason =
          "simple-git-hooks is declared by the project, but no generated hooks were found in the effective hooks directory.";
      }
    }

    const prepare = pkg.scripts.prepare ?? "";
    const postinstall = pkg.scripts.postinstall ?? "";
    const hasInstallScript =
      prepare.includes("simple-git-hooks") || postinstall.includes("simple-git-hooks");

    return {
      id: "simple-git-hooks",
      name: "simple-git-hooks",
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
