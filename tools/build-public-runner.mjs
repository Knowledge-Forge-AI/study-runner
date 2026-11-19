import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readTypeScriptAssets } from "./typescript-asset.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = join(root, "runtime");
const sourceRoot = join(runtimeRoot, "source");
const buildRoot = join(root, ".build");
const outputRoot = join(root, "dist");
const receiptRoot = join(root, "build-receipts");
const inputBindingPath = join(root, "runtime-inputs.json");
const workflowPath = join(root, ".github", "workflows", "pages.yml");
const distManifestPath = join(root, "dist-manifest.json");

const EXPECTED_NODE = "22.23.4";
const EXPECTED_TYPESCRIPT = "7.0.2";
const CORE_MARKER = "// HOST5_CORE_BEGIN";
const CORE_END_MARKER = "// HOST5_CORE_END";
const SRI_PLACEHOLDER = "__HOST5_SCRIPT_SRI__";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sri(bytes) {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

async function facts(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.byteLength, sha256: digest(bytes) };
}

async function assertHash(path, expected, label) {
  const actual = await facts(path);
  if (actual.sha256 !== expected) throw new Error(`${label}_HASH_MISMATCH:${actual.sha256}`);
  return actual;
}

async function copyTree(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
    else throw new Error(`UNEXPECTED_NOTICE_ENTRY:${entry.name}`);
  }
}

async function sortedFiles(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) output.push(...await sortedFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) output.push(relative);
    else throw new Error(`UNEXPECTED_OUTPUT_ENTRY:${relative}`);
  }
  return output.sort();
}

if (process.versions.node !== EXPECTED_NODE) throw new Error(`NODE_VERSION_MISMATCH:${process.versions.node}`);

const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (packageMetadata.devDependencies?.typescript !== EXPECTED_TYPESCRIPT) throw new Error("TYPESCRIPT_PIN_MISMATCH");
const inputBinding = JSON.parse(await readFile(inputBindingPath, "utf8"));
const inputBindingFacts = await facts(inputBindingPath);
const EXPECTED_FRAME_TEMPLATE_SHA256 = inputBinding.emitter?.frameTemplate?.sha256;
const EXPECTED_CORE_SHA256 = inputBinding.emitter?.coreFixture?.sha256;
const EXPECTED_SOURCE_SHA256 = Object.freeze(inputBinding.source ?? {});
const EXPECTED_ADMISSION_SHA256 = inputBinding.admission?.sourceSha256;
const EXPECTED_PYODIDE_SHA256 = Object.freeze(Object.fromEntries(
  Object.entries(inputBinding.coreAssets ?? {}).map(([path, receipt]) => [basename(path), receipt.sha256]),
));
const EXPECTED_NOTICE_SHA256 = inputBinding.noticeReview?.noticeSha256;
const EXPECTED_SOURCE_AVAILABILITY_SHA256 = inputBinding.noticeReview?.sourceAvailabilitySha256;
const NOTICE_REVIEW = Object.freeze(inputBinding.noticeReview ?? {});
const SOURCE_REVIEW = Object.freeze(inputBinding.sourceReview ?? {});
if (!EXPECTED_FRAME_TEMPLATE_SHA256 || !EXPECTED_CORE_SHA256 || !EXPECTED_ADMISSION_SHA256
  || Object.keys(EXPECTED_SOURCE_SHA256).length !== 5
  || Object.keys(EXPECTED_PYODIDE_SHA256).length !== 5
  || !EXPECTED_NOTICE_SHA256 || !EXPECTED_SOURCE_AVAILABILITY_SHA256
  || typeof SOURCE_REVIEW.verdict !== "string"
  || typeof inputBinding.workflowSha256 !== "string") {
  throw new Error("INPUT_BINDING_INCOMPLETE_OR_NOT_REVIEWED");
}
const workflowFacts = await assertHash(workflowPath, inputBinding.workflowSha256, "WORKFLOW");
const installedTypescript = JSON.parse(await readFile(join(root, "node_modules", "typescript", "package.json"), "utf8"));
if (installedTypescript.version !== EXPECTED_TYPESCRIPT) throw new Error(`TYPESCRIPT_VERSION_MISMATCH:${installedTypescript.version}`);
const optionalCompiler = await readTypeScriptAssets(root);

await rm(buildRoot, { recursive: true, force: true });
await rm(outputRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });

const compiler = join(root, "node_modules", "typescript", "bin", "tsc");
const compile = spawnSync(process.execPath, [compiler, "--project", join(root, "tsconfig.json"), "--pretty", "false"], {
  cwd: root,
  stdio: "inherit",
});
if (compile.status !== 0) throw new Error("TYPESCRIPT_COMPILE_FAILED");

