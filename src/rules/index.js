import { STANDARD_GIT_HOOKS, formatDisplayPath, safeReadFile, sanitizeSnippet } from "../sanitize.js";
import { analyzeShebang } from "../shebang.js";
import { extractScriptReferences } from "../npm-scripts.js";

const STANDARD_HOOK_SET = new Set(STANDARD_GIT_HOOKS);

/**
 * @typedef {"error" | "warn" | "info"} Severity
 */

/**
 * @typedef {object} Finding
 * @property {string} id
 * @property {Severity} severity
 * @property {string} title
 * @property {string[]} evidence
 * @property {string} whyItMatters
 * @property {string} nextStep
 * @property {string} [file]
 * @property {number} [line]
 */

/**
 * @typedef {object} HookStatusEntry
 * @property {string} hook
 * @property {"active" | "inactive" | "ignored"} state
 * @property {string} sourceFile
 * @property {string} manager
 * @property {string} reason
 */

/**
 * @typedef {object} RuleEvaluationInput
 * @property {import("../git.js").RepoContext} repo
 * @property {import("../config-origin.js").ConfigOriginSummary} configOrigins
 * @property {import("../hooks-dir.js").HooksDirectoryInspection} hooksDir
 * @property {import("../managers/index.js").ManagerDetectionResult[]} managers
 * @property {import("../npmrc.js").NpmrcAndEnvSummary} npmrcEnv
 * @property {import("../npm-scripts.js").PackageJsonInfo} pkg
 * @property {string | null} homeDir
 * @property {NodeJS.Platform} platform
 * @property {string | undefined} envPath
 * @property {string | undefined} pathExt
 * @property {boolean} ciMode
 * @property {string[]} expectedManagers
 * @property {Map<string, string>} ignoredRules
 */

/**
 * Evaluate all diagnostic rules (HD001–HD009) and build the hook status summary.
 * @param {RuleEvaluationInput} input
 * @returns {{ findings: Finding[], hookTable: HookStatusEntry[], shebangByHook: Map<string, import("../shebang.js").ShebangAnalysis> }}
 */
