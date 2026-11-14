import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = join(root, "dist");
const receiptRoot = join(root, "build-receipts");
const inputBindingPath = join(root, "runtime-inputs.json");
const binding = JSON.parse(await readFile(inputBindingPath, "utf8"));

const coreNames = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];
const mimeByExtension = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".rst": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
});
const mimeByPath = Object.freeze({
  LICENSE: "text/plain; charset=utf-8",
  NOTICE: "text/plain; charset=utf-8",
});

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function facts(relative) {
  const bytes = await readFile(join(outputRoot, relative));
  const extension = extname(relative).toLowerCase();
  return { bytes: bytes.byteLength, sha256: digest(bytes), mime: mimeByPath[relative] ?? mimeByExtension[extension] ?? "application/octet-stream" };
}

async function allEntries(directory, prefix = "") {
  const entries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) entries.push(...await allEntries(absolute, relative));
    else if (entry.isFile()) entries.push(relative);
    else if (entry.isSymbolicLink()) throw new Error(`SYMLINK:${relative}`);
    else throw new Error(`SPECIAL_FILE:${relative}`);
  }
  return entries.sort();
}

function fail(message) {
  throw new Error(message);
}

const expected = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/frame.html", "frame.html"],
  ["/assets/study-runtime-frame.js", "assets/study-runtime-frame.js"],
  ...coreNames.map((name) => [`/pyodide/${name}`, `pyodide/${name}`]),
  ["/THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
  ["/SOURCE-AVAILABILITY.json", "SOURCE-AVAILABILITY.json"],
  ["/LICENSE", "LICENSE"],
  ["/NOTICE", "NOTICE"],
]);
const licenseNames = (await readdir(join(outputRoot, "LICENSES"))).sort();
const expectedLicenseBodyCount = binding.noticeReview?.licenseBodyCount;
if (!Number.isInteger(expectedLicenseBodyCount) || expectedLicenseBodyCount < 1) fail("LICENSE_BODY_COUNT_BINDING");
if (licenseNames.length !== expectedLicenseBodyCount) fail(`LICENSE_COUNT:${licenseNames.length}`);
for (const name of licenseNames) expected.set(`/LICENSES/${name}`, `LICENSES/${name}`);

const outputFiles = await allEntries(outputRoot);
const expectedFiles = [...new Set(expected.values())].sort();
if (outputFiles.length !== expectedFiles.length) fail(`OUTPUT_COUNT:${outputFiles.length}`);
if (JSON.stringify(outputFiles) !== JSON.stringify(expectedFiles)) fail("OUTPUT_FILE_LIST_MISMATCH");
const routeFacts = {};
for (const [route, relative] of expected) {
  const factsForRoute = await facts(relative);
  routeFacts[route] = { status: 200, methodModel: ["GET", "HEAD"], path: `/${relative}`, ...factsForRoute };
}
const unknownRoute = { status: 404, methodModel: ["GET", "HEAD"], path: "/__study_runner_unknown__" };

function requireByteEquality(label, left, right) {
  if (!left.equals(right)) fail(label);
}

