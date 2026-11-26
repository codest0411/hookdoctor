import { STANDARD_GIT_HOOKS, formatDisplayPath, sanitizeSnippet } from "./sanitize.js";

const STANDARD_HOOK_SET = new Set(STANDARD_GIT_HOOKS);

/**
 * @typedef {object} WhyStep
 * @property {string} step
 * @property {"ok" | "fail" | "warn" | "skip"} status
 * @property {string} detail
 */

/**
 * @typedef {object} HookExplanation
 * @property {string} hookName
 * @property {boolean} isStandardHook
 * @property {"WILL RUN" | "WILL NOT RUN" | "MAY FAIL" | "NOT CONFIGURED"} verdict
 * @property {string} summary
 * @property {WhyStep[]} steps
 */

/**
 * Build a step-by-step decision chain explaining why a single Git hook will or will not run.
 * @param {import("./index.js").DiagnosisReport} report
 * @param {string} rawHookName
 * @returns {HookExplanation}
 */
export function explainHook(report, rawHookName) {
  const hookName = sanitizeSnippet(rawHookName.trim(), 80);
  const isStandardHook = STANDARD_HOOK_SET.has(hookName);
  /** @type {WhyStep[]} */
  const steps = [];

  // 1. Config value and origin
  if (report.configOrigins.effectiveHooksPath) {
    const cfg = report.configOrigins.effectiveHooksPath;
    steps.push({
      step: "1. Git config (core.hooksPath)",
      status: "ok",
      detail: `"${sanitizeSnippet(cfg.value)}" from ${cfg.scope} (${formatDisplayPath(cfg.origin, report.repo.repoRoot, report.homeDir)})`,
    });
  } else {
    steps.push({
      step: "1. Git config (core.hooksPath)",
      status: "ok",
      detail: "Not set -> Git uses default `.git/hooks`",
    });
  }

  // 2. Effective directory
  const effDisplay = formatDisplayPath(
    report.hooksDir.effectiveHooksDir,
    report.repo.repoRoot,
    report.homeDir
  );
  if (!report.hooksDir.effectiveDirIsDirectory) {
    steps.push({
      step: "2. Effective hooks directory",
      status: "fail",
      detail: `${effDisplay} (${report.hooksDir.effectiveDirExists ? "not a directory" : "does not exist"})`,
    });
    return {
      hookName,
      isStandardHook,
      verdict: "WILL NOT RUN",
      summary: `Effective hooks directory \`${effDisplay}\` does not exist; Git silently skips all hooks.`,
      steps,
    };
  }
  steps.push({
    step: "2. Effective hooks directory",
    status: "ok",
    detail: `${effDisplay} (exists)`,
  });

  // 3. File found?
  const hookEntry = report.hooksDir.effectiveHooks.find((h) => h.name === hookName);
  const orphanedEntry = report.hooksDir.orphanedDefaultHooks.find((h) => h.name === hookName);
  const configuredManagers = report.managers.filter(
    (m) => m.declared && m.configuredHooks.has(hookName)
  );

  if (!hookEntry) {
    const details = [`Not found at ${effDisplay}/${hookName}`];
    if (orphanedEntry) {
      details.push(`(Orphaned copy exists in .git/hooks/${hookName} which Git ignores)`);
    }
    if (configuredManagers.length > 0) {
      details.push(
        `(Configured by ${configuredManagers.map((m) => m.name).join(", ")} but not installed)`
      );
    }
    steps.push({
      step: "3. Hook file lookup",
      status: orphanedEntry || configuredManagers.length > 0 ? "fail" : "skip",
      detail: details.join(" "),
    });
    return {
      hookName,
      isStandardHook,
      verdict: orphanedEntry || configuredManagers.length > 0 ? "WILL NOT RUN" : "NOT CONFIGURED",
      summary:
        orphanedEntry || configuredManagers.length > 0
          ? `Hook \`${hookName}\` is configured or orphaned, but missing from \`${effDisplay}\`.`
          : `No \`${hookName}\` hook file exists in \`${effDisplay}\`.`,
      steps,
    };
  }

  const fileDisplay = formatDisplayPath(
    hookEntry.fullPath,
    report.repo.repoRoot,
    report.homeDir
  );
  steps.push({
    step: "3. Hook file lookup",
    status: "ok",
    detail: `Found ${fileDisplay}`,
  });

  // 4. Executable?
  if (report.hooksDir.execCheckSkippedReason) {
    steps.push({
      step: "4. Executable permission",
      status: "skip",
      detail: report.hooksDir.execCheckSkippedReason,
    });
  } else if (!hookEntry.isExecutable) {
    steps.push({
      step: "4. Executable permission",
      status: "fail",
      detail: `${fileDisplay} is NOT executable; Git ignores non-executable hooks.`,
    });
    return {
      hookName,
      isStandardHook,
      verdict: "WILL NOT RUN",
      summary: `\`${fileDisplay}\` lacks the executable bit (+x), so Git will silently ignore it.`,
      steps,
    };
  } else {
    steps.push({
      step: "4. Executable permission",
      status: "ok",
      detail: "Executable (+x)",
    });
  }

  // 5. Shebang ok?
  const sb = report.shebangByHook.get(hookName);
  if (!sb) {
    steps.push({
      step: "5. Shebang & interpreter",
      status: "warn",
      detail: "Could not inspect shebang.",
    });
  } else if (sb.status !== "ok") {
    const isFatal =
      sb.status === "crlf-shebang" ||
      sb.status === "interpreter-not-found" ||
      sb.status === "env-interpreter-not-found";
    steps.push({
      step: "5. Shebang & interpreter",
      status: isFatal ? "fail" : "warn",
      detail: sb.message ?? sb.status,
    });
    if (isFatal) {
      return {
        hookName,
        isStandardHook,
        verdict: "WILL NOT RUN",
        summary: `\`${fileDisplay}\` has a broken shebang (${sb.status}).`,
        steps,
      };
    }
  } else {
    steps.push({
      step: "5. Shebang & interpreter",
      status: "ok",
      detail: `${sb.firstLine ?? "#!"} -> ${sb.resolvedInterpreter ?? "ok"}`,
    });
  }

  // 6. Manager stub / user script
  const huskyMgr = report.managers.find((m) => m.id === "husky");
  if (huskyMgr?.installed && huskyMgr.sourcedFilesDir) {
    const userHook = huskyMgr.configuredHooks.get(hookName);
    if (!userHook) {
      steps.push({
        step: "6. Manager stub resolution",
        status: "skip",
        detail: `Husky v9 stub exists in .husky/_/${hookName}, but no user script at .husky/${hookName} (no-op).`,
      });
      return {
        hookName,
        isStandardHook,
        verdict: "NOT CONFIGURED",
        summary: `Husky stub exists, but \`.husky/${hookName}\` does not exist so nothing runs.`,
        steps,
      };
    }
    steps.push({
      step: "6. Manager stub resolution",
      status: "ok",
      detail: `Husky v9 stub sources ${userHook.sourceFile} (no +x or shebang needed on sourced file).`,
    });
  } else if (configuredManagers.length > 0) {
    steps.push({
      step: "6. Manager stub resolution",
      status: "ok",
      detail: `Managed by ${configuredManagers.map((m) => m.name).join(", ")}.`,
    });
  } else {
    steps.push({
      step: "6. Manager stub resolution",
      status: "ok",
      detail: "Direct custom hook script (no manager wrapper).",
    });
  }

  const hasWarn = steps.some((s) => s.status === "warn");
  return {
    hookName,
    isStandardHook,
    verdict: hasWarn ? "MAY FAIL" : "WILL RUN",
    summary: hasWarn
      ? `Hook \`${hookName}\` will be invoked by Git, but has warnings (see steps above).`
      : `Hook \`${hookName}\` is active and ready to run.`,
    steps,
  };
}
