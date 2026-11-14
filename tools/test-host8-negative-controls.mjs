import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const bundleRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const staticVerifier = join(bundleRoot, "tools/verify-static-policy.mjs");
const hashVerifier = join(bundleRoot, "tools/verify-dist-hashes.mjs");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runTool(bundle, tool) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(bundle, "tools", tool)], { cwd: bundle, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolveRun({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

async function copyBundle() {
  const parent = await mkdtemp(join(tmpdir(), "study-runner-host8-controls-"));
  const bundle = join(parent, "bundle");
  await cp(bundleRoot, bundle, { recursive: true, force: true });
  return { parent, bundle };
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

async function mutateSourceAvailability(bundle, mutate) {
  const sourcePath = join(bundle, "runtime", "SOURCE-AVAILABILITY.json");
  const bindingPath = join(bundle, "runtime-inputs.json");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  mutate(source);
  const sourceBytes = Buffer.from(JSON.stringify(source, null, 2) + "\n");
  await writeFile(sourcePath, sourceBytes);
  await writeFile(join(bundle, "dist", "SOURCE-AVAILABILITY.json"), sourceBytes);
  const binding = JSON.parse(await readFile(bindingPath, "utf8"));
  binding.noticeReview.sourceAvailabilitySha256 = digest(sourceBytes);
  await writeJson(bindingPath, binding);
}

async function expectFailure(id, tool, prepare, expectedError) {
  const { parent, bundle } = await copyBundle();
  try {
    await prepare(bundle);
    const result = await runTool(bundle, tool);
    const combined = `${result.stdout}${result.stderr}`;
    if (result.code === 0 || !combined.includes(expectedError)) {
      throw new Error(`NEGATIVE_CONTROL_FAILED:${id}:${JSON.stringify({ code: result.code, expectedError, output: combined.slice(-500) })}`);
    }
    return { id, status: "EXPECTED_FAILURE", tool, error: expectedError };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function expectPass(id, tool) {
  const { parent, bundle } = await copyBundle();
  try {
    const result = await runTool(bundle, tool);
    if (result.code !== 0 || !`${result.stdout}${result.stderr}`.includes(tool === "verify-static-policy.mjs" ? "staticPolicy" : "DIST_HASH_PASS")) {
      throw new Error(`VALID_CONTROL_FAILED:${id}:${JSON.stringify({ code: result.code, output: `${result.stdout}${result.stderr}`.slice(-500) })}`);
    }
    return { id, status: "PASS", tool };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

const results = [];
results.push(await expectFailure("wrongcase-path-reference", "verify-static-policy.mjs", async (bundle) => {
  await mutateSourceAvailability(bundle, (source) => { source.emscriptenPorts.bzip2.licensePath = source.emscriptenPorts.bzip2.licensePath.replace("LICENSES/", "licenses/"); });
}, "LICENSE_REFERENCE_CASE_OR_SCOPE"));
results.push(await expectFailure("missing-license-digest", "verify-static-policy.mjs", async (bundle) => {
  await mutateSourceAvailability(bundle, (source) => { delete source.licenseTextsIncluded[0].bytes; delete source.licenseTextsIncluded[0].sha256; });
}, "LICENSE_REFERENCE_RECEIPT_MISSING"));
results.push(await expectFailure("conflicting-duplicate-receipt", "verify-static-policy.mjs", async (bundle) => {
  await mutateSourceAvailability(bundle, (source) => { source.toolchain.licenseReceipts[0].sha256 = "0".repeat(64); });
}, "LICENSE_REFERENCE_RECEIPT_CONFLICT"));
results.push(await expectFailure("served-notice-drift", "verify-static-policy.mjs", async (bundle) => {
  const path = join(bundle, "dist", "THIRD_PARTY_NOTICES.txt");
  await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("\nHOST8_NOTICE_DRIFT\n")]));
}, "THIRD_PARTY_NOTICE_ROUTE_HASH_MISMATCH"));
results.push(await expectFailure("served-license-drift", "verify-static-policy.mjs", async (bundle) => {
  const path = join(bundle, "dist", "LICENSE");
  await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("\nHOST8_LICENSE_DRIFT\n")]));
}, "LICENSE_ROOT_COPY_MISMATCH"));
results.push(await expectFailure("served-index-drift", "verify-static-policy.mjs", async (bundle) => {
  const path = join(bundle, "dist", "index.html");
  await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("\nHOST8_INDEX_DRIFT\n")]));
}, "INDEX_ROOT_COPY_MISMATCH"));
results.push(await expectFailure("manifest-file-count-tamper", "verify-dist-hashes.mjs", async (bundle) => {
  const path = join(bundle, "dist-manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.outputFileCount -= 1;
  await writeJson(path, manifest);
}, "DIST_FILE_COUNT_MANIFEST"));
results.push(await expectFailure("manifest-route-count-tamper", "verify-dist-hashes.mjs", async (bundle) => {
  const path = join(bundle, "dist-manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.routeCount -= 1;
  await writeJson(path, manifest);
}, "DIST_ROUTE_COUNT_MANIFEST"));
results.push(await expectFailure("extra-dist-file", "verify-dist-hashes.mjs", async (bundle) => {
  await writeFile(join(bundle, "dist", "host8-extra.txt"), "extra\n");
}, "DIST_FILE_LIST_MISMATCH"));
results.push(await expectFailure("missing-dist-file", "verify-dist-hashes.mjs", async (bundle) => {
  await rm(join(bundle, "dist", "NOTICE"));
}, "DIST_FILE_LIST_MISMATCH"));
results.push(await expectPass("restored-static-policy", "verify-static-policy.mjs"));
results.push(await expectPass("restored-dist-hashes", "verify-dist-hashes.mjs"));

console.log(JSON.stringify({
  schema: "study-runner-host8-negative-controls.v1",
  status: "PASS",
  node: process.versions.node,
  controls: results,
  candidateUnchanged: true,
  networkRequests: 0,
  installation: false,
}));
