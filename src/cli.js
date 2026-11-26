import { parseArgs } from "node:util";
import { diagnose, HookDoctorError, why } from "./index.js";
import {
  formatGithubReport,
  formatHumanReport,
  formatJsonReport,
  formatSarifReport,
  formatWhyHuman,
} from "./reporters/index.js";

const VALID_FORMATS = new Set(["human", "json", "github", "sarif"]);
const VALID_FAIL_ON = new Set(["error", "warn", "never"]);

const HELP_TEXT = `hookdoctor - Offline, read-only Git hook diagnostics

Usage:
  hookdoctor [path] [options]
  hookdoctor why <hook-name> [path] [options]

Options:
  --format <fmt>     Output format: human | json | github | sarif (default: human)
  --fail-on <lvl>    Exit 1 threshold: error | warn | never (default: error)
  --ci               Treat CI environment detection as informational
  --no-color         Disable ANSI colors in human output
  --config <path>    Path to .hookdoctorrc.json
  -h, --help         Show this help
  -v, --version      Show version

Exit codes:
  0  Healthy (no findings at or above --fail-on)
  1  Findings at or above --fail-on
  2  Usage or runtime error (not a git repo, git missing/too old, dubious ownership)
`;

/**
 * Compute exit code 0 or 1 from findings and fail-on threshold.
 * @param {import("./rules/index.js").Finding[]} findings
 * @param {"error" | "warn" | "never"} failOn
 * @returns {number}
 */
function computeExitCode(findings, failOn) {
  if (failOn === "never") return 0;
  if (failOn === "error") {
    return findings.some((f) => f.severity === "error") ? 1 : 0;
  }
  return findings.some((f) => f.severity === "error" || f.severity === "warn") ? 1 : 0;
}

/**
 * Run the hookdoctor CLI with explicit argv and streams (testable without spawning).
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, isTTY?: boolean, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, gitRunner?: import("./git.js").GitRunner, cwd?: string }} [io]
 * @returns {Promise<number>}
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s) => process.stderr.write(s));
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", default: "human" },
        "fail-on": { type: "string" },
        ci: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
        config: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`Error: ${msg}\n\n${HELP_TEXT}`);
    return 2;
  }

  if (parsed.values.help) {
    stdout(HELP_TEXT);
    return 0;
  }

  const format = typeof parsed.values.format === "string" ? parsed.values.format : "human";
  if (!VALID_FORMATS.has(format)) {
    stderr(`Error: Invalid --format "${format}". Expected: human, json, github, sarif.\n`);
    return 2;
  }

  const rawFailOn = parsed.values["fail-on"];
  const cliFailOn = typeof rawFailOn === "string" ? rawFailOn : undefined;
  if (cliFailOn !== undefined && !VALID_FAIL_ON.has(cliFailOn)) {
    stderr(`Error: Invalid --fail-on "${cliFailOn}". Expected: error, warn, never.\n`);
    return 2;
  }
  const configPath = typeof parsed.values.config === "string" ? parsed.values.config : null;

  const positionals = parsed.positionals;
  const isWhy = positionals[0] === "why";

  try {
    if (parsed.values.version) {
      const { readFileSync } = await import("node:fs");
      const pkgRaw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
      const pkg = JSON.parse(pkgRaw);
      stdout(`${pkg.version ?? "0.1.0"}\n`);
      return 0;
    }

    const useColor =
      !parsed.values["no-color"] &&
      env.NO_COLOR === undefined &&
      Boolean(io.isTTY ?? process.stdout.isTTY);

    if (isWhy) {
      const hookName = positionals[1];
      if (!hookName) {
        stderr("Error: `hookdoctor why <hook-name>` requires a hook name.\n");
        return 2;
      }
      const targetDir = positionals[2] ?? cwd;
      const { report, explanation } = await why(hookName, targetDir, {
        configPath,
        ci: parsed.values.ci === true,
        env,
        platform: io.platform,
        gitRunner: io.gitRunner,
      });

      if (format === "json") {
        stdout(JSON.stringify(explanation, null, 2) + "\n");
      } else {
        stdout(formatWhyHuman(explanation, { color: useColor }));
      }

      const failOn = /** @type {"error" | "warn" | "never"} */ (
        cliFailOn ?? report.config.failOn ?? "error"
      );
      if (explanation.verdict === "WILL NOT RUN") return failOn === "never" ? 0 : 1;
      if (explanation.verdict === "MAY FAIL" && failOn === "warn") return 1;
      return 0;
    }

    const targetDir = positionals[0] ?? cwd;
    const report = await diagnose(targetDir, {
      configPath,
      ci: parsed.values.ci === true,
      env,
      platform: io.platform,
      gitRunner: io.gitRunner,
    });

    if (format === "json") {
      stdout(formatJsonReport(report));
    } else if (format === "github") {
      stdout(formatGithubReport(report));
    } else if (format === "sarif") {
      stdout(formatSarifReport(report));
    } else {
      stdout(formatHumanReport(report, { color: useColor }));
    }

    const failOn = /** @type {"error" | "warn" | "never"} */ (
      cliFailOn ?? report.config.failOn ?? "error"
    );
    return computeExitCode(report.findings, failOn);
  } catch (err) {
    if (err instanceof HookDoctorError) {
      stderr(`Error [${err.code}]: ${err.message}\n`);
      return err.exitCode;
    }
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`Unexpected error: ${msg}\n`);
    return 2;
  }
}