const rootSourceAvailabilityBytes = await readFile(join(root, "runtime", "SOURCE-AVAILABILITY.json"));
const rootThirdPartyNoticeBytes = await readFile(join(root, "runtime", "THIRD_PARTY_NOTICES.txt"));
const rootLicenseBytes = await readFile(join(root, "LICENSE"));
const rootNoticeBytes = await readFile(join(root, "NOTICE"));
const rootIndexBytes = await readFile(join(root, "runtime", "index.html"));
const servedSourceAvailabilityBytes = await readFile(join(outputRoot, "SOURCE-AVAILABILITY.json"));
const servedThirdPartyNoticeBytes = await readFile(join(outputRoot, "THIRD_PARTY_NOTICES.txt"));
const servedLicenseBytes = await readFile(join(outputRoot, "LICENSE"));
const servedNoticeBytes = await readFile(join(outputRoot, "NOTICE"));
const servedIndexBytes = await readFile(join(outputRoot, "index.html"));
if (digest(rootSourceAvailabilityBytes) !== binding.noticeReview.sourceAvailabilitySha256) fail("SOURCE_AVAILABILITY_ROOT_HASH_MISMATCH");
if (routeFacts["/SOURCE-AVAILABILITY.json"].sha256 !== binding.noticeReview.sourceAvailabilitySha256) fail("SOURCE_AVAILABILITY_ROUTE_HASH_MISMATCH");
if (digest(rootThirdPartyNoticeBytes) !== binding.noticeReview.noticeSha256) fail("THIRD_PARTY_NOTICE_ROOT_HASH_MISMATCH");
if (routeFacts["/THIRD_PARTY_NOTICES.txt"].sha256 !== binding.noticeReview.noticeSha256) fail("THIRD_PARTY_NOTICE_ROUTE_HASH_MISMATCH");
requireByteEquality("SOURCE_AVAILABILITY_ROUTE_COPY_MISMATCH", servedSourceAvailabilityBytes, rootSourceAvailabilityBytes);
requireByteEquality("THIRD_PARTY_NOTICE_ROUTE_COPY_MISMATCH", servedThirdPartyNoticeBytes, rootThirdPartyNoticeBytes);
requireByteEquality("LICENSE_ROOT_COPY_MISMATCH", servedLicenseBytes, rootLicenseBytes);
requireByteEquality("NOTICE_ROOT_COPY_MISMATCH", servedNoticeBytes, rootNoticeBytes);
requireByteEquality("INDEX_ROOT_COPY_MISMATCH", servedIndexBytes, rootIndexBytes);

const frame = await readFile(join(outputRoot, "frame.html"), "utf8");
const requiredCsp = "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'";
if (!frame.includes(`<meta http-equiv="Content-Security-Policy" content="${requiredCsp}">`)) fail("FRAME_CSP_META_MISSING");
const integrityMatch = frame.match(/<script src="\/assets\/study-runtime-frame\.js" integrity="(sha256-[A-Za-z0-9+/=]+)" crossorigin="anonymous"><\/script>/u);
if (!integrityMatch) fail("FRAME_SCRIPT_SRI_MISSING");
if (frame.includes("frame-ancestors")) fail("FRAME_ANCESTORS_CLAIM_IN_META");

const runtimeFiles = ["index.html", "frame.html", "assets/study-runtime-frame.js"];
const runtimeText = Object.fromEntries(await Promise.all(runtimeFiles.map(async (relative) => [relative, await readFile(join(outputRoot, relative), "utf8")] )));
const privatePatterns = [
  new RegExp(["/", "Users", "/"].join(""), "u"),
  new RegExp(["/", "Shared", "/", ["agent", "scratch"].join("-")].join(""), "u"),
  /BEGIN PRIVATE/u,
  /(?:Authorization|Proxy-Authorization):/iu,
  /Bearer\s+[A-Za-z0-9._-]{12,}/u,
  /(?:document\.cookie|localStorage|sessionStorage|indexedDB)/u,
];
const privacyMatches = [];
const authoredPrivacyFiles = ["index.html", "frame.html", "assets/study-runtime-frame.js"];
const servedPrivacyFiles = [
  ...authoredPrivacyFiles,
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.txt",
  "SOURCE-AVAILABILITY.json",
];
for (const relative of servedPrivacyFiles) {
  const text = (await readFile(join(outputRoot, relative))).toString("utf8");
  for (const pattern of privatePatterns) if (pattern.test(text)) privacyMatches.push({ path: relative, pattern: pattern.source });
}
if (privacyMatches.length !== 0) fail(`PRIVACY_MATCH:${JSON.stringify(privacyMatches)}`);

