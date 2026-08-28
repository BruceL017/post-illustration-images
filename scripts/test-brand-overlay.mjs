#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDir, "..");
const overlayScript = resolve(scriptDir, "apply-brand-overlay.mjs");
const vendorDir = resolve(skillRoot, "vendor/resvg-wasm");
const background = [0x19, 0x71, 0x83, 0xff];
const assetColors = new Set(["f2c14e", "4d7cfe"]);
const neutralAssetSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 28"><path fill="#F2C14E" d="M5 4h40v20H5z"/><path fill="#4D7CFE" d="M55 4h40v20H55z"/></svg>\n`;
const styleSpecPaths = [
  "references/styles/wechat-style-doodle.spec.json",
  "references/styles/xhs-style-cream-paper.spec.json",
  "references/styles/xhs-style-explainer-notebook.spec.json",
  "references/styles/xhs-style-orange-card.spec.json",
  "references/styles/zhihu-style-title.spec.json",
  "references/styles/weibo-signal-core.spec.json",
  "references/styles/toutiao-luminous-tech.spec.json",
  "references/styles/xhs-vibrant-scrapbook.spec.json"
].map((path) => resolve(skillRoot, path));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function solidPng(width, height, rgba = background) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);

  const row = Buffer.alloc(1 + width * 4);
  for (let offset = 1; offset < row.length; offset += 4) {
    row.set(rgba, offset);
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) {
    row.copy(raw, y * row.length);
  }

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function decodePng(buffer, label) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${label} is not a PNG`);

  let offset = 8;
  let ihdr;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= buffer.length, `${label} has a truncated ${type} chunk`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }

  assert.equal(ihdr?.length, 13, `${label} has no valid IHDR chunk`);
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  assert.equal(bitDepth, 8, `${label} uses unsupported PNG bit depth ${bitDepth}`);
  assert.ok(colorType === 2 || colorType === 6, `${label} uses unsupported PNG color type ${colorType}`);
  assert.equal(interlace, 0, `${label} uses unsupported PNG interlacing`);

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(idat));
  assert.equal(filtered.length, (stride + 1) * height, `${label} has unexpected decompressed data length`);

  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * (stride + 1);
    const targetRow = y * stride;
    const filter = filtered[sourceRow];
    for (let x = 0; x < stride; x += 1) {
      const encoded = filtered[sourceRow + 1 + x];
      const left = x >= bytesPerPixel ? pixels[targetRow + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[targetRow - stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[targetRow - stride + x - bytesPerPixel]
        : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else assert.fail(`${label} uses unsupported PNG filter ${filter}`);
      pixels[targetRow + x] = (encoded + predictor) & 0xff;
    }
  }

  if (colorType === 6) return { width, height, rgba: pixels };

  const rgba = Buffer.alloc(width * height * 4);
  for (let source = 0, target = 0; source < pixels.length; source += 3, target += 4) {
    rgba[target] = pixels[source];
    rgba[target + 1] = pixels[source + 1];
    rgba[target + 2] = pixels[source + 2];
    rgba[target + 3] = 0xff;
  }
  return { width, height, rgba };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function testSpec(id, width = 128, height = 96) {
  return {
    id,
    canvas: { width, height, ratio: "4:3", orientation: "horizontal" },
    layout: {
      brandReservedArea: { x: width / 2, y: 8, width: width / 2 - 4, height: 32 }
    },
    fixedComponents: {
      brandSlot: {
        enabled: true,
        anchor: "top-right",
        x: width / 2 + 4,
        y: 12,
        width: width / 2 - 12,
        height: 20,
        assetFit: "contain"
      }
    },
    generationConstraints: { keepBrandReservedAreaClear: true },
    inputHandling: {
      preserveNativeOutput: true,
      ratioTolerance: 0.002,
      outputCanvasRole: "design-coordinate-system",
      allowPostGenerationResize: false
    }
  };
}

function scaleRect(rect, canvas, size) {
  const scaleX = size.width / canvas.width;
  const scaleY = size.height / canvas.height;
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  };
}

function createTempDir(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function pathlessEnvironment(directory) {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() !== "path") environment[key] = value;
  }
  const emptyPath = join(directory, "empty-path");
  mkdirSync(emptyPath, { recursive: true });
  environment.PATH = emptyPath;
  return environment;
}

function writeNeutralAsset(directory, name = "neutral-asset.svg") {
  const path = join(directory, name);
  writeFileSync(path, neutralAssetSvg);
  return path;
}

function runOverlay(args, directory, { autoAsset = true, script = overlayScript } = {}) {
  const hasAssetSource = args.includes("--brand-svg") || args.includes("--brand-config")
    || args.includes("--self-test");
  const resolvedArgs = hasAssetSource || !autoAsset
    ? args : [...args, "--brand-svg", writeNeutralAsset(directory)];
  const result = spawnSync(process.execPath, [script, ...resolvedArgs], {
    cwd: skillRoot,
    encoding: "utf8",
    env: pathlessEnvironment(directory),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000
  });
  assert.equal(result.error, undefined, `overlay process failed to start: ${result.error?.message}`);
  return result;
}

function expectSuccess(args, directory) {
  const result = runOverlay(args, directory);
  assert.equal(result.signal, null, `overlay process was terminated by ${result.signal}`);
  assert.equal(result.status, 0, `overlay failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function expectFailure(args, directory, messagePattern) {
  const result = runOverlay(args, directory);
  assert.notEqual(result.status, 0, `overlay unexpectedly succeeded\nstdout:\n${result.stdout}`);
  assert.match(`${result.stdout}\n${result.stderr}`, messagePattern);
  return result;
}

