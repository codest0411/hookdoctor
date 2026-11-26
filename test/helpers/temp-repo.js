import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Create an isolated temporary Git repository with its own global/system config and HOME.
 * @param {{ bare?: boolean }} [options]
 * @returns {{
 *   root: string,
 *   repoDir: string,
 *   homeDir: string,
 *   globalGitConfig: string,
 *   env: Record<string, string | undefined>,
 *   git: (args: string[], cwd?: string) => string,
 *   writeFile: (relPath: string, content: string, opts?: { mode?: number }) => string,
 *   cleanup: () => void
 * }}
 */
export function createTempRepo(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hookdoctor-test-"));
  const homeDir = path.join(root, "home");
  const xdgConfig = path.join(root, "xdg");
  const repoDir = path.join(root, "repo");
  const globalGitConfig = path.join(homeDir, ".gitconfig");
  const systemGitConfig = path.join(root, "gitconfig.system");

  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(xdgConfig, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(globalGitConfig, "", "utf8");
  fs.writeFileSync(systemGitConfig, "", "utf8");

  /** @type {Record<string, string | undefined>} */
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: xdgConfig,
    GIT_CONFIG_GLOBAL: globalGitConfig,
    GIT_CONFIG_SYSTEM: systemGitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  delete env.CI;
  delete env.HUSKY;
  delete env.npm_config_ignore_scripts;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;

  /**
   * @param {string[]} args
   * @param {string} [cwd]
   * @returns {string}
   */
  const git = (args, cwd = repoDir) => {
    return execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      windowsHide: true,
    });
  };

  if (options.bare) {
    git(["init", "--bare", "."]);
  } else {
    git(["init", "."]);
    git(["config", "user.name", "HookDoctor Test"]);
    git(["config", "user.email", "test@example.com"]);
  }

  /**
   * @param {string} relPath
   * @param {string} content
   * @param {{ mode?: number }} [opts]
   * @returns {string}
   */
  const writeFile = (relPath, content, opts = {}) => {
    const full = path.join(repoDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    if (opts.mode !== undefined && process.platform !== "win32") {
      fs.chmodSync(full, opts.mode);
    }
    return full;
  };

  const cleanup = () => {
    fs.rmSync(root, { recursive: true, force: true });
  };

  return { root, repoDir, homeDir, globalGitConfig, env, git, writeFile, cleanup };
}