const publicSnapshotFiles = [
  "runtime-inputs.json",
  "README.md",
  "public-notice.html.txt",
  "package.json",
  "tsconfig.json",
  "LICENSE",
  "NOTICE",
  "COMMERCIAL-LICENSE.md",
  "CONTRIBUTING.md",
  "CLA.md",
  "dist-manifest.json",
  ".github/workflows/pages.yml",
  "runtime/index.html",
  "runtime/frame.html",
  "runtime/frame-runtime.js",
  "runtime/SOURCE-AVAILABILITY.json",
  "runtime/THIRD_PARTY_NOTICES.txt",
  "runtime/source/study-runtime-admission.js",
  "runtime/source/study-runtime-protocol.ts",
  "runtime/source/study-runtime-frame.ts",
  "runtime/source/study-runtime-controller.ts",
  "runtime/source/separate-origin-runtime-host.ts",
  "runtime/source/public-runner-contract.ts",
  "tools/build-public-runner.mjs",
  "tools/test-host6-classic-runner.mjs",
  "tools/test-host8-negative-controls.mjs",
  "tools/verify-dist-hashes.mjs",
  "tools/verify-static-policy.mjs",
  ".gitignore",
  ".github/pull_request_template.md",
];
const publicSnapshotPrivacyMatches = [];
for (const relative of publicSnapshotFiles) {
  const sourceText = (await readFile(join(root, relative))).toString("utf8");
  const text = relative === "tools/verify-static-policy.mjs"
    ? sourceText.replace(/const privatePatterns = \[[\s\S]*?\];/u, "")
    : sourceText;
  for (const pattern of privatePatterns) if (pattern.test(text)) publicSnapshotPrivacyMatches.push({ path: relative, pattern: pattern.source });
}
if (publicSnapshotPrivacyMatches.length !== 0) fail(`PUBLIC_SNAPSHOT_PRIVACY_MATCH:${JSON.stringify(publicSnapshotPrivacyMatches)}`);