function assertVisibleAsset(image, slot, label) {
  let changedInside = 0;
  let changedOutside = 0;
  const renderedColors = new Set();

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const changed = image.rgba[offset] !== background[0] ||
        image.rgba[offset + 1] !== background[1] ||
        image.rgba[offset + 2] !== background[2] ||
        image.rgba[offset + 3] !== background[3];
      if (!changed) continue;

      const inside = x >= slot.x && x < slot.x + slot.width &&
        y >= slot.y && y < slot.y + slot.height;
      if (inside) changedInside += 1;
      else changedOutside += 1;

      const color = image.rgba.subarray(offset, offset + 3).toString("hex");
      if (image.rgba[offset + 3] === 0xff && assetColors.has(color)) {
        renderedColors.add(color);
      }
    }
  }

  assert.ok(changedInside >= 20, `${label} did not render a visible asset in its brand slot`);
  assert.equal(renderedColors.size, 2, `${label} did not preserve both configured asset colors`);
  assert.equal(changedOutside, 0, `${label} changed ${changedOutside} pixels outside its brand slot`);
}

function assertNoTemporaryOutput(directory, output) {
  const prefix = `.${basename(output)}.`;
  const leftovers = readdirSync(directory).filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], `temporary output files remain: ${leftovers.join(", ")}`);
}

