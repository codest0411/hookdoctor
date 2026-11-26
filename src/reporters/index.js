import { escapeGithubAnnotation, formatDisplayPath, sanitizeSnippet } from "../sanitize.js";

/**
 * @param {boolean} useColor
 * @returns {{ red: (s: string) => string, yellow: (s: string) => string, green: (s: string) => string, cyan: (s: string) => string, dim: (s: string) => string, bold: (s: string) => string }}
 */
function makeColors(useColor) {
  if (!useColor) {
    const id = (/** @type {string} */ s) => s;
    return { red: id, yellow: id, green: id, cyan: id, dim: id, bold: id };
  }
  return {
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
  };
}

/**
 * Format diagnosis report as human-readable text.
 * @param {import("../index.js").DiagnosisReport} report
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function formatHumanReport(report, options = {}) {
  const c = makeColors(options.color === true);
  /** @type {string[]} */
  const lines = [];

  const effDir = formatDisplayPath(
    report.hooksDir.effectiveHooksDir,
    report.repo.repoRoot,
    report.homeDir
  );
  lines.push(c.bold("hookdoctor diagnosis"));
  lines.push(`  Effective hooks dir : ${effDisplay(effDir, report.configOrigins.effectiveHooksPath)}`);
  lines.push(`  Git version         : ${report.repo.gitVersion.raw}${report.configOrigins.degradedScope ? " (degraded: no --show-scope)" : ""}`);
  if (report.hooksDir.execCheckSkippedReason) {
    lines.push(`  Executable check    : skipped (${report.hooksDir.execCheckSkippedReason})`);
  }
  lines.push("");

  for (const f of report.findings) {
    const badge =
      f.severity === "error"
        ? c.red(`[${f.id}] ERROR`)
        : f.severity === "warn"
          ? c.yellow(`[${f.id}] WARN`)
          : c.cyan(`[${f.id}] INFO`);
    lines.push(`${badge} ${c.bold(sanitizeSnippet(f.title, 200))}`);
    for (const ev of f.evidence) {
      lines.push(`  - ${sanitizeSnippet(ev, 240)}`);
    }
    lines.push(`  Why it matters : ${f.whyItMatters}`);
    lines.push(`  Next step      : ${f.nextStep}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * @param {string} effDir
 * @param {import("../config-origin.js").ConfigEntry | null} cfg
 * @returns {string}
 */
function effDisplay(effDir, cfg) {
  if (!cfg) return `${effDir} (default)`;
  return `${effDir} (core.hooksPath in ${cfg.scope} config)`;
}

/**
 * Format `hookdoctor why <hook>` output for humans.
 * @param {import("../why.js").HookExplanation} explanation
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
export function formatWhyHuman(explanation, options = {}) {
  const c = makeColors(options.color === true);
  /** @type {string[]} */
  const lines = [];
  lines.push(c.bold(`hookdoctor why ${explanation.hookName}`));
  for (const s of explanation.steps) {
    const tag =
      s.status === "ok"
        ? c.green("[OK]")
        : s.status === "fail"
          ? c.red("[FAIL]")
          : s.status === "warn"
            ? c.yellow("[WARN]")
            : c.dim("[SKIP]");
    lines.push(`  ${tag} ${s.step}: ${sanitizeSnippet(s.detail, 240)}`);
  }
  lines.push("");
  const verdictColor =
    explanation.verdict === "WILL RUN"
      ? c.green(explanation.verdict)
      : explanation.verdict === "WILL NOT RUN"
        ? c.red(explanation.verdict)
        : explanation.verdict === "MAY FAIL"
          ? c.yellow(explanation.verdict)
          : c.cyan(explanation.verdict);
  lines.push(`Verdict: ${verdictColor} — ${explanation.summary}`);
  return lines.join("\n") + "\n";
}

/**
 * Format diagnosis report as JSON.
 * @param {import("../index.js").DiagnosisReport} report
 * @returns {string}
 */
export function formatJsonReport(report) {
  const payload = {
    version: report.version,
    effectiveHooksDir: formatDisplayPath(
      report.hooksDir.effectiveHooksDir,
      report.repo.repoRoot,
      report.homeDir
    ),
    gitVersion: report.repo.gitVersion.raw,
    findings: report.findings,
    hooks: report.hookTable,
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

/**
 * Format diagnosis report as GitHub Actions workflow annotations.
 * @param {import("../index.js").DiagnosisReport} report
 * @returns {string}
 */
export function formatGithubReport(report) {
  /** @type {string[]} */
  const lines = [];
  for (const f of report.findings) {
    if (f.id === "HD009") continue;
    const cmd = f.severity === "error" ? "error" : f.severity === "warn" ? "warning" : "notice";
    const props = [];
    if (f.file) props.push(`file=${escapeGithubAnnotation(f.file)}`);
    if (f.line) props.push(`line=${f.line}`);
    const propStr = props.length > 0 ? ` ${props.join(",")}` : "";
    const msg = escapeGithubAnnotation(`[${f.id}] ${f.title} — ${f.nextStep}`);
    lines.push(`::${cmd}${propStr}::${msg}`);
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

/**
 * Format diagnosis report as SARIF v2.1.0.
 * @param {import("../index.js").DiagnosisReport} report
 * @returns {string}
 */
export function formatSarifReport(report) {
  const results = report.findings
    .filter((f) => f.id !== "HD009")
    .map((f) => ({
      ruleId: f.id,
      level: f.severity === "error" ? "error" : f.severity === "warn" ? "warning" : "note",
      message: {
        text: `${f.title}. ${f.whyItMatters} ${f.nextStep}`,
      },
      locations: f.file
        ? [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                ...(f.line ? { region: { startLine: f.line } } : {}),
              },
            },
          ]
        : [],
    }));

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "hookdoctor",
            version: report.version,
            informationUri: "https://github.com/hookdoctor/hookdoctor",
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}