const frameRuntime = runtimeText["assets/study-runtime-frame.js"];
const frameFetchCalls = [...frameRuntime.matchAll(/\bfetch\(([^\n]+)/gu)].map((match) => match[0]);
if (frameFetchCalls.length !== 1 || !frameFetchCalls[0].includes("fetch(lockUrl")) fail(`UNEXPECTED_FRAME_FETCH_SURFACE:${JSON.stringify(frameFetchCalls)}`);
const fetchCalls = frameFetchCalls;
const forbiddenNetworkApis = ["XMLHttpRequest", "WebSocket", "sendBeacon"].filter((name) => frameRuntime.includes(name));
if (forbiddenNetworkApis.length !== 0) fail(`FORBIDDEN_NETWORK_API:${forbiddenNetworkApis.join(",")}`);
const absoluteRuntimeUrls = [];

const inputBindingBytes = await readFile(inputBindingPath);
const inputFacts = { bytes: inputBindingBytes.byteLength, sha256: digest(inputBindingBytes) };
if (typeof binding.workflowSha256 !== "string") fail("WORKFLOW_HASH_PIN_MISSING");
const workflowPath = join(root, ".github", "workflows", "pages.yml");
const workflowBytes = await readFile(workflowPath);
const workflowSha256 = digest(workflowBytes);
if (workflowSha256 !== binding.workflowSha256) fail(`WORKFLOW_HASH_MISMATCH:${workflowSha256}`);
const sourceAvailability = JSON.parse(rootSourceAvailabilityBytes.toString("utf8"));
const namedLicenseRefs = new Map();
const completeLicenseReceipts = new Map();
function receiptFields(value) {
  const bytes = typeof value.bytes === "number" ? value.bytes : value.licenseBytes;
  const sha256 = typeof value.sha256 === "string" ? value.sha256 : value.licenseSha256;
  return { bytes, sha256 };
}
function collectLicenseRefs(value) {
  if (Array.isArray(value)) {
    for (const item of value) collectLicenseRefs(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if ((key === "path" || key === "licensePath") && typeof item === "string" && /^licenses\//iu.test(item)) {
      if (!item.startsWith("LICENSES/")) fail(`LICENSE_REFERENCE_CASE_OR_SCOPE:${item}`);
      const fields = receiptFields(value);
      const references = namedLicenseRefs.get(item) ?? [];
      references.push({ value, ...fields });
      namedLicenseRefs.set(item, references);
      if (typeof fields.bytes === "number" && typeof fields.sha256 === "string") {
        const receipts = completeLicenseReceipts.get(item) ?? [];
        receipts.push(fields);
        completeLicenseReceipts.set(item, receipts);
      }
    }
    collectLicenseRefs(item);
  }
}
collectLicenseRefs(sourceAvailability);
if (namedLicenseRefs.size === 0) fail("LICENSE_REFERENCE_INDEX_EMPTY");
const servedLicenseRefs = new Set(licenseNames.map((name) => `LICENSES/${name}`));
const referencedLicenseRefs = new Set(namedLicenseRefs.keys());
if (referencedLicenseRefs.size !== servedLicenseRefs.size
  || [...referencedLicenseRefs].some((relative) => !servedLicenseRefs.has(relative))) fail("LICENSE_REFERENCE_SET_MISMATCH");
if (referencedLicenseRefs.size !== expectedLicenseBodyCount) fail("LICENSE_REFERENCE_COUNT_BINDING");
for (const [relative, references] of namedLicenseRefs.entries()) {
  const route = routeFacts[`/${relative}`];
  if (!route) fail(`LICENSE_REFERENCE_UNSERVED:${relative}`);
  const completeReceipts = completeLicenseReceipts.get(relative) ?? [];
  if (completeReceipts.length === 0) fail(`LICENSE_REFERENCE_RECEIPT_MISSING:${relative}`);
  const authoritative = completeReceipts[0];
  for (const receipt of completeReceipts) {
    if (receipt.bytes !== authoritative.bytes || receipt.sha256 !== authoritative.sha256) fail(`LICENSE_REFERENCE_RECEIPT_CONFLICT:${relative}`);
  }
  if (route.bytes !== authoritative.bytes) fail(`LICENSE_REFERENCE_BYTES:${relative}`);
  if (route.sha256 !== authoritative.sha256) fail(`LICENSE_REFERENCE_HASH:${relative}`);
  for (const reference of references) {
    if (typeof reference.bytes === "number" && reference.bytes !== authoritative.bytes) fail(`LICENSE_REFERENCE_BYTES_METADATA:${relative}`);
    if (typeof reference.sha256 === "string" && reference.sha256 !== authoritative.sha256) fail(`LICENSE_REFERENCE_HASH_METADATA:${relative}`);
  }
}
const finalBundle = await readFile(join(outputRoot, "assets/study-runtime-frame.js"));
const finalBundleHash = digest(finalBundle);
const finalBundleSri = `sha256-${Buffer.from(createHash("sha256").update(finalBundle).digest()).toString("base64")}`;
if (integrityMatch[1] !== finalBundleSri) fail("FRAME_SRI_MISMATCH");
const core = await readFile(join(root, "runtime", "frame-runtime.js"));
const coreIndex = finalBundle.indexOf(core);
if (coreIndex < 0 || finalBundle.indexOf(core, coreIndex + 1) >= 0) fail("CORE_SUBSTRING_BINDING_MISMATCH");
const coreMarker = Buffer.from("// HOST5_CORE_BEGIN");
const coreEndMarker = Buffer.from("// HOST5_CORE_END");
const markerIndex = finalBundle.indexOf(coreMarker);
const endMarkerIndex = finalBundle.indexOf(coreEndMarker);
if (markerIndex < 0 || endMarkerIndex < markerIndex || coreIndex < markerIndex || coreIndex > endMarkerIndex) fail("CORE_MARKER_BOUNDARY_MISMATCH");
const prelude = finalBundle.subarray(0, markerIndex).toString("utf8");
if (/\b(?:fetch|import|eval)\s*\(/u.test(prelude) || /\b(?:Worker|Blob|setTimeout|setInterval)\b/u.test(prelude)) fail("ASYNC_GATE_API_PRESENT");
if (!prelude.includes("https://sam.lair.knowledge-forge.ai") || !prelude.includes("https://www.knowledge-forge.ai")) fail("FIXED_PARENT_ALLOWLIST_MISSING");
if (routeFacts["/assets/study-runtime-frame.js"].sha256 !== finalBundleHash) fail("FRAME_OUTPUT_HASH_MISMATCH");
if (routeFacts["/assets/study-runtime-frame.js"].bytes !== finalBundle.byteLength) fail("FRAME_OUTPUT_BYTES_MISMATCH");
if (routeFacts["/assets/study-runtime-frame.js"].sha256 === binding.emitter.coreFixture.sha256) fail("FINAL_BUNDLE_NOT_WRAPPED");
if (coreIndex < 0 || digest(core) !== binding.emitter.coreFixture.sha256) fail("CORE_FIXTURE_BINDING_MISMATCH");
absoluteRuntimeUrls.push(...[...(runtimeText["frame.html"] + finalBundle.subarray(coreIndex).toString("utf8")).matchAll(/https?:\/\//gu)].map((match) => match[0]));
if (absoluteRuntimeUrls.length !== 0) fail(`ABSOLUTE_RUNTIME_URL:${absoluteRuntimeUrls.join(",")}`);
for (const [assetPath, receipt] of Object.entries(binding.coreAssets ?? {})) {
  const route = routeFacts[assetPath];
  if (!route || route.bytes !== receipt.bytes || route.sha256 !== receipt.sha256) fail(`CORE_ASSET_BINDING_MISMATCH:${assetPath}`);
}

const workflow = await readFile(join(root, ".github", "workflows", "pages.yml"), "utf8");
if (!workflow.includes("workflow_dispatch:") || workflow.includes("secrets.")
  || !workflow.includes("runs-on: ubuntu-24.04")
  || !workflow.includes("timeout-minutes: 10")
  || !workflow.includes("cancel-in-progress: false")
  || !workflow.includes("persist-credentials: false")
  || !workflow.includes('test "${GITHUB_REPOSITORY}" = "Knowledge-Forge-AI/study-runner"')
  || !workflow.includes('test "${GITHUB_REF}" = "refs/heads/main"')
  || !workflow.includes("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683")
  || !workflow.includes("actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa")
  || !workflow.includes("actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e")) fail("WORKFLOW_POLICY_MISMATCH");
const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (Object.keys(packageMetadata.dependencies ?? {}).length !== 0 || JSON.stringify(packageMetadata.devDependencies) !== JSON.stringify({ typescript: "7.0.2" })) fail("PACKAGE_DEPENDENCY_POLICY_MISMATCH");
const governancePaths = ["NOTICE", "COMMERCIAL-LICENSE.md", "CONTRIBUTING.md", "CLA.md"];
const governanceText = Object.fromEntries(await Promise.all(governancePaths.map(async (relative) => [relative, await readFile(join(root, relative), "utf8")] )));
if (Object.values(governanceText).some((text) => /\b[A-Za-z0-9._%+-]+@gmail\.com\b/iu.test(text))) fail("PRIVATE_GOVERNANCE_CONTACT");
if (!governanceText.NOTICE.includes("sam.lair@knowledge-forge.ai")
  || !governanceText.NOTICE.includes("ACCEPT-STUDY-RUNNER-CORE-NOTICES")
  || Object.values(governanceText).some((text) => /retained notice review(?: is| verdict is) REVISE/iu.test(text))) fail("GOVERNANCE_POLICY_MISMATCH");
const servedGovernancePaths = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt", "SOURCE-AVAILABILITY.json"];
const servedGovernanceText = Object.fromEntries(await Promise.all(servedGovernancePaths.map(async (relative) => [relative, await readFile(join(outputRoot, relative), "utf8")] )));
if (Object.values(servedGovernanceText).some((text) => /\b[A-Za-z0-9._%+-]+@gmail\.com\b/iu.test(text))) fail("SERVED_PRIVATE_GOVERNANCE_CONTACT");
if (Object.values(servedGovernanceText).some((text) => /retained notice review(?: is| verdict is) REVISE/iu.test(text))) fail("SERVED_GOVERNANCE_POLICY_MISMATCH");

const receipt = {
  schema: "study-runner-static-policy-check.v3",
  status: "STATIC_ONLY_PASS",
  scope: "pure file/route/policy inspection; no HTTP, server, browser, runtime, install, or network execution",
  outputFileCount: outputFiles.length,
  routeCount: expected.size,
  licenseBodyCount: licenseNames.length,
  routeModel: { simulatedStaticDispatch: true, get: 200, head: 200, unknownRoute: 404, routes: routeFacts, unknown: unknownRoute },
  mimeModel: { source: "extension mapping only; server MIME headers untested", checked: true },
  frameCsp: { checked: true, value: requiredCsp, frameAncestors: "not claimed" },
  sourceBindings: { noticeSha256: binding.noticeReview.noticeSha256, sourceAvailabilitySha256: binding.noticeReview.sourceAvailabilitySha256, licenseBodyCount: expectedLicenseBodyCount },
  servedCopies: {
    sourceAvailability: { rootBytes: rootSourceAvailabilityBytes.byteLength, rootSha256: digest(rootSourceAvailabilityBytes), servedBytes: servedSourceAvailabilityBytes.byteLength, servedSha256: digest(servedSourceAvailabilityBytes), byteEqual: true },
    thirdPartyNotice: { rootBytes: rootThirdPartyNoticeBytes.byteLength, rootSha256: digest(rootThirdPartyNoticeBytes), servedBytes: servedThirdPartyNoticeBytes.byteLength, servedSha256: digest(servedThirdPartyNoticeBytes), byteEqual: true },
    license: { rootBytes: rootLicenseBytes.byteLength, rootSha256: digest(rootLicenseBytes), servedBytes: servedLicenseBytes.byteLength, servedSha256: digest(servedLicenseBytes), byteEqual: true },
    notice: { rootBytes: rootNoticeBytes.byteLength, rootSha256: digest(rootNoticeBytes), servedBytes: servedNoticeBytes.byteLength, servedSha256: digest(servedNoticeBytes), byteEqual: true },
    index: { rootBytes: rootIndexBytes.byteLength, rootSha256: digest(rootIndexBytes), servedBytes: servedIndexBytes.byteLength, servedSha256: digest(servedIndexBytes), byteEqual: true },
  },
  privacy: { checked: true, scannedAuthoredFiles: authoredPrivacyFiles, scannedServedFiles: servedPrivacyFiles, publicSnapshotFiles, excludedVendorAssets: ["pyodide/*", "LICENSES/*"], matches: privacyMatches, publicSnapshotMatches: publicSnapshotPrivacyMatches, assetOnlyNoAuth: true, parentState: "cross-origin parent-owned; not in public bundle" },
  governance: { checked: true, scannedFiles: governancePaths, scannedServedFiles: servedGovernancePaths, businessContact: "sam.lair@knowledge-forge.ai", privateContactPresent: false, noticeReviewStaleText: false },
  network: { checked: true, fetchCalls, allowedFetch: ["same-origin lockUrl with credentials omit"], forbiddenApis: forbiddenNetworkApis, absoluteRuntimeUrls: absoluteRuntimeUrls },
  integrity: { checked: true, inputManifest: { bytes: inputFacts.bytes, sha256: inputFacts.sha256 }, coreSource: { bytes: binding.emitter.coreFixture.bytes, sha256: binding.emitter.coreFixture.sha256 }, finalBundle: { bytes: finalBundle.byteLength, sha256: finalBundleHash, sri: finalBundleSri, coreSubstringExact: true }, coreAssetsBound: true, licenseReferencesBound: namedLicenseRefs.size, synchronousAdmission: true },
  workflow: { manualOnly: true, pinnedActions: true, sha256: workflowSha256, exactRunner: "ubuntu-24.04", timeoutMinutes: 10, exactRepositoryMainGuard: true, checkoutPersistCredentials: false, cancelInProgress: false, secretsReference: false },
  execution: { node: process.versions.node, httpRequests: 0, browser: false, runtime: false, installation: false, remoteMutation: false },
};
await mkdir(receiptRoot, { recursive: true });
await writeFile(join(receiptRoot, "static-policy-check.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ staticPolicy: "PASS", outputFiles: outputFiles.length, routes: expected.size, licenses: licenseNames.length, networkRequests: 0 }));
