import fs from "node:fs";
import path from "node:path";

/**
 * Standard client-side and server-side Git hook names documented in githooks(5).
 * @type {readonly string[]}
 */
export const STANDARD_GIT_HOOKS = Object.freeze([
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "reference-transaction",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-submit",
  "p4-pre-submit",
  "post-index-change",
]);

/**
 * Strip ANSI escape sequences and ASCII/Unicode control characters in linear time.
 * Never uses nested quantifiers so adversarial inputs cannot cause ReDoS.
 * @param {string} input
 * @param {{ preserveNewlines?: boolean }} [options]
 * @returns {string}
 */
export function stripControlChars(input, options = {}) {
  const preserveNewlines = options.preserveNewlines === true;
  let out = "";
  let i = 0;
  const len = input.length;

  while (i < len) {
    const code = input.charCodeAt(i);

    // Strip ANSI CSI / OSC / single-char ESC sequences.
    if (code === 0x1b) {
      i += 1;
      if (i < len && input[i] === "[") {
        i += 1;
        while (i < len) {
          const c = input.charCodeAt(i);
          i += 1;
          if (c >= 0x40 && c <= 0x7e) break;
        }
      } else if (i < len && input[i] === "]") {
        i += 1;
        while (i < len) {
          const c = input.charCodeAt(i);
          if (c === 0x07) {
            i += 1;
            break;
          }
          if (c === 0x1b && i + 1 < len && input[i + 1] === "\\") {
            i += 2;
            break;
          }
          i += 1;
        }
      }
      continue;
    }

    if (preserveNewlines && (code === 0x0a || code === 0x0d || code === 0x09)) {
      out += input[i];
      i += 1;
      continue;
    }

    // Replace CR/LF/TAB with space when single-line sanitization is requested.
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      out += " ";
      i += 1;
      continue;
    }

    // Drop C0 (0x00-0x1F), DEL (0x7F), and C1 (0x80-0x9F) control chars.
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      i += 1;
      continue;
    }

    out += input[i];
    i += 1;
  }

  return out;
}

/**
 * Truncate a string safely to maxLen characters after stripping control chars.
 * @param {string} input
 * @param {number} [maxLen=160]
 * @returns {string}
 */