export function evaluateRules(input) {
  const {
    repo,
    configOrigins,
    hooksDir,
    managers,
    npmrcEnv,
    pkg,
    homeDir,
    platform,
    envPath,
    pathExt,
    ciMode,
    expectedManagers,
    ignoredRules,
  } = input;

  /** @type {Finding[]} */
  const rawFindings = [];
  const allowedHookRoots = [hooksDir.effectiveHooksDir];
  if (repo.repoRoot) allowedHookRoots.push(repo.repoRoot);

  const declaredManagers = managers.filter((m) => m.declared);
  const huskyMgr = managers.find((m) => m.id === "husky");
  const isHuskyV9Installed = Boolean(huskyMgr && huskyMgr.installed && huskyMgr.sourcedFilesDir);

  // HD001: Declared or expected hook manager not installed
  for (const mgr of declaredManagers) {
    if (!mgr.installed) {
      rawFindings.push({
        id: "HD001",
        severity: "error",
        title: `${mgr.name} is declared by this project but not installed for this clone`,
        evidence: [
          ...mgr.evidence,
          mgr.missingInstallReason ?? `${mgr.name} hooks are not active in the effective hooks directory.`,
        ],
        whyItMatters:
          "Developers on this clone will commit and push without running the project's lint, format, or test gates.",
        nextStep: `Verify before running: inspect package.json/docs and run the ${mgr.name} install command (for example \`npm install\` or \`npx ${mgr.id} install\`).`,
      });
    }
  }
  for (const expectedId of expectedManagers) {
    const found = managers.find((m) => m.id === expectedId);
    if (found && !found.declared) {
      rawFindings.push({
        id: "HD001",
        severity: "error",
        title: `Expected hook manager \`${expectedId}\` (from config) is not declared or installed`,
        evidence: [`\`expectedManagers\` in hookdoctor config requires \`${expectedId}\`.`],
        whyItMatters: "The repository is missing the hook manager required by project configuration.",
        nextStep: `Verify before running: check whether \`${expectedId}\` should be installed or removed from \`.hookdoctorrc.json\`.`,
      });
    }
  }

  // HD002: core.hooksPath points to missing or non-directory path
  if (configOrigins.effectiveHooksPath && !hooksDir.effectiveDirIsDirectory) {
    const displayHooksDir = formatDisplayPath(hooksDir.effectiveHooksDir, repo.repoRoot, homeDir);
    const originDisplay = formatDisplayPath(
      configOrigins.effectiveHooksPath.origin,
      repo.repoRoot,
      homeDir
    );
    rawFindings.push({
      id: "HD002",
      severity: "error",
      title: `core.hooksPath points to a ${hooksDir.effectiveDirExists ? "non-directory" : "missing directory"}: ${displayHooksDir}`,
      evidence: [
        `core.hooksPath = "${sanitizeSnippet(configOrigins.effectiveHooksPath.value)}" (${configOrigins.effectiveHooksPath.scope} scope, ${originDisplay})`,
        `Resolved path: ${displayHooksDir}`,
      ],
      whyItMatters:
        "When core.hooksPath does not exist or is not a directory, Git silently skips all hooks without printing an error.",
      nextStep:
        "Verify before running: create/install the target hooks directory or unset `git config --unset core.hooksPath` if obsolete.",
    });
  }

  // HD003: Global/system core.hooksPath override OR orphaned .git/hooks
  if (
    configOrigins.effectiveHooksPath &&
    (configOrigins.effectiveHooksPath.scope === "global" ||
      configOrigins.effectiveHooksPath.scope === "system")
  ) {
    const originDisplay = formatDisplayPath(
      configOrigins.effectiveHooksPath.origin,
      repo.repoRoot,
      homeDir
    );
    rawFindings.push({
      id: "HD003",
      severity: "warn",
      title: `A ${configOrigins.effectiveHooksPath.scope} core.hooksPath overrides repository hooks`,
      evidence: [
        `Effective core.hooksPath = "${sanitizeSnippet(configOrigins.effectiveHooksPath.value)}" from ${configOrigins.effectiveHooksPath.scope} config (${originDisplay})`,
      ],
      whyItMatters:
        "A global or system hooksPath prevents Git from running hooks in `.git/hooks` (and can conflict with per-repo managers).",
      nextStep:
        "Verify before running: inspect the global/system Git config file and decide whether to keep the global override or set a repo-local `core.hooksPath`.",
    });
  }

  if (hooksDir.orphanedDefaultHooks.length > 0) {
    const defaultDisplay = formatDisplayPath(hooksDir.defaultHooksDir, repo.repoRoot, homeDir);
    const effectiveDisplay = formatDisplayPath(hooksDir.effectiveHooksDir, repo.repoRoot, homeDir);
    rawFindings.push({
      id: "HD003",
      severity: "warn",
      title: `${hooksDir.orphanedDefaultHooks.length} orphaned hook(s) in ${defaultDisplay} will never run`,
      evidence: [
        `Active hooks directory is ${effectiveDisplay}, so Git ignores ${defaultDisplay}.`,
        `Orphaned files: ${hooksDir.orphanedDefaultHooks.map((h) => h.name).join(", ")}`,
      ],
      whyItMatters:
        "Hook scripts left in `.git/hooks` silently do nothing whenever `core.hooksPath` points elsewhere.",
      nextStep:
        "Verify before running: move needed scripts into the active hooks directory or remove stale files from `.git/hooks`.",
    });
  }

  // HD004 & HD005: Inspect executable bit & shebangs on files Git executes directly
  /** @type {Map<string, import("../shebang.js").ShebangAnalysis>} */
  const shebangByHook = new Map();

  for (const entry of hooksDir.effectiveHooks) {
    if (!STANDARD_HOOK_SET.has(entry.name)) continue;

    // For Husky v9 (.husky/_/<hook>), the stub invokes .husky/<hook>. If the user didn't create .husky/<hook>,
    // the stub is a no-op; still validate the stub's own +x and shebang because Git executes it directly.
    const displayFile = formatDisplayPath(entry.fullPath, repo.repoRoot, homeDir);

    if (!hooksDir.execCheckSkippedReason && !entry.isExecutable) {
      rawFindings.push({
        id: "HD004",
        severity: "error",
        title: `Hook \`${entry.name}\` is not executable and will be ignored by Git`,
        evidence: [
          `File: ${displayFile}`,
          configOrigins.adviceIgnoredHook === false
            ? "advice.ignoredHook is false, so Git hides the ignored-hook hint."
            : "Git requires the executable bit (+x) on hook files on POSIX systems.",
        ],
        whyItMatters: "Git silently skips non-executable hook files.",
        nextStep: `Verify before running: inspect ${displayFile} and run \`chmod +x ${displayFile}\`.`,
        file: displayFile,
      });
    }

    const read = safeReadFile(entry.fullPath, {
      allowedRoots: allowedHookRoots,
      maxBytes: 65536,
    });

    if (!read.ok) {
      rawFindings.push({
        id: "HD005",
        severity: "warn",
        title: `Could not read hook \`${entry.name}\` for shebang inspection`,
        evidence: [`File: ${displayFile}`, `Reason: ${read.reason ?? "unknown"}`],
        whyItMatters: "Unreadable or out-of-bounds symlinked hooks may fail to execute.",
        nextStep: `Verify before running: inspect ${displayFile} permissions and symlink target.`,
        file: displayFile,
      });
      continue;
    }

    const shebang = analyzeShebang(read.content, { platform, envPath, pathExt });
    shebangByHook.set(entry.name, shebang);

    if (shebang.status !== "ok") {
      const sev =
        shebang.status === "crlf-shebang" ||
        shebang.status === "interpreter-not-found" ||
        shebang.status === "env-interpreter-not-found"
          ? "error"
          : "warn";
      rawFindings.push({
        id: "HD005",
        severity: sev,
        title: `Shebang issue in hook \`${entry.name}\`: ${shebang.status}`,
        evidence: [
          `File: ${displayFile}`,
          shebang.message ?? "Invalid shebang.",
          ...(shebang.firstLine ? [`First line: \`${shebang.firstLine}\``] : []),
        ],
        whyItMatters:
          "A missing, CRLF-terminated, or unresolvable shebang causes the OS to fail or mis-execute the hook.",
        nextStep: `Verify before running: ensure line 1 of ${displayFile} uses LF endings and a valid interpreter (e.g. \`#!/bin/sh\`).`,
        file: displayFile,
        line: 1,
      });
    }

    // HD008: Check script references inside direct hook files
    // (Skip Husky v9 internal stubs here; we check .husky/<hook> user files below)
    if (!isHuskyV9Installed && pkg.exists && pkg.valid) {
      const refs = extractScriptReferences(read.content);
      for (const ref of refs) {
        if (!Object.prototype.hasOwnProperty.call(pkg.scripts, ref.scriptName)) {
          rawFindings.push({
            id: "HD008",
            severity: "warn",
            title:
              ref.confidence === "low"
                ? `Possible missing package.json script \`${ref.scriptName}\` (low confidence) referenced in \`${entry.name}\``
                : `Missing package.json script \`${ref.scriptName}\` referenced in \`${entry.name}\``,
            evidence: [
              `File: ${displayFile}:${ref.line}`,
              `Matched: \`${ref.snippet}\``,
              `Confidence: ${ref.confidence}`,
            ],
            whyItMatters: "Hooks that invoke deleted or renamed npm scripts fail on every commit/push.",
            nextStep: `Verify before running: check \`scripts\` in package.json or update ${displayFile}.`,
            file: displayFile,
            line: ref.line,
          });
        }
      }
    }
  }

  // HD008 for manager-configured hook contents (.husky/<hook>, lefthook.yml, simple-git-hooks)
  if (pkg.exists && pkg.valid) {
    for (const mgr of declaredManagers) {
      for (const [hookName, cfg] of mgr.configuredHooks.entries()) {
        const refs = extractScriptReferences(cfg.content);
        for (const ref of refs) {
          if (!Object.prototype.hasOwnProperty.call(pkg.scripts, ref.scriptName)) {
            rawFindings.push({
              id: "HD008",
              severity: "warn",
              title:
                ref.confidence === "low"
                  ? `Possible missing package.json script \`${ref.scriptName}\` (low confidence) in ${mgr.name} \`${hookName}\``
                  : `Missing package.json script \`${ref.scriptName}\` referenced in ${mgr.name} \`${hookName}\``,
              evidence: [
                `Source: ${cfg.sourceFile} (hook: ${hookName})`,
                `Matched: \`${ref.snippet}\``,
                `Confidence: ${ref.confidence}`,
              ],
              whyItMatters: "Hooks that invoke deleted or renamed npm scripts fail when triggered.",
              nextStep: `Verify before running: check \`scripts\` in package.json or update ${cfg.sourceFile}.`,
              file: cfg.sourceFile,
            });
          }
        }
      }
    }
  }

  // HD006: Install step would be skipped
  const npmManagers = declaredManagers.filter((m) => m.id !== "pre-commit");
  if (npmManagers.length > 0) {
    /** @type {string[]} */
    const skipReasons = [];
    for (const mgr of npmManagers) {
      if (!mgr.hasInstallScript && pkg.exists) {
        skipReasons.push(
          `${mgr.name} is declared, but package.json has no \`prepare\` or \`postinstall\` script invoking it.`
        );
      }
    }
    if (npmrcEnv.projectIgnoreScripts) {
      skipReasons.push(
        `Project ${npmrcEnv.projectNpmrcPath ?? ".npmrc"} sets \`ignore-scripts=true\`.`
      );
    }
    if (npmrcEnv.userIgnoreScripts) {
      skipReasons.push(
        `User ${npmrcEnv.userNpmrcPath ?? "~/.npmrc"} sets \`ignore-scripts=true\`.`
      );
    }
    if (npmrcEnv.envFlags.npmIgnoreScripts) {
      skipReasons.push("Environment variable `npm_config_ignore_scripts` disables lifecycle scripts.");
    }
    if (npmrcEnv.envFlags.huskyDisabled && huskyMgr?.declared) {
      skipReasons.push("Environment variable `HUSKY=0` disables Husky installation.");
    }

    if (skipReasons.length > 0) {
      rawFindings.push({
        id: "HD006",
        severity: "warn",
        title: "Hook manager automatic install step may be skipped",
        evidence: skipReasons,
        whyItMatters:
          "Fresh clones running `npm install` will silently skip hook installation if lifecycle scripts are disabled or missing.",
        nextStep:
          "Verify before running: check `scripts.prepare` in package.json, `.npmrc`, and environment flags.",
      });
    }

    if (npmrcEnv.envFlags.ci) {
      rawFindings.push({
        id: "HD006",
        severity: ciMode ? "info" : "warn",
        title: "CI environment detected (`CI` is set); hook managers often skip installation in CI",
        evidence: ["Environment variable `CI` is set (value intentionally not printed)."],
        whyItMatters:
          "Hook managers like Husky skip installing hooks on CI runners by design; this is usually intentional.",
        nextStep:
          "Verify before running: pass `--ci` to treat CI detection as informational if running hookdoctor in a CI pipeline.",
      });
    }
  }

  // HD007: Multiple managers or conflicting hooksPath entries
  if (declaredManagers.length > 1) {
    rawFindings.push({
      id: "HD007",
      severity: "warn",
      title: `Multiple hook managers detected: ${declaredManagers.map((m) => m.name).join(", ")}`,
      evidence: declaredManagers.flatMap((m) => m.evidence.map((e) => `${m.name}: ${e}`)),
      whyItMatters:
        "Multiple hook managers compete for `core.hooksPath` or `.git/hooks/*`, causing one tool to overwrite another.",
      nextStep:
        "Verify before running: standardize on a single hook manager and remove unused manager configs.",
    });
  }

  if (configOrigins.hooksPathEntries.length > 1) {
    rawFindings.push({
      id: "HD007",
      severity: "warn",
      title: "Multiple `core.hooksPath` entries found across Git config scopes",
      evidence: configOrigins.hooksPathEntries.map(
        (e) =>
          `${e.scope}: "${sanitizeSnippet(e.value)}" (${formatDisplayPath(e.origin, repo.repoRoot, homeDir)})`
      ),
      whyItMatters:
        "Higher-precedence scopes silently override lower ones, leading to unexpected hook directories.",
      nextStep:
        "Verify before running: run `git config --list --show-scope --show-origin` and remove conflicting `core.hooksPath` entries.",
    });
  }

  // HD009: Summary table of all standard hooks present
  /** @type {HookStatusEntry[]} */
  const hookTable = [];
  const effectiveMap = new Map(hooksDir.effectiveHooks.map((h) => [h.name, h]));
  const orphanedMap = new Map(hooksDir.orphanedDefaultHooks.map((h) => [h.name, h]));

  for (const hookName of STANDARD_HOOK_SET) {
    const eff = effectiveMap.get(hookName);
    const orph = orphanedMap.get(hookName);
    const owningMgrs = declaredManagers.filter((m) => m.configuredHooks.has(hookName));
    const managerLabel =
      owningMgrs.length > 0 ? owningMgrs.map((m) => m.name).join(", ") : "custom";

    if (eff) {
      const sb = shebangByHook.get(hookName);
      const execBlocked = !hooksDir.execCheckSkippedReason && !eff.isExecutable;
      const shebangBlocked =
        sb &&
        (sb.status === "crlf-shebang" ||
          sb.status === "interpreter-not-found" ||
          sb.status === "env-interpreter-not-found");

      // For Husky v9, if .husky/_/<hook> exists, it only does real work if .husky/<hook> exists.
      if (isHuskyV9Installed && huskyMgr && !huskyMgr.configuredHooks.has(hookName)) {
        // Skip empty Husky v9 boilerplate stubs that have no user script in .husky/<hook>
        continue;
      }

      const sourceFile =
        isHuskyV9Installed && huskyMgr?.configuredHooks.has(hookName)
          ? (huskyMgr.configuredHooks.get(hookName)?.sourceFile ??
            formatDisplayPath(eff.fullPath, repo.repoRoot, homeDir))
          : formatDisplayPath(eff.fullPath, repo.repoRoot, homeDir);

      if (execBlocked || shebangBlocked) {
        hookTable.push({
          hook: hookName,
          state: "ignored",
          sourceFile,
          manager: managerLabel,
          reason: execBlocked ? "not executable" : `shebang error (${sb?.status})`,
        });
      } else {
        hookTable.push({
          hook: hookName,
          state: "active",
          sourceFile,
          manager: managerLabel,
          reason: "ready",
        });
      }
    } else if (orph) {
      hookTable.push({
        hook: hookName,
        state: "ignored",
        sourceFile: formatDisplayPath(orph.fullPath, repo.repoRoot, homeDir),
        manager: managerLabel,
        reason: "orphaned in .git/hooks while core.hooksPath is set",
      });
    } else if (owningMgrs.length > 0) {
      const firstMgr = owningMgrs[0];
      hookTable.push({
        hook: hookName,
        state: "inactive",
        sourceFile: firstMgr?.configuredHooks.get(hookName)?.sourceFile ?? "-",
        manager: managerLabel,
        reason: "configured by manager but not installed in effective hooks dir",
      });
    }
  }

  rawFindings.push({
    id: "HD009",
    severity: "info",
    title: `Hook inventory: ${hookTable.length} hook(s) discovered`,
    evidence:
      hookTable.length > 0
        ? hookTable.map(
            (h) => `${h.hook}: ${h.state} (${h.manager}, ${h.sourceFile}) - ${h.reason}`
          )
        : ["No active, orphaned, or manager-configured standard Git hooks found."],
    whyItMatters: "Provides a complete inventory of which Git hooks are active, inactive, or ignored.",
    nextStep: "Verify before running: run `hookdoctor why <hook-name>` to inspect a specific hook.",
  });

  // Apply .hookdoctorrc.json ignore list (never allow ignoring HD009)
  const findings = rawFindings.filter((f) => f.id === "HD009" || !ignoredRules.has(f.id));

  return { findings, hookTable, shebangByHook };
}
