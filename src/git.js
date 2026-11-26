import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { stripControlChars } from "./sanitize.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 1024 * 1024;
const ALLOWED_GIT_SUBCOMMANDS = new Set(["--version", "rev-parse", "config"]);

/**
 * Structured runtime error for exit code 2 conditions.
 */
export class HookDoctorError extends Error {
  /**
   * @param {"GIT_MISSING" | "GIT_TOO_OLD" | "NOT_GIT_REPO" | "UNSAFE_OWNERSHIP" | "INVALID_CONFIG" | "USAGE" | "GIT_ERROR"} code
   * @param {string} message
   * @param {number} [exitCode=2]
   */
  constructor(code, message, exitCode = 2) {
    super(message);
    this.name = "HookDoctorError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/**
 * @typedef {object} GitVersion
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {string} raw
 * @property {boolean} supportsShowOrigin
 * @property {boolean} supportsShowScope
 */

/**
 * @typedef {object} RepoContext
 * @property {string} cwd
 * @property {string | null} repoRoot
 * @property {string} gitDir
 * @property {string} gitCommonDir
 * @property {string} gitPathHooks
 * @property {boolean} isBare
 * @property {boolean} isWorktree
 * @property {GitVersion} gitVersion
 */

/**
 * @typedef {(args: string[], opts: { cwd: string, env: NodeJS.ProcessEnv }) => Promise<{ stdout: string, stderr: string }>} GitRunner
 */

/**
 * Default read-only git runner using execFile with shell: false.
 * Only whitelisted plumbing subcommands are allowed.
 * @param {string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function runGit(args, opts) {
  const first = args[0];
  if (!first || !ALLOWED_GIT_SUBCOMMANDS.has(first)) {
    throw new HookDoctorError("GIT_ERROR", `Disallowed git subcommand: ${String(first)}`);
  }

  const env = {
    ...process.env,
    ...(opts.env ?? {}),
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };

  try {
    const res = await execFileAsync("git", args, {
      cwd: opts.cwd,
      env,
      shell: false,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr : "",
    };
  } catch (err) {
    if (err && typeof err === "object") {
      const e = /** @type {{ code?: string | number, stderr?: string, message?: string }} */ (err);
      if (e.code === "ENOENT") {
        throw new HookDoctorError(
          "GIT_MISSING",
          "Git executable was not found on PATH. Install Git >= 2.8.0 (2.26.0+ recommended)."
        );
      }
      const stderr = stripControlChars(typeof e.stderr === "string" ? e.stderr : e.message ?? "");
      if (stderr.toLowerCase().includes("detected dubious ownership")) {
        throw new HookDoctorError(
          "UNSAFE_OWNERSHIP",
          `Git refused to inspect this repository due to dubious ownership:\n${stderr}\nVerify repository ownership before running \`git config --global --add safe.directory <path>\` manually. hookdoctor never modifies safe.directory.`
        );
      }
      if (stderr.toLowerCase().includes("not a git repository")) {
        throw new HookDoctorError(
          "NOT_GIT_REPO",
          "Target path is not inside a Git repository."
        );
      }
      throw new HookDoctorError("GIT_ERROR", `Git command failed: ${stderr}`);
    }
    throw new HookDoctorError("GIT_ERROR", "Git command failed with an unknown error.");
  }
}

/**
 * Parse `git --version` output into major/minor/patch and feature flags.
 * @param {string} rawOutput
 * @returns {GitVersion}
 */
export function parseGitVersion(rawOutput) {
  const clean = stripControlChars(rawOutput).trim();
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(clean);
  if (!match) {
    throw new HookDoctorError("GIT_TOO_OLD", `Unable to parse git version from "${clean}".`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? "0");

  const supportsShowOrigin = major > 2 || (major === 2 && minor >= 8);
  const supportsShowScope = major > 2 || (major === 2 && minor >= 26);

  if (!supportsShowOrigin) {
    throw new HookDoctorError(
      "GIT_TOO_OLD",
      `Git ${major}.${minor}.${patch} is too old. hookdoctor requires Git >= 2.8.0 (2.26.0+ recommended for --show-scope).`
    );
  }

  return {
    major,
    minor,
    patch,
    raw: clean,
    supportsShowOrigin,
    supportsShowScope,
  };
}

/**
 * Gather read-only Git repository context for `targetDir`.
 * @param {string} targetDir
 * @param {{ gitRunner?: GitRunner, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<RepoContext>}
 */
export async function getRepoContext(targetDir, options = {}) {
  const runner = options.gitRunner ?? runGit;
  const env = options.env ?? process.env;
  const cwd = path.resolve(targetDir);

  const verRes = await runner(["--version"], { cwd, env });
  const gitVersion = parseGitVersion(verRes.stdout);

  const revRes = await runner(
    [
      "rev-parse",
      "--is-bare-repository",
      "--git-dir",
      "--git-common-dir",
      "--git-path",
      "hooks",
    ],
    { cwd, env }
  );

  const lines = revRes.stdout.replaceAll("\r\n", "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length < 4) {
    throw new HookDoctorError("GIT_ERROR", "Unexpected output from git rev-parse.");
  }

  const isBare = lines[0]?.trim() === "true";
  const gitDir = path.resolve(cwd, lines[1] ?? ".git");
  const gitCommonDir = path.resolve(cwd, lines[2] ?? ".git");
  const gitPathHooks = path.resolve(cwd, lines[3] ?? ".git/hooks");

  let repoRoot = null;
  if (!isBare) {
    const topRes = await runner(["rev-parse", "--show-toplevel"], { cwd, env });
    const topLine = topRes.stdout.trim();
    if (topLine) {
      repoRoot = path.resolve(cwd, topLine);
    }
  }

  const isWorktree = path.resolve(gitDir).toLowerCase() !== path.resolve(gitCommonDir).toLowerCase();

  return {
    cwd,
    repoRoot,
    gitDir,
    gitCommonDir,
    gitPathHooks,
    isBare,
    isWorktree,
    gitVersion,
  };
}
