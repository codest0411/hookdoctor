import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createTempRepo } from "../helpers/temp-repo.js";

const PKG_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Run npm cross-platform without `shell: true` deprecation warnings.
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} cacheDir
 * @returns {string}
 */
function runNpm(args, cwd, cacheDir) {
  const env = {
    ...process.env,
    npm_config_cache: cacheDir,
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && npmExecPath.endsWith(".js") && fs.existsSync(npmExecPath)) {
    return execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd,
      env,
      encoding: "utf8",
      windowsHide: true,
    });
  }
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
    return execFileSync(comspec, ["/d", "/s", "/c", "npm", ...args], {
      cwd,
      env,
      encoding: "utf8",
      windowsHide: true,
    });
  }
  return execFileSync("npm", args, {
    cwd,
    env,
    encoding: "utf8",
  });
}

describe("e2e CLI & packed tarball smoke test", () => {
  it("packs, installs into a clean folder, and diagnoses healthy & broken repos", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hd-e2e-"));
    const cacheDir = path.join(tmp, "npm-cache");
    const healthy = createTempRepo();
    const broken = createTempRepo();
    try {
      // Build types first so dist/ is included
      runNpm(["run", "build:types"], PKG_ROOT, cacheDir);

      const packOut = runNpm(["pack", "--pack-destination", tmp], PKG_ROOT, cacheDir).trim();
      const tgzName = packOut.split(/\r?\n/).pop()?.trim() ?? "";
      assert.ok(tgzName.endsWith(".tgz"), `expected .tgz, got ${tgzName}`);
      const tgzPath = path.join(tmp, tgzName);

      const installDir = path.join(tmp, "consumer");
      fs.mkdirSync(installDir);
      fs.writeFileSync(path.join(installDir, "package.json"), '{"name":"consumer","version":"1.0.0"}');
      runNpm(["install", tgzPath, "--no-audit", "--no-fund"], installDir, cacheDir);

      const binPath = path.join(installDir, "node_modules", "hookdoctor", "bin", "hookdoctor.js");
      assert.ok(fs.existsSync(binPath), "installed bin/hookdoctor.js must exist");

      // Healthy repo -> exit 0
      healthy.writeFile(".git/hooks/pre-commit", "#!/bin/sh\necho ok\n", { mode: 0o755 });
      const healthyOut = execFileSync(process.execPath, [binPath, healthy.repoDir, "--format", "json"], {
        env: healthy.env,
        encoding: "utf8",
      });
      const parsedHealthy = JSON.parse(healthyOut);
      assert.equal(parsedHealthy.findings.some((/** @type {{ severity: string }} */ f) => f.severity === "error"), false);

      // Broken repo (HD001) -> exit 1
      broken.writeFile(
        "package.json",
        JSON.stringify({ name: "broken", devDependencies: { husky: "^9.0.0" } })
      );
      let brokenExit = 0;
      try {
        execFileSync(process.execPath, [binPath, broken.repoDir, "--no-color"], {
          env: broken.env,
          encoding: "utf8",
        });
      } catch (err) {
        brokenExit = /** @type {{ status?: number }} */ (err).status ?? -1;
      }
      assert.equal(brokenExit, 1);
    } finally {
      healthy.cleanup();
      broken.cleanup();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
