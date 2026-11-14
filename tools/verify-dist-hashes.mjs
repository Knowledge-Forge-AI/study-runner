import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = join(root, "dist");
const manifest = JSON.parse(await readFile(join(root, "dist-manifest.json"), "utf8"));

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sortedFiles(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) output.push(...await sortedFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) output.push(relative);
    else throw new Error(`SPECIAL_OR_LINK:${relative}`);
  }
  return output.sort();
}

if (manifest.schema !== "study-runner-dist-manifest.v1") throw new Error("DIST_MANIFEST_SCHEMA");
if (manifest.outputRoot !== "dist" || manifest.source !== "runtime-inputs.json") throw new Error("DIST_MANIFEST_SCOPE");
if (!Array.isArray(manifest.routes) || manifest.routeCount < manifest.routes.length) throw new Error("DIST_ROUTE_MANIFEST");
for (const required of ["/", "/index.html", "/frame.html", "/assets/study-runtime-frame.js", "/LICENSE", "/NOTICE", "/LICENSES/*"]) {
  if (!manifest.routes.includes(required)) throw new Error(`DIST_ROUTE_MISSING:${required}`);
}

const expectedFiles = Object.keys(manifest.files ?? {}).map((path) => {
  if (!/^\/[A-Za-z0-9._/-]+$/u.test(path)) throw new Error(`DIST_FILE_PATH:${path}`);
  return path.slice(1);
}).sort();
if (manifest.outputFileCount !== expectedFiles.length) throw new Error("DIST_FILE_COUNT_MANIFEST");
const actualFiles = await sortedFiles(distRoot);
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error("DIST_FILE_LIST_MISMATCH");
const literalRouteCount = manifest.routes.filter((route) => route !== "/LICENSES/*").length;
const licenseRouteCount = expectedFiles.filter((relative) => relative.startsWith("LICENSES/")).length;
const actualRouteCount = literalRouteCount + licenseRouteCount;
if (manifest.routeCount !== actualRouteCount) throw new Error("DIST_ROUTE_COUNT_MANIFEST");

for (const relative of expectedFiles) {
  const expected = manifest.files[`/${relative}`];
  const bytes = await readFile(join(distRoot, relative));
  const actual = { bytes: bytes.byteLength, sha256: digest(bytes) };
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(`DIST_FILE_HASH_MISMATCH:${relative}:${actual.sha256}`);
  }
}

console.log(JSON.stringify({
  schema: "study-runner-dist-hash-check.v1",
  status: "DIST_HASH_PASS",
  outputFileCount: actualFiles.length,
  routeCount: manifest.routeCount,
  networkRequests: 0,
  installation: false,
}));
