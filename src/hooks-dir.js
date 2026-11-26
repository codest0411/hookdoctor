import fs from "node:fs";
import path from "node:path";
import { stripControlChars } from "./sanitize.js";

const MAX_DIR_ENTRIES = 500;

/**
 * @typedef {object} HookFileEntry
 * @property {string} name
 * @property {string} fullPath
 * @property {boolean} isExecutable
 * @property {boolean} isSymlink
 * @property {boolean} isDirectory
 */

/**
 * @typedef {object} HooksDirectoryInspection
 * @property {string} effectiveHooksDir
 * @property {string} defaultHooksDir
 * @property {boolean} usesCustomHooksPath
 * @property {boolean} effectiveDirExists
 * @property {boolean} effectiveDirIsDirectory
 * @property {HookFileEntry[]} effectiveHooks
 * @property {HookFileEntry[]} orphanedDefaultHooks
 * @property {string | null} execCheckSkippedReason
 */

/**
 * List non-sample entries in a hooks directory safely (bounded to MAX_DIR_ENTRIES).
 * @param {string} dirPath
 * @param {NodeJS.Platform} platform
 * @returns {{ exists: boolean, isDirectory: boolean, entries: HookFileEntry[] }}
 */
function scanHooksDir(dirPath, platform) {
  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    return { exists: false, isDirectory: false, entries: [] };
  }

  if (!stat.isDirectory()) {
    return { exists: true, isDirectory: false, entries: [] };
  }

  let dirents;
  try {
    dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return { exists: true, isDirectory: true, entries: [] };
  }

  /** @type {HookFileEntry[]} */
  const entries = [];
  for (const dirent of dirents) {
    if (entries.length >= MAX_DIR_ENTRIES) break;
    if (dirent.name.endsWith(".sample")) continue;

    const fullPath = path.join(dirPath, dirent.name);
    let isSymlink = dirent.isSymbolicLink();
    let fileStat;
    try {
      fileStat = fs.statSync(fullPath);
    } catch {
      // Broken symlink or unreadable entry
      entries.push({
        name: stripControlChars(dirent.name),
        fullPath,
        isExecutable: false,
        isSymlink,
        isDirectory: false,
      });
      continue;
    }

    const isDirectory = fileStat.isDirectory();
    if (isDirectory) continue;

    const isExecutable = platform === "win32" ? true : (fileStat.mode & 0o111) !== 0;
    if (!isSymlink) {
      try {
        isSymlink = fs.lstatSync(fullPath).isSymbolicLink();
      } catch {
        // ignore
      }
    }

    entries.push({
      name: stripControlChars(dirent.name),
      fullPath,
      isExecutable,
      isSymlink,
      isDirectory: false,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { exists: true, isDirectory: true, entries };
}

/**
 * Inspect the effective hooks directory and check for orphaned `.git/hooks` entries.
 * @param {import("./git.js").RepoContext} repo
 * @param {import("./config-origin.js").ConfigOriginSummary} configOrigins
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {HooksDirectoryInspection}
 */
export function inspectHooksDirectory(repo, configOrigins, options = {}) {
  const platform = options.platform ?? process.platform;
  const effectiveHooksDir = path.resolve(repo.gitPathHooks);
  const defaultHooksDir = path.resolve(repo.gitCommonDir, "hooks");

  const normEffective =
    platform === "win32" ? effectiveHooksDir.toLowerCase() : effectiveHooksDir;
  const normDefault = platform === "win32" ? defaultHooksDir.toLowerCase() : defaultHooksDir;
  const usesCustomHooksPath =
    configOrigins.effectiveHooksPath !== null || normEffective !== normDefault;

  const effectiveScan = scanHooksDir(effectiveHooksDir, platform);

  /** @type {HookFileEntry[]} */
  let orphanedDefaultHooks = [];
  if (usesCustomHooksPath && normEffective !== normDefault) {
    const defaultScan = scanHooksDir(defaultHooksDir, platform);
    orphanedDefaultHooks = defaultScan.entries;
  }

  let execCheckSkippedReason = null;
  if (platform === "win32") {
    execCheckSkippedReason =
      "Windows filesystems do not use POSIX executable permission bits; executable check skipped.";
  } else if (configOrigins.coreFileMode === false) {
    execCheckSkippedReason =
      "core.fileMode is false in Git config; executable permission check skipped.";
  }

  return {
    effectiveHooksDir,
    defaultHooksDir,
    usesCustomHooksPath,
    effectiveDirExists: effectiveScan.exists,
    effectiveDirIsDirectory: effectiveScan.isDirectory,
    effectiveHooks: effectiveScan.entries,
    orphanedDefaultHooks,
    execCheckSkippedReason,
  };
}