test("verifies the complete vendored resvg WASM artifact set", () => {
  const expectedFiles = ["index.js", "index_bg.wasm", "LICENSE", "VERSION", "SOURCE.md"];
  assert.equal(readFileSync(join(vendorDir, "VERSION"), "utf8"), "2.6.2\n");
  assert.match(readFileSync(join(vendorDir, "SOURCE.md"), "utf8"), /@resvg\/resvg-wasm.*2\.6\.2/s);
  assert.match(readFileSync(join(vendorDir, "LICENSE"), "utf8"), /Mozilla Public License Version 2\.0/);

  const checksumLines = readFileSync(join(vendorDir, "SHA256SUMS"), "utf8").trimEnd().split("\n");
  assert.equal(checksumLines.length, expectedFiles.length);
  const entries = new Map();
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64}) {2}([^/\\]+)$/);
    assert.ok(match, `invalid SHA256SUMS entry: ${line}`);
    assert.equal(entries.has(match[2]), false, `duplicate SHA256SUMS entry: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  assert.deepEqual([...entries.keys()].sort(), [...expectedFiles].sort());

  for (const fileName of expectedFiles) {
    const digest = createHash("sha256").update(readFileSync(join(vendorDir, fileName))).digest("hex");
    assert.equal(entries.get(fileName), digest, `SHA256 mismatch for ${fileName}`);
  }
});

test("self-test loads the vendored renderer without external commands", (t) => {
  const directory = createTempDir(t, "brand-overlay-self-test-");
  const result = expectSuccess(["--self-test"], directory);
  assert.match(result.stdout, /brand overlay self-test passed/i);
});

test("self-test runs through a symlinked CLI entrypoint", (t) => {
  const directory = createTempDir(t, "brand-overlay-symlink-");
  const linkedScript = join(directory, "apply-brand-overlay.mjs");
  symlinkSync(overlayScript, linkedScript);
  const result = runOverlay(["--self-test"], directory, { script: linkedScript });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /brand overlay self-test passed/i);
});

test("default config has the exact disabled schema", () => {
  assert.deepEqual(readJson(join(skillRoot, "brand-overlay.config.json")), {
    schema_version: 1,
    asset: null
  });
});

test("validate-only fails fast for the default unconfigured asset", (t) => {
  const directory = createTempDir(t, "brand-overlay-preflight-default-");
  expectFailure([
    "--validate-only",
    "--brand-config", join(skillRoot, "brand-overlay.config.json")
  ], directory, /asset is not configured/i);
});

test("standalone mode requires a Style Spec and exactly one asset source", (t) => {
  const directory = createTempDir(t, "brand-overlay-arguments-");
  const specPath = join(directory, "style.spec.json");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const asset = writeNeutralAsset(directory);
  writeFileSync(specPath, JSON.stringify(testSpec("argument-test")));
  writeFileSync(input, solidPng(128, 96));

  const missingSpec = runOverlay([
    "--brand-svg", asset, "--input", input, "--output", output
  ], directory, { autoAsset: false });
  assert.notEqual(missingSpec.status, 0);
  assert.match(missingSpec.stderr, /--style-spec is required/i);

  const missingAsset = runOverlay([
    "--style-spec", specPath, "--input", input, "--output", output
  ], directory, { autoAsset: false });
  assert.notEqual(missingAsset.status, 0);
  assert.match(missingAsset.stderr, /exactly one of --brand-svg or --brand-config/i);

  const bothAssets = runOverlay([
    "--style-spec", specPath,
    "--brand-svg", asset,
    "--brand-config", join(skillRoot, "brand-overlay.config.json"),
    "--input", input,
    "--output", output
  ], directory, { autoAsset: false });
  assert.notEqual(bothAssets.status, 0);
  assert.match(bothAssets.stderr, /exactly one of --brand-svg or --brand-config/i);
});

test("configured asset enforces skill-root path, hash, symlink, and SVG safety", async (t) => {
  const directory = createTempDir(t, "brand-overlay-config-");
  const assetDirectory = mkdtempSync(join(skillRoot, ".brand-overlay-config-test-"));
  t.after(() => rmSync(assetDirectory, { recursive: true, force: true }));
  const asset = writeNeutralAsset(assetDirectory);
  const assetPath = relative(skillRoot, asset).replaceAll("\\", "/");
  const assetHash = createHash("sha256").update(readFileSync(asset)).digest("hex");
  const configPath = join(directory, "brand-overlay.config.json");
  const specPath = join(directory, "style.spec.json");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const source = solidPng(128, 96);
  writeFileSync(specPath, JSON.stringify(testSpec("configured-asset-test")));
  writeFileSync(input, source);

  const writeConfig = (assetConfig) => writeFileSync(configPath, `${JSON.stringify({
    schema_version: 1,
    asset: assetConfig
  }, null, 2)}\n`);

  writeConfig({ path: assetPath, sha256: assetHash });
  const preflight = expectSuccess([
    "--validate-only", "--brand-config", configPath
  ], directory);
  assert.match(preflight.stdout, /rendered visible pixels/i);
  expectSuccess([
    "--style-spec", specPath,
    "--brand-config", configPath,
    "--input", input,
    "--output", output
  ], directory);
  assert.deepEqual(readFileSync(input), source, "configured overlay modified its source");
  assertVisibleAsset(
    decodePng(readFileSync(output), "configured output"),
    testSpec("configured-asset-test").fixedComponents.brandSlot,
    "configured output"
  );

  writeConfig(null);
  expectFailure([
    "--style-spec", specPath, "--brand-config", configPath,
    "--input", input, "--output", output
  ], directory, /asset is not configured/i);

  writeConfig({ path: assetPath, sha256: "0".repeat(64) });
  expectFailure([
    "--style-spec", specPath, "--brand-config", configPath,
    "--input", input, "--output", output
  ], directory, /SHA-256 mismatch/i);

  writeConfig({ path: "../outside.svg", sha256: assetHash });
  expectFailure([
    "--style-spec", specPath, "--brand-config", configPath,
    "--input", input, "--output", output
  ], directory, /inside the skill root/i);

  const linkedAsset = join(assetDirectory, "linked.svg");
  symlinkSync(asset, linkedAsset);
  writeConfig({
    path: relative(skillRoot, linkedAsset).replaceAll("\\", "/"),
    sha256: assetHash
  });
  expectFailure([
    "--style-spec", specPath, "--brand-config", configPath,
    "--input", input, "--output", output
  ], directory, /real file inside the skill root/i);

  const invalidAsset = join(assetDirectory, "invalid.svg");
  writeFileSync(invalidAsset, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>\n`);
  writeConfig({
    path: relative(skillRoot, invalidAsset).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(readFileSync(invalidAsset)).digest("hex")
  });
  expectFailure([
    "--style-spec", specPath, "--brand-config", configPath,
    "--input", input, "--output", output
  ], directory, /only group and path elements/i);

  const invisibleAssets = [
    {
      name: "fill-none.svg",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="none" d="M1 1h8v8H1z"/></svg>\n`
    },
    {
      name: "opacity-zero.svg",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#4D7CFE" opacity="0" d="M1 1h8v8H1z"/></svg>\n`
    },
    {
      name: "outside-viewbox.svg",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#4D7CFE" d="M20 20h8v8h-8z"/></svg>\n`
    }
  ];
  for (const invisible of invisibleAssets) {
    const invisiblePath = join(assetDirectory, invisible.name);
    writeFileSync(invisiblePath, invisible.svg);
    writeConfig({
      path: relative(skillRoot, invisiblePath).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(invisiblePath)).digest("hex")
    });
    expectFailure([
      "--validate-only", "--brand-config", configPath
    ], directory, /no visible pixels after rendering/i);
  }

  const weakAssets = [
    {
      name: "near-transparent.svg",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#4D7CFE" opacity="0.01" d="M0 0h10v10H0z"/></svg>\n`
    },
    {
      name: "single-pixel.svg",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path fill="#4D7CFE" d="M0 0h1v1H0z"/></svg>\n`
    }
  ];
  for (const weak of weakAssets) {
    const weakPath = join(assetDirectory, weak.name);
    writeFileSync(weakPath, weak.svg);
    writeConfig({
      path: relative(skillRoot, weakPath).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(weakPath)).digest("hex")
    });
    expectFailure([
      "--validate-only", "--brand-config", configPath
    ], directory, /insufficient visible coverage after rendering/i);
  }

  for (const rootAttribute of ["fill=\"#4D7CFE\"", "opacity=\"0.5\""]) {
    const rootAttributePath = join(assetDirectory, `root-${rootAttribute.startsWith("fill") ? "fill" : "opacity"}.svg`);
    writeFileSync(
      rootAttributePath,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" ${rootAttribute}><path d="M1 1h8v8H1z"/></svg>\n`
    );
    writeConfig({
      path: relative(skillRoot, rootAttributePath).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(rootAttributePath)).digest("hex")
    });
    expectFailure([
      "--validate-only", "--brand-config", configPath
    ], directory, /unsupported SVG root attribute.*put visual properties on g or path/i);
  }
});

