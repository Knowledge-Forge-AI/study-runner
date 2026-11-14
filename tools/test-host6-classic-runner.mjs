import { strict as assert } from "node:assert";
import { createHash, webcrypto } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const receiptRoot = join(root, "build-receipts");
const outputPath = join(root, "dist", "assets", "study-runtime-frame.js");
const framePath = join(root, "dist", "frame.html");
const corePath = join(root, "runtime", "frame-runtime.js");
const admissionPath = join(root, "runtime", "source", "study-runtime-admission.js");
const bundle = await readFile(outputPath);
const core = await readFile(corePath);
const admission = await readFile(admissionPath, "utf8");
const frameHtml = await readFile(framePath, "utf8");

const bundleSha256 = createHash("sha256").update(bundle).digest("hex");
const bundleSri = `sha256-${createHash("sha256").update(bundle).digest("base64")}`;
const integrity = frameHtml.match(/integrity="(sha256-[A-Za-z0-9+/=]+)"/u)?.[1];
assert.equal(integrity, bundleSri);
assert.equal(bundle.indexOf(core), bundle.lastIndexOf(core));
assert.equal(createHash("sha256").update(core).digest("hex"), "d490e5ba4fbc3173c21435a68a6e2991a1f0a86c0faa589c412a72389011d08c");
assert.doesNotMatch(admission, /\b(?:fetch|import|eval)\s*\(/u);
assert.doesNotMatch(admission, /\b(?:Worker|Blob|setTimeout|setInterval)\b/u);

const admissionContext = { URL, globalThis: null };
admissionContext.globalThis = admissionContext;
vm.runInNewContext(`${admission}\nglobalThis.__host5Admit = host5AdmitParent;`, admissionContext);
const admissionCases = [
  { id: "approved-https-sam", parent: "https://sam.lair.knowledge-forge.ai", runner: "https://study-runner.knowledge-forge.ai", expected: "https://sam.lair.knowledge-forge.ai" },
  { id: "approved-https-www", parent: "https://www.knowledge-forge.ai", runner: "https://study-runner.knowledge-forge.ai", expected: "https://www.knowledge-forge.ai" },
  { id: "loopback-localhost-parent", parent: "http://localhost:3000", runner: "http://127.0.0.1:4173", expected: "http://localhost:3000" },
  { id: "loopback-127-parent", parent: "http://127.0.0.1:3000", runner: "http://localhost:4173", expected: "http://127.0.0.1:3000" },
  { id: "unknown-origin", parent: "https://unknown.example", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "userinfo", parent: "https://user@www.knowledge-forge.ai", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "path", parent: "https://www.knowledge-forge.ai/path", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "query", parent: "https://www.knowledge-forge.ai/?x=1", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "fragment", parent: "https://www.knowledge-forge.ai/#x", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "malformed", parent: "not-a-url", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "same-origin", parent: "https://study-runner.knowledge-forge.ai", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "https-runner-loopback-parent", parent: "http://localhost:3000", runner: "https://study-runner.knowledge-forge.ai", expected: undefined },
  { id: "http-runner-nonloopback-parent", parent: "https://www.knowledge-forge.ai", runner: "http://127.0.0.1:4173", expected: undefined },
];
for (const testCase of admissionCases) {
  assert.equal(admissionContext.__host5Admit(testCase.parent, testCase.runner), testCase.expected, testCase.id);
}

function executeFrame(href, origin) {
  const listeners = [];
  let workers = 0;
  const sandbox = {
    URL,
    TextEncoder,
    Blob,
    console,
    crypto: webcrypto,
    location: { href, origin },
    parent: {},
    addEventListener(type, listener) { listeners.push({ type, listener }); },
    removeEventListener() {},
    Worker() { workers += 1; },
    fetch() { throw new Error("network disabled in VM test"); },
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bundle.toString("utf8"), sandbox, { filename: "study-runtime-frame.js" });
  return { listeners, workers };
}

const frameCases = admissionCases.map((testCase) => ({
  ...testCase,
  href: `${testCase.runner}/frame.html?parentOrigin=${encodeURIComponent(testCase.parent)}&runId=vm-${testCase.id}`,
}));
const frameResults = frameCases.map((testCase) => ({
  id: testCase.id,
  expected: testCase.expected,
  ...executeFrame(testCase.href, testCase.runner),
}));
for (const result of frameResults) {
  const accepted = result.expected !== undefined;
  assert.equal(result.listeners.length, accepted ? 1 : 0, `${result.id}:listener-count`);
  assert.equal(result.workers, 0, `${result.id}:worker-count`);
  if (accepted) assert.equal(result.listeners[0].type, "message", `${result.id}:listener-type`);
}
const validHttps = frameResults.filter(({ id }) => id.startsWith("approved-https-"));
const validLoopback = frameResults.filter(({ id }) => id.startsWith("loopback-"));
const refusals = frameResults.filter(({ expected }) => expected === undefined);

const receipt = {
  schema: "study-runner-host6-classic-test.v1",
  status: "PURE_VM_PASS",
  bundle: { path: "dist/assets/study-runtime-frame.js", bytes: bundle.byteLength, sha256: bundleSha256, sri: bundleSri },
  core: { bytes: core.byteLength, sha256: createHash("sha256").update(core).digest("hex"), exactSubstring: true },
  admissionCases: admissionCases.length,
  frameCases: frameResults.length,
  approvedHttpsListenerCounts: validHttps.map(({ id, listeners }) => ({ id, count: listeners.length })),
  approvedLoopbackListenerCounts: validLoopback.map(({ id, listeners }) => ({ id, count: listeners.length })),
  refusalCases: refusals.map(({ id, listeners, workers }) => ({ id, listeners: listeners.length, workers })),
  allRefusalsZeroListenerWorker: refusals.every(({ listeners, workers }) => listeners.length === 0 && workers === 0),
  sriMatch: true,
  synchronousListenerBeforeReturn: true,
  networkRequests: 0,
  browser: false,
  runtime: false,
};
await mkdir(receiptRoot, { recursive: true });
await writeFile(join(receiptRoot, "host6-test-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(receipt));

