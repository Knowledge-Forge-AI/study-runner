import { STUDY_RUNTIME_ASSET_PATHS } from "./study-runtime-protocol.js";

/** Exact-origin and static-route contract for the Study Runner repository. */
export const PUBLIC_RUNNER_ORIGIN = "https://study-runner.knowledge-forge.ai" as const;

export const PUBLIC_RUNNER_META_CSP =
  "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self'; style-src 'self'" as const;

/** CSP required by the fixed runner frame itself; response headers remain host-owned. */
export const PUBLIC_RUNNER_FRAME_META_CSP =
  "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'" as const;

export const PUBLIC_RUNNER_FRAME_PATH = "/frame.html" as const;
export const PUBLIC_RUNNER_FRAME_RUNTIME_PATH = "/assets/study-runtime-frame.js" as const;

/** The five Pyodide members are the only runtime core assets in this profile. */
export const PUBLIC_RUNNER_CORE_ASSET_PATHS = Object.freeze([
  STUDY_RUNTIME_ASSET_PATHS.modulePath,
  STUDY_RUNTIME_ASSET_PATHS.asmModulePath,
  STUDY_RUNTIME_ASSET_PATHS.wasmPath,
  STUDY_RUNTIME_ASSET_PATHS.stdlibPath,
  STUDY_RUNTIME_ASSET_PATHS.lockPath,
] as const);

export type PublicRunnerCoreAssetPath = (typeof PUBLIC_RUNNER_CORE_ASSET_PATHS)[number];

export const PUBLIC_RUNNER_NOTICE_PATH = "/THIRD_PARTY_NOTICES.txt" as const;
export const PUBLIC_RUNNER_SOURCE_AVAILABILITY_PATH = "/SOURCE-AVAILABILITY.json" as const;

export const PUBLIC_RUNNER_NO_CDN = true as const;
export const PUBLIC_RUNNER_FETCH_CREDENTIALS = "omit" as const;

export interface PublicRunnerAssetReceipt {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly contentType: string;
}

export interface PublicRunnerBuildManifest {
  readonly schema: "study-runner-public-host-prep.v1";
  readonly origin: typeof PUBLIC_RUNNER_ORIGIN;
  readonly noCdn: typeof PUBLIC_RUNNER_NO_CDN;
  readonly framePath: typeof PUBLIC_RUNNER_FRAME_PATH;
  readonly frameRuntimePath: typeof PUBLIC_RUNNER_FRAME_RUNTIME_PATH;
  readonly coreAssets: readonly PublicRunnerAssetReceipt[];
  readonly noticePath: typeof PUBLIC_RUNNER_NOTICE_PATH;
  readonly sourceAvailabilityPath: typeof PUBLIC_RUNNER_SOURCE_AVAILABILITY_PATH;
}
