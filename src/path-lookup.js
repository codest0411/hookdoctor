import fs from "node:fs";
import path from "node:path";

const DEFAULT_WIN_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

/**
 * Check if a path is an executable regular file (or regular file on Windows).
 * @param {string} filePath
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
function isExecutableFile(filePath, platform) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === "win32") return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Resolve a command name on PATH without executing anything.
 * @param {string} command
 * @param {{ envPath?: string, platform?: NodeJS.Platform, pathExt?: string }} [options]
 * @returns {string | null}
 */
export function findExecutableOnPath(command, options = {}) {
  const cmd = command.trim();
  if (!cmd || cmd.includes("\0") || cmd.includes("\n") || cmd.includes("\r")) {
    return null;
  }

  const platform = options.platform ?? process.platform;
  const envPath = options.envPath ?? process.env.PATH ?? "";
  if (!envPath) return null;

  const delimiter = platform === "win32" ? ";" : ":";
  const dirs = envPath.split(delimiter).filter((d) => d.length > 0);

  /** @type {string[]} */
  let extensions = [""];
  if (platform === "win32") {
    const rawExt = options.pathExt ?? process.env.PATHEXT ?? DEFAULT_WIN_PATHEXT.join(";");
    const parsed = rawExt
      .split(";")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    const hasExt = path.extname(cmd).length > 0;
    extensions = hasExt ? ["", ...parsed] : [...parsed, ""];
  }

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, ext ? `${cmd}${ext}` : cmd);
      if (isExecutableFile(candidate, platform)) {
        return candidate;
      }
    }
  }

  return null;
}
