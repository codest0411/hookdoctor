import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../../src/cli.js";
import { diagnose, HookDoctorError, why } from "../../src/index.js";
import { createTempRepo } from "../helpers/temp-repo.js";

describe("rules HD001-HD009 & why command", () => {
  it("HD001: flags declared husky that is not installed, and passes when installed", async () => {
    const t = createTempRepo();
    try {
      t.writeFile(
        "package.json",
        JSON.stringify({
          name: "app",
          scripts: { prepare: "husky", test: "echo ok" },
          devDependencies: { husky: "^9.0.0" },
        })
      );
      t.writeFile(".husky/pre-commit", "npm test\n");

      const bad = await diagnose(t.repoDir, { env: t.env, homeDir: t.homeDir });
      assert.ok(bad.findings.some((f) => f.id === "HD001" && f.severity === "error"));

      // Install husky v9 layout: .husky/_/pre-commit + core.hooksPath = .husky/_
      t.writeFile(".husky/_/h", "#!/bin/sh\n", { mode: 0o755 });
      t.writeFile(".husky/_/pre-commit", "#!/bin/sh\n. \"$(dirname \"$0\")/h\"\n", { mode: 0o755 });
      t.git(["config", "core.hooksPath", ".husky/_"]);

      const good = await diagnose(t.repoDir, {
        env: t.env,
        homeDir: t.homeDir,
        platform: "win32",
      });
      assert.equal(good.findings.some((f) => f.id === "HD001"), false);
      // Husky v9 .husky/pre-commit has no +x and no shebang, must NOT be flagged by HD004/HD005
      assert.equal(good.findings.some((f) => f.id === "HD004"), false);
      assert.equal(good.findings.some((f) => f.id === "HD005"), false);

      const whyRes = await why("pre-commit", t.repoDir, {
        env: t.env,
        homeDir: t.homeDir,
        platform: "win32",
      });
      assert.equal(whyRes.explanation.verdict, "WILL RUN");
    } finally {
      t.cleanup();
    }
  });

  it("HD001: detects lefthook, simple-git-hooks, and pre-commit (missing vs installed)", async () => {
    const t = createTempRepo();
    try {
      // simple-git-hooks
      t.writeFile(
        "package.json",
        JSON.stringify({
          name: "sgh",
          scripts: { prepare: "simple-git-hooks", lint: "echo lint" },
          devDependencies: { "simple-git-hooks": "^2.11.0" },
          "simple-git-hooks": { "pre-commit": "npm run lint" },
        })
      );
      const sghMissing = await diagnose(t.repoDir, { env: t.env, homeDir: t.homeDir });
      assert.ok(sghMissing.findings.some((f) => f.id === "HD001"));

      t.writeFile(
        ".git/hooks/pre-commit",
        "#!/bin/sh\n# SIMPLE_GIT_HOOKS\nnpm run lint\n",
        { mode: 0o755 }
      );
      const sghOk = await diagnose(t.repoDir, {
        env: t.env,
        homeDir: t.homeDir,
        platform: "win32",
      });
      assert.equal(sghOk.findings.some((f) => f.id === "HD001"), false);

      // lefthook + pre-commit -> triggers HD007 multiple managers too
      t.writeFile("lefthook.yml", "pre-commit:\n  commands:\n    lint:\n      run: npm run lint\n");
      t.writeFile(".pre-commit-config.yaml", "repos: []\n");
      const multi = await diagnose(t.repoDir, {
        env: t.env,
        homeDir: t.homeDir,
        platform: "win32",
      });
      assert.ok(multi.findings.some((f) => f.id === "HD007"));
    } finally {
      t.cleanup();
    }
  });

  it("HD002 & HD003: missing hooksPath dir, global override, and orphaned .git/hooks", async () => {
    const t = createTempRepo();
    try {
      t.writeFile(".git/hooks/pre-commit", "#!/bin/sh\necho old\n", { mode: 0o755 });
      t.git(["config", "--global", "core.hooksPath", "nonexistent-hooks-dir"]);

      const res = await diagnose(t.repoDir, { env: t.env, homeDir: t.homeDir });
      assert.ok(res.findings.some((f) => f.id === "HD002"));
      assert.ok(res.findings.some((f) => f.id === "HD003" && f.title.includes("global")));
      assert.ok(res.findings.some((f) => f.id === "HD003" && f.title.includes("orphaned")));

      const whyRes = await why("pre-commit", t.repoDir, { env: t.env, homeDir: t.homeDir });
      assert.equal(whyRes.explanation.verdict, "WILL NOT RUN");
    } finally {
      t.cleanup();
    }
  });

  it("HD004: checks executable bit on POSIX and skips on win32 or core.fileMode=false", async () => {
    const t = createTempRepo();
    try {
      t.writeFile(".git/hooks/pre-commit", "#!/bin/sh\necho hi\n", { mode: 0o644 });

      // On Windows, execCheckSkippedReason is set
      const winRes = await diagnose(t.repoDir, {
        env: t.env,
        homeDir: t.homeDir,
        platform: "win32",
      });
      assert.equal(winRes.findings.some((f) => f.id === "HD004"), false);
      assert.ok(winRes.hooksDir.execCheckSkippedReason?.includes("Windows"));

      // With core.fileMode=false on linux, execCheckSkippedReason is set
      t.git(["config", "core.fileMode", "false"]);
      const fmRes = await diagnose(t.repoDir, {
        env: t.env,
        homeDir: t.homeDir,
        platform: "linux",
      });
      assert.equal(fmRes.findings.some((f) => f.id === "HD004"), false);
      assert.ok(fmRes.hooksDir.execCheckSkippedReason?.includes("core.fileMode"));
    } finally {
      t.cleanup();
    }
  });

  it("HD005, HD006, HD008: CRLF shebang, ignore-scripts, HUSKY=0, CI, and missing npm script", async () => {
    const t = createTempRepo();
    try {
      t.writeFile(
        "package.json",
        JSON.stringify({
          name: "app",
          scripts: { test: "echo ok" },
          devDependencies: { husky: "^9.0.0" },
        })
      );
      t.writeFile(".npmrc", "ignore-scripts=true\n");
      t.writeFile(".husky/pre-commit", "npm run missing-lint\n");
      t.writeFile(".git/hooks/pre-push", "#!/bin/sh\r\nnpm run missing-push\n", { mode: 0o755 });

      const env = { ...t.env, HUSKY: "0", CI: "true", npm_config_ignore_scripts: "true" };
      const res = await diagnose(t.repoDir, { env, homeDir: t.homeDir, ci: false });

      assert.ok(res.findings.some((f) => f.id === "HD005" && f.severity === "error"));
      assert.ok(res.findings.some((f) => f.id === "HD006" && f.severity === "warn"));
      assert.ok(res.findings.some((f) => f.id === "HD008" && f.title.includes("missing-lint")));
      assert.ok(res.findings.some((f) => f.id === "HD008" && f.title.includes("missing-push")));

      // With --ci, the CI-detected HD006 becomes info
      const ciRes = await diagnose(t.repoDir, { env, homeDir: t.homeDir, ci: true });
      assert.ok(
        ciRes.findings.some((f) => f.id === "HD006" && f.severity === "info" && f.title.includes("CI"))
      );
    } finally {
      t.cleanup();
    }
  });

  it("supports subdirectory invocation, linked worktrees, and bare repos", async () => {
    const t = createTempRepo();
    try {
      t.writeFile("sub/dir/file.txt", "hello");
      t.git(["add", "."]);
      t.git(["commit", "-m", "init"]);

      const subRes = await diagnose(path.join(t.repoDir, "sub", "dir"), {
        env: t.env,
        homeDir: t.homeDir,
      });
      assert.equal(path.resolve(subRes.repo.repoRoot ?? ""), path.resolve(t.repoDir));

      const wtDir = path.join(t.root, "wt1");
      t.git(["worktree", "add", wtDir, "-b", "wt-branch"]);
      const wtRes = await diagnose(wtDir, { env: t.env, homeDir: t.homeDir });
      assert.equal(wtRes.repo.isWorktree, true);
    } finally {
      t.cleanup();
    }

    const bare = createTempRepo({ bare: true });
    try {
      const bareRes = await diagnose(bare.repoDir, { env: bare.env, homeDir: bare.homeDir });
      assert.equal(bareRes.repo.isBare, true);
      assert.equal(bareRes.repo.repoRoot, null);
    } finally {
      bare.cleanup();
    }
  });

  it("handles CLI formats (human, json, github, sarif) and exit codes 0, 1, 2", async () => {
    const t = createTempRepo();
    try {
      t.writeFile(".git/hooks/pre-commit", "#!/bin/sh\necho ok\n", { mode: 0o755 });

      for (const fmt of ["human", "json", "github", "sarif"]) {
        let out = "";
        const code = await runCli([t.repoDir, "--format", fmt, "--no-color"], {
          env: t.env,
          platform: "win32",
          stdout: (s) => {
            out += s;
          },
        });
        assert.equal(code, 0);
        if (fmt === "json" || fmt === "sarif") {
          assert.doesNotThrow(() => JSON.parse(out));
        }
      }

      // Invalid format -> exit 2
      let errOut = "";
      const badFmt = await runCli([t.repoDir, "--format", "xml"], {
        env: t.env,
        stderr: (s) => {
          errOut += s;
        },
      });
      assert.equal(badFmt, 2);
      assert.match(errOut, /Invalid --format/);

      // Not a git repo -> exit 2
      const nonGit = fs.mkdtempSync(path.join(t.root, "non-git-"));
      const nonGitCode = await runCli([nonGit], { env: t.env, stderr: () => {} });
      assert.equal(nonGitCode, 2);

      // Mocked git missing / dubious ownership -> exit 2
      await assert.rejects(
        () =>
          diagnose(t.repoDir, {
            gitRunner: async () => {
              throw new HookDoctorError("GIT_MISSING", "Git executable was not found on PATH.");
            },
          }),
        (/** @type {unknown} */ err) =>
          err instanceof HookDoctorError && err.code === "GIT_MISSING"
      );

      await assert.rejects(
        () =>
          diagnose(t.repoDir, {
            gitRunner: async () => {
              throw new HookDoctorError(
                "UNSAFE_OWNERSHIP",
                "fatal: detected dubious ownership in repository"
              );
            },
          }),
        (/** @type {unknown} */ err) =>
          err instanceof HookDoctorError && err.code === "UNSAFE_OWNERSHIP"
      );

      // CLI --help, --version, why human/json, TTY color, --fail-on warn
      let helpOut = "";
      assert.equal(
        await runCli(["--help"], {
          stdout: (s) => {
            helpOut += s;
          },
        }),
        0
      );
      assert.match(helpOut, /hookdoctor/);

      let verOut = "";
      assert.equal(
        await runCli(["--version"], {
          stdout: (s) => {
            verOut += s;
          },
        }),
        0
      );
      assert.match(verOut, /\d+\.\d+\.\d+/);

      assert.equal(await runCli(["why"], { stderr: () => {} }), 2);

      let whyHuman = "";
      assert.equal(
        await runCli(["why", "pre-commit", t.repoDir], {
          env: t.env,
          isTTY: true,
          platform: "win32",
          stdout: (s) => {
            whyHuman += s;
          },
        }),
        0
      );
      assert.match(whyHuman, /WILL RUN/);

      let whyNotConfigured = "";
      assert.equal(
        await runCli(["why", "pre-push", t.repoDir, "--format", "json"], {
          env: t.env,
          platform: "win32",
          stdout: (s) => {
            whyNotConfigured += s;
          },
        }),
        0
      );
      assert.equal(JSON.parse(whyNotConfigured).verdict, "NOT CONFIGURED");
    } finally {
      t.cleanup();
    }
  });
});