test("renders a visible generic asset on exact-size input for all real Style Specs", async (t) => {
  for (const specPath of styleSpecPaths) {
    const spec = readJson(specPath);
    await t.test(spec.id, (subtest) => {
      const directory = createTempDir(subtest, `brand-overlay-${spec.id}-`);
      const input = join(directory, "input.png");
      const output = join(directory, "output.png");
      const inputBytes = solidPng(spec.canvas.width, spec.canvas.height);
      writeFileSync(input, inputBytes);

      expectSuccess([
        "--style-spec", specPath,
        "--input", input,
        "--output", output
      ], directory);

      assert.deepEqual(readFileSync(input), inputBytes, `${spec.id} modified its unbranded input`);
      const rendered = decodePng(readFileSync(output), output);
      assert.equal(rendered.width, spec.canvas.width);
      assert.equal(rendered.height, spec.canvas.height);
      assertVisibleAsset(rendered, spec.fixedComponents.brandSlot, spec.id);
      assertNoTemporaryOutput(directory, output);
    });
  }
});

test("preserves representative model-native dimensions while applying the generic asset", async (t) => {
  const scenarios = [
    { specPath: styleSpecPaths[0], width: 1448, height: 1086 },
    { specPath: styleSpecPaths[1], width: 1086, height: 1448 },
    { specPath: styleSpecPaths[4], width: 2048, height: 1152 },
    { specPath: styleSpecPaths[4], width: 1672, height: 941 }
  ];

  for (const scenario of scenarios) {
    const spec = readJson(scenario.specPath);
    await t.test(`${spec.id}-${scenario.width}x${scenario.height}`, (subtest) => {
      const directory = createTempDir(subtest, `brand-overlay-native-${spec.id}-`);
      const input = join(directory, "input.png");
      const output = join(directory, "output.png");
      const inputBytes = solidPng(scenario.width, scenario.height);
      writeFileSync(input, inputBytes);

      expectSuccess([
        "--style-spec", scenario.specPath,
        "--input", input,
        "--output", output
      ], directory);

      assert.deepEqual(readFileSync(input), inputBytes, `${spec.id} modified its native source`);
      const rendered = decodePng(readFileSync(output), output);
      assert.equal(rendered.width, scenario.width);
      assert.equal(rendered.height, scenario.height);
      assertVisibleAsset(
        rendered,
        scaleRect(spec.fixedComponents.brandSlot, spec.canvas, scenario),
        spec.id
      );
    });
  }
});

