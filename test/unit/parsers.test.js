import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseGitConfigNullOutput } from "../../src/config-origin.js";
import { loadConfig } from "../../src/config.js";
import { HookDoctorError, parseGitVersion, runGit } from "../../src/git.js";
import { extractScriptReferences } from "../../src/npm-scripts.js";
import { parseNpmrcIgnoreScripts } from "../../src/npmrc.js";
import { findExecutableOnPath } from "../../src/path-lookup.js";
import {
  escapeGithubAnnotation,
  formatDisplayPath,
  safeReadFile,
  sanitizeSnippet,
  stripControlChars,
  toPosixPath,
} from "../../src/sanitize.js";
import { analyzeShebang } from "../../src/shebang.js";

describe("sanitize utilities", () => {
  it("strips ANSI CSI/OSC and control characters", () => {
    const dirty = "pre-\x1b[31mcommit\x1b[0m\x07\x00\nline2\x1b]0;title\x07!";
    const clean = stripControlChars(dirty);
    assert.equal(clean, "pre-commit line2!");
    assert.equal(stripControlChars("a\nb\tc", { preserveNewlines: true }), "a\nb\tc");
  });

  it("escapes GitHub workflow command characters", () => {
    const escaped = escapeGithubAnnotation("100%\r\n::error::inject");
    assert.equal(escaped, "100%25%0D%0A%3A%3Aerror%3A%3Ainject");
  });

  it("truncates snippets and formats display paths", () => {
    assert.equal(sanitizeSnippet("abcdef", 5), "ab...");
    assert.equal(toPosixPath("a\\b\\c"), "a/b/c");
    const home = path.resolve(os.tmpdir(), "fake-home");
    const repo = path.resolve(home, "proj");
    assert.equal(formatDisplayPath(path.join(repo, ".husky", "pre-commit"), repo, home), ".husky/pre-commit");
    assert.equal(formatDisplayPath(path.join(home, ".npmrc"), repo, home), "~/.npmrc");
  });

  it("safeReadFile strips UTF-8 BOM, caps size, and blocks out-of-bounds paths", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hd-safe-read-"));
    try {
      const allowed = path.join(tmp, "allowed");
      const outside = path.join(tmp, "outside");
      fs.mkdirSync(allowed);
      fs.mkdirSync(outside);
      const bomFile = path.join(allowed, "bom.sh");
      fs.writeFileSync(bomFile, "\uFEFF#!/bin/sh\necho hi\n", "utf8");
      const res = safeReadFile(bomFile, { allowedRoots: [allowed], maxBytes: 16 });
      assert.equal(res.ok, true);
      assert.equal(res.truncated, true);
      assert.equal(res.content.startsWith("#!/bin/sh"), true);

      const secret = path.join(outside, "secret.txt");
      fs.writeFileSync(secret, "top-secret", "utf8");
      const blocked = safeReadFile(secret, { allowedRoots: [allowed] });
      assert.equal(blocked.ok, false);
      assert.match(blocked.reason ?? "", /outside allowed/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("git version & config parser", () => {
  it("parses supported and unsupported git versions", () => {
    const v252 = parseGitVersion("git version 2.52.0.windows.1");
    assert.equal(v252.supportsShowOrigin, true);
    assert.equal(v252.supportsShowScope, true);

    const v210 = parseGitVersion("git version 2.10.1");
    assert.equal(v210.supportsShowOrigin, true);
    assert.equal(v210.supportsShowScope, false);

    assert.throws(() => parseGitVersion("git version 2.7.4"), HookDoctorError);
    assert.throws(() => parseGitVersion("not a version"), HookDoctorError);
  });

  it("rejects non-whitelisted git subcommands", async () => {
    await assert.rejects(() => runGit(["status"], { cwd: process.cwd() }), HookDoctorError);
  });

  it("parses git config --list --null output", () => {
    const raw =
      "global\0file:/home/u/.gitconfig\0core.hookspath\n/tmp/h\0" +
      "local\0file:.git/config\0core.hookspath\n.husky/_\0";
    const parsed = parseGitConfigNullOutput(raw, true);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.scope, "global");
    assert.equal(parsed[1]?.value, ".husky/_");
  });
});

describe("path-lookup & shebang", () => {
  it("resolves executables on injected PATH with PATHEXT on win32", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hd-path-"));
    try {
      const binDir = path.join(tmp, "bin");
      fs.mkdirSync(binDir);
      const nodeCmd = path.join(binDir, "node.EXE");
      fs.writeFileSync(nodeCmd, "stub", "utf8");
      const found = findExecutableOnPath("node", {
        envPath: binDir,
        platform: "win32",
        pathExt: ".EXE;.CMD",
      });
      assert.equal(found, nodeCmd);
      assert.equal(findExecutableOnPath("missing-tool", { envPath: binDir, platform: "win32" }), null);
      assert.equal(findExecutableOnPath("bad\0cmd", { envPath: binDir }), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("analyzes shebangs for missing, CRLF, env, and direct interpreters", () => {
    assert.equal(analyzeShebang("   \n").status, "empty-file");
    assert.equal(analyzeShebang("echo hi\n").status, "missing-shebang");
    assert.equal(analyzeShebang("#!\n").status, "invalid-shebang");
    assert.equal(analyzeShebang("#!/bin/sh\r\necho hi\n").status, "crlf-shebang");
    assert.equal(analyzeShebang("#!/usr/bin/env\necho hi\n").status, "invalid-shebang");
    assert.equal(
      analyzeShebang("#!/usr/bin/env definitely_missing_bin_xyz\n", { envPath: "" }).status,
      "env-interpreter-not-found"
    );
    assert.equal(
      analyzeShebang("#!/nonexistent/interp/xyz\n", { platform: "linux" }).status,
      "interpreter-not-found"
    );
    assert.equal(
      analyzeShebang("#!/bin/sh\necho ok\n", { platform: "win32" }).status,
      "ok"
    );
  });
});

describe("npmrc, npm-scripts, and config validation", () => {
  it("parses .npmrc ignore-scripts", () => {
    assert.equal(parseNpmrcIgnoreScripts("# comment\nignore-scripts = true\n"), true);
    assert.equal(parseNpmrcIgnoreScripts("ignore-scripts=false\n"), false);
  });

  it("extracts high and low confidence script references", () => {
    const refs = extractScriptReferences(
      "# npm run ignored\nnpm run lint\nnpm test\npnpm run build\npnpm check\nyarn install\n"
    );
    assert.deepEqual(
      refs.map((r) => [r.runner, r.scriptName, r.confidence]),
      [
        ["npm", "lint", "high"],
        ["npm", "test", "high"],
        ["pnpm", "build", "high"],
        ["pnpm", "check", "low"],
      ]
    );
  });

  it("validates .hookdoctorrc.json strictly", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hd-cfg-"));
    try {
      const cfgPath = path.join(tmp, ".hookdoctorrc.json");
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          ignore: [{ rule: "HD006", reason: "Intentional on CI" }],
          expectedManagers: ["husky"],
          failOn: "warn",
        })
      );
      const cfg = loadConfig(tmp, null);
      assert.equal(cfg.ignore.get("HD006"), "Intentional on CI");
      assert.deepEqual(cfg.expectedManagers, ["husky"]);
      assert.equal(cfg.failOn, "warn");

      fs.writeFileSync(cfgPath, JSON.stringify({ unknownKey: 1 }));
      assert.throws(() => loadConfig(tmp, null), HookDoctorError);

      fs.writeFileSync(cfgPath, JSON.stringify({ ignore: [{ rule: "HD006", reason: "" }] }));
      assert.throws(() => loadConfig(tmp, null), HookDoctorError);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
