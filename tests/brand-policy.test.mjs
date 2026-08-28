import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveBrandPolicy } from "../scripts/resolve-brand-policy.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const policyScript = resolve(testDir, "../scripts/resolve-brand-policy.mjs");

function styleSpec(defaultEnabled, userOverrideAllowed = true) {
  return {
    id: "test-style",
    brandPolicy: { defaultEnabled, userOverrideAllowed },
    fixedComponents: {
      brandSlot: { enabled: true, anchor: "top-right" }
    }
  };
}

test("uses enabled style default without an override", () => {
  assert.deepEqual(resolveBrandPolicy(styleSpec(true)), {
    brand_enabled: true,
    brand_policy_default_enabled: true,
    brand_override: null,
    brand_policy_source: "style-default"
  });
});

test("uses disabled style default without an override", () => {
  assert.equal(resolveBrandPolicy(styleSpec(false)).brand_enabled, false);
});

test("explicit user override wins over the style default", () => {
  assert.equal(resolveBrandPolicy(styleSpec(false), "enabled").brand_enabled, true);
  assert.equal(resolveBrandPolicy(styleSpec(true), "disabled").brand_enabled, false);
});

test("legacy styles default to disabled", () => {
  const legacy = styleSpec(true);
  delete legacy.brandPolicy;
  assert.equal(resolveBrandPolicy(legacy).brand_policy_source, "legacy-default");
  assert.equal(resolveBrandPolicy(legacy).brand_enabled, false);
});

test("rejects overrides when a style forbids them", () => {
  assert.throws(
    () => resolveBrandPolicy(styleSpec(true, false), "disabled"),
    /does not allow brand overrides/
  );
});

test("policy CLI runs through a symlinked entrypoint", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "brand-policy-symlink-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const linkedScript = join(directory, "resolve-brand-policy.mjs");
  const specPath = join(directory, "style.spec.json");
  symlinkSync(policyScript, linkedScript);
  writeFileSync(specPath, JSON.stringify(styleSpec(false)));

  const result = spawnSync(process.execPath, [linkedScript, "--style-spec", specPath], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).brand_enabled, false);
});
