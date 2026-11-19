import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// These are the exact unmodified files from the locked TypeScript 5.9.3
// npm archive. The compiler is an explicit optional consumer asset.
export const typescriptAssets = Object.freeze([
  Object.freeze({
    name: "typescript.js",
    route: "/assets/typescript-5.9.3.js",
    bytes: 9112572,
    sha256: "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675",
  }),
  Object.freeze({
    name: "LICENSE.txt",
    route: "/assets/typescript-5.9.3-LICENSE.txt",
    bytes: 9197,
    sha256: "a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47",
  }),
  Object.freeze({
    name: "ThirdPartyNoticeText.txt",
    route: "/assets/typescript-5.9.3-ThirdPartyNoticeText.txt",
    bytes: 37824,
    sha256: "1af3c68039c57e539422da82a4faada506ce6d0ea6f90e0b699d02dbcdb7a90c",
  }),
]);

export async function readTypeScriptAssets(root, readDist = false) {
  const prefix = readDist ? ["dist"] : ["runtime", "typescript-5.9.3"];
  const records = [];
  for (const asset of typescriptAssets) {
    const leaf = readDist ? asset.route.slice(1) : asset.name;
    const path = join(root, ...prefix, leaf);
    let parent = dirname(path);
    while (parent !== root) {
      if (!(await lstat(parent)).isDirectory()) throw new Error("TYPESCRIPT_ASSET_DIRECTORY");
      parent = dirname(parent);
    }
    const meta = await lstat(path);
    if (!meta.isFile() || meta.size !== asset.bytes) throw new Error("TYPESCRIPT_ASSET_FILE");
    const body = await readFile(path);
    if (body.byteLength !== asset.bytes || createHash("sha256").update(body).digest("hex") !== asset.sha256) {
      throw new Error("TYPESCRIPT_ASSET_HASH");
    }
    records.push({asset, body});
  }
  return records;
}