test("rejects a source ratio outside tolerance without replacing output", (t) => {
  const directory = createTempDir(t, "brand-overlay-wrong-ratio-");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const existingOutput = Buffer.from("existing output");
  writeFileSync(input, solidPng(1080, 1400));
  writeFileSync(output, existingOutput);

  expectFailure([
    "--style-spec", styleSpecPaths[1],
    "--input", input,
    "--output", output
  ], directory, /ratio is outside tolerance/i);

  assert.deepEqual(readFileSync(output), existingOutput);
  assertNoTemporaryOutput(directory, output);
});

test("rejects native output below a configured short-edge floor", (t) => {
  const directory = createTempDir(t, "brand-overlay-short-edge-");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const specPath = join(directory, "short-edge.spec.json");
  const spec = testSpec("short-edge-test", 160, 90);
  spec.inputHandling.minShortEdge = 100;
  const inputBytes = solidPng(160, 90);
  writeFileSync(specPath, JSON.stringify(spec));
  writeFileSync(input, inputBytes);

  expectFailure([
    "--style-spec", specPath,
    "--input", input,
    "--output", output
  ], directory, /short edge 90px.*at least 100px/i);

  assert.deepEqual(readFileSync(input), inputBytes);
  assertNoTemporaryOutput(directory, output);
});

test("batch mode processes PNG files without an external find command", (t) => {
  const directory = createTempDir(t, "brand-overlay-batch-");
  const inputDir = join(directory, "input");
  const outputDir = join(directory, "output");
  const specPath = join(directory, "batch.spec.json");
  mkdirSync(inputDir);
  const spec = testSpec("batch-test");
  writeFileSync(specPath, JSON.stringify(spec));
  writeFileSync(join(inputDir, "01.png"), solidPng(spec.canvas.width, spec.canvas.height));
  writeFileSync(join(inputDir, "02.PNG"), solidPng(spec.canvas.width, spec.canvas.height));
  writeFileSync(join(inputDir, "ignore.txt"), "not an image");

  expectSuccess([
    "--style-spec", specPath,
    "--input-dir", inputDir,
    "--output-dir", outputDir
  ], directory);

  assert.deepEqual(readdirSync(outputDir).sort(), ["01.png", "02.PNG"]);
  assertVisibleAsset(decodePng(readFileSync(join(outputDir, "01.png")), "batch output"), spec.fixedComponents.brandSlot, "batch output");
});