const contract = await import(pathToFileURL(join(buildRoot, "public-runner-contract.js")).href);
const expectedAssetPaths = [
  "/pyodide/pyodide.mjs",
  "/pyodide/pyodide.asm.mjs",
  "/pyodide/pyodide.asm.wasm",
  "/pyodide/python_stdlib.zip",
  "/pyodide/pyodide-lock.json",
];
if (JSON.stringify(contract.PUBLIC_RUNNER_CORE_ASSET_PATHS) !== JSON.stringify(expectedAssetPaths)) throw new Error("CORE_ASSET_PATH_CONTRACT_CHANGED");
if (contract.PUBLIC_RUNNER_NO_CDN !== true || contract.PUBLIC_RUNNER_FETCH_CREDENTIALS !== "omit") throw new Error("STATIC_POLICY_CONTRACT_CHANGED");

const sourceReceipts = {};
for (const [name, expected] of Object.entries(EXPECTED_SOURCE_SHA256)) {
  sourceReceipts[name] = { path: `runtime/source/${name}`, ...(await assertHash(join(sourceRoot, name), expected, `SOURCE_${name}`)) };
}
const admissionPath = join(sourceRoot, "study-runtime-admission.js");
const admissionFacts = await assertHash(admissionPath, EXPECTED_ADMISSION_SHA256, "ADMISSION_SOURCE");
const admissionSource = await readFile(admissionPath, "utf8");
if (/["']?\b(?:fetch|import|eval)\s*\(/u.test(admissionSource)
  || /\b(?:Worker|Blob|setTimeout|setInterval)\b/u.test(admissionSource)) {
  throw new Error("ADMISSION_PRELUDE_ASYNC_OR_RUNTIME_API");
}

const framePath = join(runtimeRoot, "frame.html");
const frameTemplateFacts = await assertHash(framePath, EXPECTED_FRAME_TEMPLATE_SHA256, "FRAME_TEMPLATE");
const frameTemplate = await readFile(framePath, "utf8");
const frameCspMeta = `<meta http-equiv="Content-Security-Policy" content="${contract.PUBLIC_RUNNER_FRAME_META_CSP}">`;
if (!frameTemplate.includes(frameCspMeta)
  || !frameTemplate.includes('<script src="/assets/study-runtime-frame.js" integrity="sha256-__HOST5_SCRIPT_SRI__" crossorigin="anonymous"></script>')) {
  throw new Error("FRAME_POLICY_OR_SRI_TEMPLATE_MISMATCH");
}

const fixtureFrameRuntimePath = join(runtimeRoot, "frame-runtime.js");
const coreFixtureFacts = await assertHash(fixtureFrameRuntimePath, EXPECTED_CORE_SHA256, "CORE_FIXTURE");
const coreBytes = await readFile(fixtureFrameRuntimePath);
const coreModule = await import(pathToFileURL(join(buildRoot, "study-runtime-frame.js")).href);
const emittedCoreBytes = Buffer.from(coreModule.STUDY_RUNTIME_FRAME_SOURCE ?? "", "utf8");
if (!emittedCoreBytes.equals(coreBytes)) throw new Error("CORE_FIXTURE_NOT_BYTE_EXACT");

const finalBundlePrefix = Buffer.from([
  "(function () {\n",
  admissionSource.trimEnd(),
  "\n  const host5ParentOrigin = new URL(globalThis.location.href).searchParams.get(\"parentOrigin\");\n",
  "  if (host5AdmitParent(host5ParentOrigin, globalThis.location.origin) === undefined) return;\n",
  `  ${CORE_MARKER}\n`,
].join(""), "utf8");
const finalBundleSuffix = Buffer.from(`\n  ${CORE_END_MARKER}\n})();\n`, "utf8");
const finalBundleBytes = Buffer.concat([finalBundlePrefix, coreBytes, finalBundleSuffix]);
const coreStart = finalBundleBytes.indexOf(coreBytes);
if (coreStart < 0 || finalBundleBytes.indexOf(coreBytes, coreStart + 1) >= 0) throw new Error("CORE_SUBSTRING_BINDING_MISMATCH");
const finalBundleFacts = { bytes: finalBundleBytes.byteLength, sha256: digest(finalBundleBytes), sri: sri(finalBundleBytes) };

const frameOutputText = frameTemplate.replace(`sha256-${SRI_PLACEHOLDER}`, finalBundleFacts.sri);
if (frameOutputText.includes(SRI_PLACEHOLDER)) throw new Error("SRI_PLACEHOLDER_REMAINED");

const pyodideReceipts = {};
for (const [name, expected] of Object.entries(EXPECTED_PYODIDE_SHA256)) {
  pyodideReceipts[`/pyodide/${name}`] = { path: `runtime/pyodide/${name}`, ...(await assertHash(join(runtimeRoot, "pyodide", name), expected, `PYODIDE_${name}`)) };
}
const noticeFacts = await assertHash(join(runtimeRoot, "THIRD_PARTY_NOTICES.txt"), EXPECTED_NOTICE_SHA256, "NOTICE");
const sourceAvailabilityFacts = await assertHash(join(runtimeRoot, "SOURCE-AVAILABILITY.json"), EXPECTED_SOURCE_AVAILABILITY_SHA256, "SOURCE_AVAILABILITY");
const publicLicenseFacts = await facts(join(root, "LICENSE"));
const publicNoticeFacts = await facts(join(root, "NOTICE"));

const licenseSource = join(runtimeRoot, "licenses", "LICENSES");
await mkdir(join(outputRoot, "assets"), { recursive: true });
await mkdir(join(outputRoot, "pyodide"), { recursive: true });
await mkdir(join(outputRoot, "LICENSES"), { recursive: true });
await copyFile(join(runtimeRoot, "index.html"), join(outputRoot, "index.html"));
await writeFile(join(outputRoot, "frame.html"), frameOutputText);
await writeFile(join(outputRoot, "assets", "study-runtime-frame.js"), finalBundleBytes);
for (const name of Object.keys(EXPECTED_PYODIDE_SHA256)) await copyFile(join(runtimeRoot, "pyodide", name), join(outputRoot, "pyodide", name));
await copyFile(join(runtimeRoot, "THIRD_PARTY_NOTICES.txt"), join(outputRoot, "THIRD_PARTY_NOTICES.txt"));
await copyFile(join(runtimeRoot, "SOURCE-AVAILABILITY.json"), join(outputRoot, "SOURCE-AVAILABILITY.json"));
await copyFile(join(root, "LICENSE"), join(outputRoot, "LICENSE"));
await copyFile(join(root, "NOTICE"), join(outputRoot, "NOTICE"));
await copyTree(licenseSource, join(outputRoot, "LICENSES"));
for (const { asset, body } of optionalCompiler) {
  await writeFile(join(outputRoot, asset.route.slice(1)), body, { mode: 0o644 });
}

const licenseNames = (await readdir(licenseSource)).sort();
const outputFiles = await sortedFiles(outputRoot);
if (outputFiles.length !== 39 + optionalCompiler.length) throw new Error(`OUTPUT_COUNT:${outputFiles.length}`);
const outputFacts = {};
for (const relative of outputFiles) outputFacts[`/${relative}`] = await facts(join(outputRoot, relative));
if (outputFacts["/assets/study-runtime-frame.js"].sha256 !== finalBundleFacts.sha256) throw new Error("OUTPUT_BUNDLE_HASH_MISMATCH");
if (outputFacts["/frame.html"].bytes !== Buffer.byteLength(frameOutputText)) throw new Error("OUTPUT_FRAME_FACT_MISMATCH");

const manifest = {
  schema: "study-runner-public-host-prep.v7",
  status: inputBinding.status,
  proposedRepository: "Knowledge-Forge-AI/study-runner",
  repositoryState: "UNCREATED",
  origin: contract.PUBLIC_RUNNER_ORIGIN,
  releaseAllowed: false,
  browserQualification: false,
  publicBinaryClaim: false,
  noCdn: contract.PUBLIC_RUNNER_NO_CDN,
  fetchCredentials: contract.PUBLIC_RUNNER_FETCH_CREDENTIALS,
  inputs: { path: "runtime-inputs.json", ...inputBindingFacts },
  toolchain: { node: EXPECTED_NODE, typescript: EXPECTED_TYPESCRIPT, install: false, network: false, compiler: `typescript ${EXPECTED_TYPESCRIPT} (tsc)`, buildScript: "tools/build-public-runner.mjs" },
  sourceRevision: inputBinding.sourceRevision,
  sourceReview: SOURCE_REVIEW,
  source: sourceReceipts,
  admission: { path: "runtime/source/study-runtime-admission.js", ...admissionFacts, asyncFetch: false, dynamicImport: false, eval: false },
  emitter: {
    coreSource: { path: "runtime/frame-runtime.js", ...coreFixtureFacts },
    emittedCore: { source: ".build/study-runtime-frame.js", export: "STUDY_RUNTIME_FRAME_SOURCE", bytes: emittedCoreBytes.byteLength, sha256: digest(emittedCoreBytes) },
    finalBundle: { path: "/assets/study-runtime-frame.js", ...finalBundleFacts, coreSubstringExact: true },
    frameTemplate: { path: "runtime/frame.html", ...frameTemplateFacts },
    frameOutput: { path: "/frame.html", ...outputFacts["/frame.html"] },
  },
  routes: {
    "/": { source: "runtime/index.html", output: "/index.html", ...outputFacts["/index.html"] },
    "/index.html": { output: "/index.html", ...outputFacts["/index.html"] },
    "/frame.html": { output: "/frame.html", ...outputFacts["/frame.html"] },
    "/assets/study-runtime-frame.js": { output: "/assets/study-runtime-frame.js", ...outputFacts["/assets/study-runtime-frame.js"] },
    ...Object.fromEntries(Object.entries(pyodideReceipts).map(([path, receipt]) => [path, { output: path, bytes: receipt.bytes, sha256: receipt.sha256 }])),
    "/THIRD_PARTY_NOTICES.txt": { output: "/THIRD_PARTY_NOTICES.txt", ...noticeFacts },
    "/SOURCE-AVAILABILITY.json": { output: "/SOURCE-AVAILABILITY.json", ...sourceAvailabilityFacts },
    "/LICENSE": { output: "/LICENSE", ...publicLicenseFacts },
    "/NOTICE": { output: "/NOTICE", ...publicNoticeFacts },
    ...Object.fromEntries(optionalCompiler.map(({ asset }) => [asset.route, { output: asset.route, ...outputFacts[asset.route] }])),
    "/LICENSES/*": { outputDirectory: "/LICENSES", files: Object.fromEntries((await readdir(licenseSource)).sort().map((name) => [name, outputFacts[`/LICENSES/${name}`]])) },
  },
  notices: { review: NOTICE_REVIEW, notice: { path: "runtime/THIRD_PARTY_NOTICES.txt", ...noticeFacts }, sourceAvailability: { path: "runtime/SOURCE-AVAILABILITY.json", ...sourceAvailabilityFacts }, publicLicense: { path: "LICENSE", ...publicLicenseFacts }, publicNotice: { path: "NOTICE", ...publicNoticeFacts }, licenseBodies: Object.fromEntries((await readdir(licenseSource)).sort().map((name) => [name, outputFacts[`/LICENSES/${name}`]])) },
  policy: {
    rootMetaCsp: contract.PUBLIC_RUNNER_META_CSP,
    frameMetaCsp: { value: contract.PUBLIC_RUNNER_FRAME_META_CSP, verifiedInFrame: true },
    scriptIntegrity: { algorithm: "sha256", value: finalBundleFacts.sri, verifiedInFrame: true },
    synchronousAdmission: true,
    frameResponseCsp: "not asserted; host response policy remains a required acceptance gate",
    responseCsp: "not asserted; requires remote qualification",
    frameAncestors: "not claimed; no response-header qualification performed",
    httpsRunnerAdmission: inputBinding.policy?.httpsRunnerAdmission ?? "deliberately host-agnostic across HTTPS origins; core and parent binding remain the enforcement boundary",
    cookieIsolation: "not claimed; host/domain Set-Cookie and browser behavior remain unqualified",
    customDomainBeforeFirstDeploy: true,
    privateOriginQa: true,
  },
  resourceBudgets: {
    coreAssetBytes: Object.values(pyodideReceipts).reduce((sum, receipt) => sum + receipt.bytes, 0),
    sourceBytes: 64 * 1024,
    inputBytes: 64 * 1024,
    outputBytes: 64 * 1024,
    lockBytes: 512 * 1024,
    maxDepth: 32,
    maxNodes: 8192,
    policy: "bounded source and timeout contract unchanged; no runtime execution claim in this preparation",
  },
  output: { root: "bundle/dist", fileCount: outputFiles.length, files: outputFacts },
  workflow: { path: ".github/workflows/pages.yml", ...workflowFacts, mode: "workflow_dispatch only; qualified action SHAs; no deployment performed" },
};
const distManifest = {
  schema: "study-runner-dist-manifest.v1",
  source: "runtime-inputs.json",
  outputRoot: "dist",
  outputFileCount: outputFiles.length,
  routeCount: Object.keys(manifest.routes).length - 1 + licenseNames.length,
  routes: Object.keys(manifest.routes),
  files: outputFacts,
};
await writeFile(distManifestPath, JSON.stringify(distManifest, null, 2) + "\n", { mode: 0o644 });
manifest.distManifest = { path: "dist-manifest.json", ...(await facts(distManifestPath)) };
await rm(receiptRoot, { recursive: true, force: true });
await mkdir(receiptRoot, { recursive: true });
await writeFile(join(receiptRoot, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ prepared: true, outputRoot, coreSubstringExact: true, sri: finalBundleFacts.sri, releaseAllowed: false }));

