import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../../src/cli.js";
import { diagnose, why } from "../../src/index.js";
import { createTempRepo } from "../helpers/temp-repo.js";

describe("security boundaries", () => {
  it("never executes malicious hooks, package.json scripts, or git config commands", async () => {
    const t = createTempRepo();
    try {
      const marker1 = path.join(t.root, "pwned-hook.txt").replaceAll("\\", "/");
      const marker2 = path.join(t.root, "pwned-pkg.txt").replaceAll("\\", "/");
      const marker3 = path.join(t.root, "pwned-cfg.txt").replaceAll("\\", "/");

      t.writeFile(
        ".git/hooks/pre-commit",
        `#!/bin/sh\nnode -e "require('fs').writeFileSync('${marker1}', 'pwned')"\n`,
        { mode: 0o755 }
      );
      t.writeFile(
        "package.json",
        JSON.stringify({
          name: "malicious",
          scripts: {
            prepare: `node -e "require('fs').writeFileSync('${marker2}', 'pwned')"`,
          },
          devDependencies: { husky: "^9.0.0" },
        })
      );
      t.git(["config", "core.fsmonitor", `node -e "require('fs').writeFileSync('${marker3}', 'pwned')"`]);

      await diagnose(t.repoDir, { env: t.env, homeDir: t.homeDir });
      await why("pre-commit", t.repoDir, { env: t.env, homeDir: t.homeDir });

      assert.equal(fs.existsSync(marker1), false, "hook must never execute");
      assert.equal(fs.existsSync(marker2), false, "package.json script must never execute");
      assert.equal(fs.existsSync(marker3), false, "git config command must never execute");
    } finally {
      t.cleanup();
    }
  });

  it("sanitizes ANSI escapes, control chars, and hostile filenames", async () => {
    const t = createTempRepo();
    try {
      // Valid filename with spaces, quotes, semicolon, leading dash
      t.writeFile(".git/hooks/pre-commit", "#!/bin/sh\necho \x1b[31mred\x1b[0m\n", { mode: 0o755 });
      t.writeFile(".git/hooks/--weird 'name'; $(id)", "#!/bin/sh\necho hi\n", { mode: 0o755 });
      t.git(["config", "core.hooksPath", ".git/hooks"]);

      let out = "";
      await runCli([t.repoDir, "--format", "github", "--no-color"], {
        env: { ...t.env, CI: "SUPER_SECRET_CI_TOKEN_12345" },
        platform: "win32",
        stdout: (s) => {
          out += s;
        },
      });

      assert.equal(out.includes("SUPER_SECRET_CI_TOKEN_12345"), false, "env values must never print");
      assert.equal(out.includes("\x1b["), false, "ANSI escapes must be stripped");
    } finally {
      t.cleanup();
    }
  });

  it("caps huge hook files without OOM and blocks symlinks escaping the repo", async () => {
    const t = createTempRepo();
    try {
      // 2 MB hook file
      const huge = "#!/bin/sh\n" + "#".repeat(2 * 1024 * 1024) + "\n";
      t.writeFile(".git/hooks/pre-commit", huge, { mode: 0o755 });

      const outsideFile = path.join(t.root, "outside-secret.txt");
      fs.writeFileSync(outsideFile, "#!/bin/sh\nSECRET_DATA\n", "utf8");

      const symlinkPath = path.join(t.repoDir, ".git", "hooks", "commit-msg");
      let symlinkCreated = false;
      try {
        fs.symlinkSync(outsideFile, symlinkPath);
        symlinkCreated = true;
      } catch {
        // Symlink creation on Windows without Developer Mode may throw EPERM; skip symlink assertion if so
      }

      const res = await diagnose(t.repoDir, {
        env: t.env,
        homeDir: t.homeDir,
        platform: "win32",
      });
      assert.ok(res.findings.length >= 1);

      if (symlinkCreated) {
        const warn = res.findings.find(
          (f) => f.id === "HD005" && f.title.includes("commit-msg")
        );
        assert.ok(warn, "symlink escaping repo must be blocked and reported safely");
      }
    } finally {
      t.cleanup();
    }
  });
});