test("successfully replaces an existing regular output", (t) => {
  const directory = createTempDir(t, "brand-overlay-replace-");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const specPath = join(directory, "replace.spec.json");
  const spec = testSpec("replace-test");
  const inputBytes = solidPng(spec.canvas.width, spec.canvas.height);
  writeFileSync(specPath, JSON.stringify(spec));
  writeFileSync(input, inputBytes);
  writeFileSync(output, "previous output");

  expectSuccess([
    "--style-spec", specPath,
    "--input", input,
    "--output", output
  ], directory);

  assert.deepEqual(readFileSync(input), inputBytes, "replacement modified its source");
  assertVisibleAsset(decodePng(readFileSync(output), "replacement output"), spec.fixedComponents.brandSlot, "replacement output");
  assertNoTemporaryOutput(directory, output);
});

test("rejects malformed PNG input without replacing existing files", (t) => {
  const directory = createTempDir(t, "brand-overlay-malformed-");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const malformedInput = Buffer.from("not a PNG");
  const existingOutput = Buffer.from("existing output");
  writeFileSync(input, malformedInput);
  writeFileSync(output, existingOutput);

  expectFailure([
    "--style-spec", styleSpecPaths[2],
    "--input", input,
    "--output", output
  ], directory, /PNG/i);

  assert.deepEqual(readFileSync(input), malformedInput, "failure modified malformed input");
  assert.deepEqual(readFileSync(output), existingOutput, "failure replaced an existing output");
  assertNoTemporaryOutput(directory, output);
});

test("rejects invalid brand geometry without replacing existing files", (t) => {
  const baseSpec = readJson(styleSpecPaths[2]);
  const invalidSpec = structuredClone(baseSpec);
  invalidSpec.fixedComponents.brandSlot.x = invalidSpec.canvas.width;

  const directory = createTempDir(t, "brand-overlay-geometry-");
  const specPath = join(directory, "invalid.spec.json");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const inputBytes = solidPng(baseSpec.canvas.width, baseSpec.canvas.height);
  const existingOutput = Buffer.from("existing output");
  writeFileSync(specPath, `${JSON.stringify(invalidSpec, null, 2)}\n`);
  writeFileSync(input, inputBytes);
  writeFileSync(output, existingOutput);

  expectFailure([
    "--style-spec", specPath,
    "--input", input,
    "--output", output
  ], directory, /brandSlot.*(?:canvas|brandReservedArea|geometry)/i);

  assert.deepEqual(readFileSync(input), inputBytes, "geometry failure modified its input");
  assert.deepEqual(readFileSync(output), existingOutput, "geometry failure replaced an existing output");
  assertNoTemporaryOutput(directory, output);
});

test("rejects a hard-linked output that aliases the source PNG", (t) => {
  const directory = createTempDir(t, "brand-overlay-alias-");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const inputBytes = solidPng(1086, 1448);
  writeFileSync(input, inputBytes);
  linkSync(input, output);

  expectFailure([
    "--style-spec", styleSpecPaths[2],
    "--input", input,
    "--output", output
  ], directory, /different paths|source PNG is preserved/i);

  assert.deepEqual(readFileSync(input), inputBytes, "alias rejection modified its input");
  assert.deepEqual(readFileSync(output), inputBytes, "alias rejection modified its hard link");
});

test("rejects an existing directory as the output path", (t) => {
  const directory = createTempDir(t, "brand-overlay-directory-output-");
  const input = join(directory, "input.png");
  const output = join(directory, "output.png");
  const inputBytes = solidPng(1086, 1448);
  writeFileSync(input, inputBytes);
  mkdirSync(output);

  expectFailure([
    "--style-spec", styleSpecPaths[2],
    "--input", input,
    "--output", output
  ], directory, /output path must be a regular file/i);

  assert.deepEqual(readFileSync(input), inputBytes, "directory rejection modified its input");
  assert.deepEqual(readdirSync(output), [], "directory rejection modified the output directory");
});
