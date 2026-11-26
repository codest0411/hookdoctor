import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGitConfigNullOutput } from "../../src/config-origin.js";
import { extractScriptReferences } from "../../src/npm-scripts.js";
import { parseNpmrcIgnoreScripts } from "../../src/npmrc.js";
import { stripControlChars } from "../../src/sanitize.js";
import { analyzeShebang } from "../../src/shebang.js";

/**
 * Deterministic PRNG for reproducible fuzzing.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fuzz & linear-time parser resilience", () => {
  it("handles 500 random/adversarial inputs within 500ms without throwing", () => {
    const rand = mulberry32(42);
    const alphabet = "#!/usr/bin/env node npm run pnpm yarn \r\n\t\x1b[31m\x00;\"'()$&| ";
    const start = Date.now();

    for (let i = 0; i < 500; i += 1) {
      const len = Math.floor(rand() * 512);
      let s = "";
      for (let j = 0; j < len; j += 1) {
        s += alphabet[Math.floor(rand() * alphabet.length)];
      }
      assert.doesNotThrow(() => stripControlChars(s));
      assert.doesNotThrow(() => analyzeShebang(s, { envPath: "" }));
      assert.doesNotThrow(() => extractScriptReferences(s));
      assert.doesNotThrow(() => parseNpmrcIgnoreScripts(s));
      assert.doesNotThrow(() => parseGitConfigNullOutput(s, i % 2 === 0));
    }

    // Adversarial long-line ReDoS check (50k chars)
    const adversarial = "#!/usr/bin/env " + " ".repeat(50000) + "\n" + "npm run ".repeat(5000);
    analyzeShebang(adversarial, { envPath: "" });
    extractScriptReferences(adversarial);

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `fuzzing took too long: ${elapsed}ms`);
  });
});