export function sanitizeSnippet(input, maxLen = 160) {
  // Slice before stripping when input is huge so repeated calls on long lines stay O(maxLen).
  const bounded = input.length > maxLen * 4 ? input.slice(0, maxLen * 4) : input;
  const clean = stripControlChars(bounded);
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 3))}...`;
}

/**
 * Escape a string for safe emission inside GitHub Actions workflow commands (::error, ::warning, etc.).
 * @param {string} input
 * @returns {string}
 */
export function escapeGithubAnnotation(input) {
  return stripControlChars(input, { preserveNewlines: true })
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll("::", "%3A%3A");
}

/**
 * Convert Windows backslashes to POSIX forward slashes.
 * @param {string} p
 * @returns {string}
 */
export function toPosixPath(p) {
  return p.replaceAll("\\", "/");
}

/**
 * Check whether `candidate` is equal to or inside `rootDir` (case-insensitive on win32).
 * @param {string} candidate
 * @param {string} rootDir
 * @param {NodeJS.Platform} [platform=process.platform]
 * @returns {boolean}
 */
export function isPathInside(candidate, rootDir, platform = process.platform) {
  const normCandidate = path.resolve(candidate);
  const normRoot = path.resolve(rootDir);
  if (platform === "win32") {
    const cLower = normCandidate.toLowerCase();
    const rLower = normRoot.toLowerCase();
    if (cLower === rLower) return true;
    const prefix = rLower.endsWith(path.sep) ? rLower : rLower + path.sep;
    return cLower.startsWith(prefix);
  }
  if (normCandidate === normRoot) return true;
  const prefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
  return normCandidate.startsWith(prefix);
}

/**
 * Format a filesystem path for display: relative to repoRoot if inside, `~/...` if inside homeDir, POSIX slashes, sanitized.
 * @param {string} targetPath
 * @param {string | null} repoRoot
 * @param {string | null} homeDir
 * @returns {string}
 */
export function formatDisplayPath(targetPath, repoRoot, homeDir) {
  const resolvedTarget = path.resolve(targetPath);
  if (repoRoot) {
    const resolvedRepo = path.resolve(repoRoot);
    if (isPathInside(resolvedTarget, resolvedRepo)) {
      const rel = path.relative(resolvedRepo, resolvedTarget);
      return stripControlChars(toPosixPath(rel || "."));
    }
  }
  if (homeDir) {
    const resolvedHome = path.resolve(homeDir);
    if (isPathInside(resolvedTarget, resolvedHome)) {
      const rel = path.relative(resolvedHome, resolvedTarget);
      const posixRel = toPosixPath(rel);
      return stripControlChars(posixRel ? `~/${posixRel}` : "~");
    }
  }
  return stripControlChars(toPosixPath(resolvedTarget));
}

/**
 * @typedef {object} SafeReadResult
 * @property {boolean} ok
 * @property {string} content
 * @property {boolean} truncated
 * @property {string | null} reason
 */

/**
 * Safely read a UTF-8 text file within allowed roots (resolving symlinks via realpath).
 * Never follows symlinks outside `allowedRoots` or `allowedExactFiles`.
 * Caps bytes read to `maxBytes` to prevent memory exhaustion on huge files.
 * @param {string} filePath
 * @param {{ allowedRoots: string[], allowedExactFiles?: string[], maxBytes?: number }} options
 * @returns {SafeReadResult}
 */
export function safeReadFile(filePath, options) {
  const maxBytes = options.maxBytes ?? 65536;
  const allowedExact = options.allowedExactFiles ?? [];

  let realTarget;
  try {
    realTarget = fs.realpathSync(filePath);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "ERR";
    return { ok: false, content: "", truncated: false, reason: `unreadable (${code})` };
  }

  let insideAllowed = false;
  for (const root of options.allowedRoots) {
    try {
      const realRoot = fs.realpathSync(root);
      if (isPathInside(realTarget, realRoot)) {
        insideAllowed = true;
        break;
      }
    } catch {
      // Ignore missing allowed root
    }
  }

  if (!insideAllowed) {
    for (const exact of allowedExact) {
      try {
        const realExact = fs.realpathSync(exact);
        if (
          process.platform === "win32"
            ? realTarget.toLowerCase() === realExact.toLowerCase()
            : realTarget === realExact
        ) {
          insideAllowed = true;
          break;
        }
      } catch {
        // Ignore missing exact file
      }
    }
  }

  if (!insideAllowed) {
    return {
      ok: false,
      content: "",
      truncated: false,
      reason: "symlink or path resolves outside allowed repository boundaries",
    };
  }

  let stat;
  try {
    stat = fs.statSync(realTarget);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "ERR";
    return { ok: false, content: "", truncated: false, reason: `stat failed (${code})` };
  }

  if (!stat.isFile()) {
    return { ok: false, content: "", truncated: false, reason: "not a regular file" };
  }

  const toRead = Math.min(stat.size, maxBytes);
  const buf = Buffer.alloc(toRead);
  let fd;
  try {
    fd = fs.openSync(realTarget, "r");
    let offset = 0;
    while (offset < toRead) {
      const bytesRead = fs.readSync(fd, buf, offset, toRead - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const sub = /** @type {{ toString(enc?: string): string }} */ (
      /** @type {unknown} */ (buf.subarray(0, offset))
    );
    let text = sub.toString("utf8");
    if (text.startsWith("\uFEFF")) {
      text = text.slice(1);
    }
    return {
      ok: true,
      content: text,
      truncated: stat.size > maxBytes,
      reason: null,
    };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "ERR";
    return { ok: false, content: "", truncated: false, reason: `read failed (${code})` };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}
