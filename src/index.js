import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfigOrigins } from "./config-origin.js";
import { loadConfig } from "./config.js";
import { getRepoContext, HookDoctorError } from "./git.js";
import { inspectHooksDirectory } from "./hooks-dir.js";
import { detectManagers } from "./managers/index.js";
import { readPackageJson } from "./npm-scripts.js";
import { readNpmrcAndEnv } from "./npmrc.js";
import { evaluateRules } from "./rules/index.js";
import { explainHook } from "./why.js";

export { HookDoctorError };

const PKG_VERSION = (() => {
  try {
    const raw = fs.readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" ? parsed.version : "0.1.0";
  } catch {
    return "0.1.0";
  }
})();

/**
 * @typedef {object} DiagnoseOptions
 * @property {string | null} [configPath]
 * @property {boolean} [ci]
 * @property {NodeJS.Platform} [platform]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string | null} [homeDir]
 * @property {import("./git.js").GitRunner} [gitRunner]
 */

/**
 * @typedef {object} DiagnosisReport
 * @property {string} version
 * @property {import("./git.js").RepoContext} repo
 * @property {import("./config-origin.js").ConfigOriginSummary} configOrigins
 * @property {import("./hooks-dir.js").HooksDirectoryInspection} hooksDir
 * @property {import("./managers/index.js").ManagerDetectionResult[]} managers
 * @property {import("./npmrc.js").NpmrcAndEnvSummary} npmrcEnv
 * @property {import("./npm-scripts.js").PackageJsonInfo} pkg
 * @property {import("./rules/index.js").Finding[]} findings
 * @property {import("./rules/index.js").HookStatusEntry[]} hookTable
 * @property {Map<string, import("./shebang.js").ShebangAnalysis>} shebangByHook
 * @property {import("./config.js").HookDoctorConfig} config
 * @property {string | null} homeDir
 */

/**
 * Run a full read-only Git hook diagnosis on `targetDir`.
 * @param {string} [targetDir=process.cwd()]
 * @param {DiagnoseOptions} [options]
 * @returns {Promise<DiagnosisReport>}
 */
export async function diagnose(targetDir = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir !== undefined ? options.homeDir : os.homedir();
  const resolvedTarget = path.resolve(targetDir);

  if (!fs.existsSync(resolvedTarget)) {
    throw new HookDoctorError("USAGE", `Target path does not exist: ${resolvedTarget}`);
  }

  const repo = await getRepoContext(resolvedTarget, {
    gitRunner: options.gitRunner,
    env,
  });

  const config = loadConfig(repo.repoRoot, options.configPath ?? null);
  const configOrigins = await readConfigOrigins(repo.cwd, repo.gitVersion, {
    gitRunner: options.gitRunner,
    env,
  });

  const hooksDir = inspectHooksDirectory(repo, configOrigins, { platform });
  const pkg = readPackageJson(repo.repoRoot);
  const npmrcEnv = readNpmrcAndEnv(repo.repoRoot, homeDir, env);
  const managers = detectManagers({
    repoRoot: repo.repoRoot,
    homeDir,
    pkg,
    hooksDir,
  });

  const { findings, hookTable, shebangByHook } = evaluateRules({
    repo,
    configOrigins,
    hooksDir,
    managers,
    npmrcEnv,
    pkg,
    homeDir,
    platform,
    envPath: env.PATH,
    pathExt: env.PATHEXT,
    ciMode: options.ci === true,
    expectedManagers: config.expectedManagers,
    ignoredRules: config.ignore,
  });

  return {
    version: PKG_VERSION,
    repo,
    configOrigins,
    hooksDir,
    managers,
    npmrcEnv,
    pkg,
    findings,
    hookTable,
    shebangByHook,
    config,
    homeDir,
  };
}

/**
 * Explain the decision chain for a single Git hook in `targetDir`.
 * @param {string} hookName
 * @param {string} [targetDir=process.cwd()]
 * @param {DiagnoseOptions} [options]
 * @returns {Promise<{ report: DiagnosisReport, explanation: import("./why.js").HookExplanation }>}
 */
export async function why(hookName, targetDir = process.cwd(), options = {}) {
  const report = await diagnose(targetDir, options);
  const explanation = explainHook(report, hookName);
  return { report, explanation };
}
