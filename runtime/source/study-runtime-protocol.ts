/**
 * Versioned wire and caller contract for the separate-origin study runtime.
 *
 * This source deliberately does not create DOM nodes or load a runtime. The
 * host and frame implement the selected distinct-origin topology; this module
 * owns the bounded data contract and the parent-side wire readers.
 */

export const STUDY_RUNTIME_PROTOCOL = "study-runtime-v1" as const;
export const STUDY_RUNTIME_FRAME_PATH = "/frame.html" as const;
export const STUDY_RUNTIME_SANDBOX = "allow-scripts allow-same-origin" as const;

export const STUDY_RUNTIME_ASSET_PATHS = Object.freeze({
  modulePath: "/pyodide/pyodide.mjs",
  asmModulePath: "/pyodide/pyodide.asm.mjs",
  wasmPath: "/pyodide/pyodide.asm.wasm",
  stdlibPath: "/pyodide/python_stdlib.zip",
  lockPath: "/pyodide/pyodide-lock.json",
} as const);

export const STUDY_RUNTIME_LIMITS = Object.freeze({
  maxSourceBytes: 64 * 1024,
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 64 * 1024,
  maxInitMs: 45_000,
  maxProgramMs: 3_000,
  maxInputDepth: 32,
  maxInputNodes: 4_096,
  maxInputKeyBytes: 256,
  maxOutputDepth: 32,
  maxOutputNodes: 8_192,
} as const);

export type StudyRuntimeLanguage = "javascript" | "python";

export type StudyRuntimeJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StudyRuntimeJsonValue[]
  | { readonly [key: string]: StudyRuntimeJsonValue };

export type StudyRuntimeStream = "stdout" | "stderr";

export type StudyRuntimeProbePhase = "startup" | "init" | "program" | "terminal";

export type StudyRuntimeProbeCategory =
  | "INIT_STARTED"
  | "INIT_OK"
  | "PROGRAM_STARTED"
  | "COMPLETED"
  | "STOPPED"
  | "OUTPUT_LIMIT"
  | "INVALID_SOURCE"
  | "INVALID_INPUT"
  | "INVALID_ENTRY"
  | "INIT_FAILED"
  | "RUNTIME_ERROR";

export type StudyRuntimeErrorCode =
  | "PROTOCOL_ERROR"
  | "HOST_UNAVAILABLE"
  | "INIT_FAILED"
  | "RUNTIME_ERROR"
  | "INVALID_SOURCE"
  | "INVALID_INPUT"
  | "INVALID_ENTRY"
  | "OUTPUT_LIMIT";

export type StudyRuntimeUsageCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_SOURCE"
  | "INVALID_INPUT"
  | "INVALID_ENTRY"
  | "ALREADY_STARTED"
  | "DISPOSED";

export interface StudyRuntimeAssetConfig {
  readonly modulePath: typeof STUDY_RUNTIME_ASSET_PATHS.modulePath;
  readonly asmModulePath: typeof STUDY_RUNTIME_ASSET_PATHS.asmModulePath;
  readonly wasmPath: typeof STUDY_RUNTIME_ASSET_PATHS.wasmPath;
  readonly stdlibPath: typeof STUDY_RUNTIME_ASSET_PATHS.stdlibPath;
  readonly lockPath: typeof STUDY_RUNTIME_ASSET_PATHS.lockPath;
}

export interface StudyRuntimeLimits {
  readonly maxSourceBytes: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxInitMs: number;
  readonly maxProgramMs: number;
  readonly maxInputDepth: number;
  readonly maxInputNodes: number;
  readonly maxInputKeyBytes: number;
  readonly maxOutputDepth: number;
  readonly maxOutputNodes: number;
}

export interface StudyRuntimeWatchdog {
  readonly set: (callback: () => void, delayMs: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

export interface StudyRuntimeHostPort {
  readonly send: (message: StudyRuntimeCommand) => void;
  readonly subscribe: (listener: (message: unknown) => void) => () => void;
  readonly close: () => void;
}

export interface StudyRuntimeHostJob {
  readonly port: StudyRuntimeHostPort;
  readonly dispose: () => void;
}

export interface StudyRuntimeHost {
  readonly parentOrigin: string;
  readonly runnerOrigin: string;
  readonly createJob: (runId: string) => StudyRuntimeHostJob;
}

export interface StudyRuntimeProbe {
  readonly phase: StudyRuntimeProbePhase;
  readonly category: StudyRuntimeProbeCategory;
  readonly terminal: boolean;
}

export interface StudyRuntimeOutput {
  readonly stream: StudyRuntimeStream;
  readonly text: string;
}

export interface StudyRuntimeControllerOptions {
  readonly language: StudyRuntimeLanguage;
  readonly source: string;
  readonly input: unknown;
  readonly entry?: string;
  readonly host: StudyRuntimeHost;
  readonly watchdog: StudyRuntimeWatchdog;
  readonly limits?: Partial<StudyRuntimeLimits>;
  readonly onProbe?: (probe: StudyRuntimeProbe) => void;
  readonly onOutput?: (output: StudyRuntimeOutput) => void;
}

export type StudyRuntimeOutcome =
  | Readonly<{ kind: "completed"; value: StudyRuntimeJsonValue; stdout: string; stderr: string }>
  | Readonly<{ kind: "stopped"; stdout: string; stderr: string }>
  | Readonly<{ kind: "timeout"; phase: "initialization" | "program"; stdout: string; stderr: string }>
  | Readonly<{ kind: "error"; code: StudyRuntimeErrorCode; stdout: string; stderr: string }>;

export interface StudyRuntimeController {
  readonly runId: string;
  readonly start: () => Promise<StudyRuntimeOutcome>;
  readonly stop: () => void;
  readonly dispose: () => void;
}

export interface StudyRuntimeRunCommand {
  readonly type: "run";
  readonly protocol: typeof STUDY_RUNTIME_PROTOCOL;
  readonly runId: string;
  readonly language: StudyRuntimeLanguage;
  readonly source: string;
  readonly inputJson: string;
  readonly entry?: string;
  readonly maxOutputBytes: number;
}

export interface StudyRuntimeStopCommand {
  readonly type: "stop";
  readonly protocol: typeof STUDY_RUNTIME_PROTOCOL;
  readonly runId: string;
}

export type StudyRuntimeCommand = StudyRuntimeRunCommand | StudyRuntimeStopCommand;

interface StudyRuntimeProbeMessage {
  readonly type: "probe";
  readonly protocol: typeof STUDY_RUNTIME_PROTOCOL;
  readonly runId: string;
  readonly phase: StudyRuntimeProbePhase;
  readonly category: StudyRuntimeProbeCategory;
  readonly terminal: boolean;
}

interface StudyRuntimeOutputMessage {
  readonly type: StudyRuntimeStream;
  readonly protocol: typeof STUDY_RUNTIME_PROTOCOL;
  readonly runId: string;
  readonly text: string;
  readonly bytes: number;
}

interface StudyRuntimeResultMessage {
  readonly type: "result";
  readonly protocol: typeof STUDY_RUNTIME_PROTOCOL;
  readonly runId: string;
  readonly value: StudyRuntimeJsonValue;
}

interface StudyRuntimeErrorMessage {
  readonly type: "error";
  readonly protocol: typeof STUDY_RUNTIME_PROTOCOL;
  readonly runId: string;
  readonly code: StudyRuntimeErrorCode;
}

export type StudyRuntimeInboundMessage =
  | Readonly<{ kind: "probe"; value: StudyRuntimeProbe }>
  | Readonly<{ kind: "output"; value: StudyRuntimeOutput }>
  | Readonly<{ kind: "result"; value: StudyRuntimeJsonValue }>
  | Readonly<{ kind: "error"; code: StudyRuntimeErrorCode }>
  | Readonly<{ kind: "ignore" }>
  | Readonly<{ kind: "protocol" }>;

export class StudyRuntimeUsageError extends TypeError {
  readonly code: StudyRuntimeUsageCode;

  constructor(code: StudyRuntimeUsageCode) {
    super(`Study runtime usage is invalid: ${code}.`);
    this.name = "StudyRuntimeUsageError";
    this.code = code;
  }
}

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();
let nextRunNumber = 0;

export function studyRuntimeBytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function plainRecord(value: unknown, allowReservedKeys = false): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  let prototype: object | null;
  let keys: readonly (string | symbol)[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  for (const key of keys) {
    if (typeof key !== "string" || (!allowReservedKeys && RESERVED_KEYS.has(key))) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
  }
  return value as Record<string, unknown>;
}

function dataField(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function exactFields(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  const expectedSet = new Set(expected);
  return keys.length === expected.length && keys.every((key) => expectedSet.has(key));
}

interface JsonState {
  readonly seen: WeakSet<object>;
  nodes: number;
}

function normalizeJson(
  value: unknown,
  limits: StudyRuntimeLimits,
  depth: number,
  state: JsonState,
): StudyRuntimeJsonValue {
  if (depth > limits.maxInputDepth) throw new StudyRuntimeUsageError("INVALID_INPUT");
  state.nodes += 1;
  if (state.nodes > limits.maxInputNodes) throw new StudyRuntimeUsageError("INVALID_INPUT");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (hasLoneSurrogate(value) || studyRuntimeBytes(value) > limits.maxInputBytes) {
      throw new StudyRuntimeUsageError("INVALID_INPUT");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StudyRuntimeUsageError("INVALID_INPUT");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new StudyRuntimeUsageError("INVALID_INPUT");
  const objectValue = value as object;
  if (state.seen.has(objectValue)) throw new StudyRuntimeUsageError("INVALID_INPUT");
  state.seen.add(objectValue);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
        throw new StudyRuntimeUsageError("INVALID_INPUT");
      }
      const names = Object.getOwnPropertyNames(value);
      if (names.some((name) => name !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
        throw new StudyRuntimeUsageError("INVALID_INPUT");
      }
      if (value.length > limits.maxInputNodes) throw new StudyRuntimeUsageError("INVALID_INPUT");
      const result: StudyRuntimeJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new StudyRuntimeUsageError("INVALID_INPUT");
        }
        result.push(normalizeJson(descriptor.value, limits, depth + 1, state));
      }
      return Object.freeze(result);
    }
    const record = plainRecord(value);
    if (!record) throw new StudyRuntimeUsageError("INVALID_INPUT");
    const result: Record<string, StudyRuntimeJsonValue> = Object.create(null) as Record<string, StudyRuntimeJsonValue>;
    for (const key of Object.keys(record).sort()) {
      if (studyRuntimeBytes(key) > limits.maxInputKeyBytes) throw new StudyRuntimeUsageError("INVALID_INPUT");
      result[key] = normalizeJson(dataField(record, key), limits, depth + 1, state);
    }
    return Object.freeze(result);
  } finally {
    state.seen.delete(objectValue);
  }
}

export function normalizeStudyRuntimeLimits(value: Partial<StudyRuntimeLimits> | undefined): StudyRuntimeLimits {
  const candidate = value === undefined ? undefined : plainRecord(value);
  if (value !== undefined && !candidate) throw new StudyRuntimeUsageError("INVALID_CONFIGURATION");
  const read = (key: keyof StudyRuntimeLimits): number => {
    const raw = candidate && Object.hasOwn(candidate, key) ? dataField(candidate, key) : undefined;
    return raw === undefined ? STUDY_RUNTIME_LIMITS[key] : typeof raw === "number" ? raw : Number.NaN;
  };
  const result = {
    maxSourceBytes: read("maxSourceBytes"),
    maxInputBytes: read("maxInputBytes"),
    maxOutputBytes: read("maxOutputBytes"),
    maxInitMs: read("maxInitMs"),
    maxProgramMs: read("maxProgramMs"),
    maxInputDepth: read("maxInputDepth"),
    maxInputNodes: read("maxInputNodes"),
    maxInputKeyBytes: read("maxInputKeyBytes"),
    maxOutputDepth: read("maxOutputDepth"),
    maxOutputNodes: read("maxOutputNodes"),
  };
  const allowed = new Set(Object.keys(STUDY_RUNTIME_LIMITS));
  if (candidate && Object.keys(candidate).some((key) => !allowed.has(key))) {
    throw new StudyRuntimeUsageError("INVALID_CONFIGURATION");
  }
  // Result node/depth bounds are part of the frame/parent wire contract. They
  // are deliberately fixed until a protocol version carries them explicitly;
  // accepting a lowered parent-only value would turn a well-formed worker
  // OUTPUT_LIMIT into a misleading PROTOCOL_ERROR.
  for (const key of ["maxOutputDepth", "maxOutputNodes"] as const) {
    if (candidate && Object.hasOwn(candidate, key)) {
      const provided = dataField(candidate, key);
      if (provided !== undefined && provided !== STUDY_RUNTIME_LIMITS[key]) {
        throw new StudyRuntimeUsageError("INVALID_CONFIGURATION");
      }
    }
  }
  for (const [key, maximum] of Object.entries(STUDY_RUNTIME_LIMITS)) {
    const candidateValue = result[key as keyof StudyRuntimeLimits];
    if (!Number.isSafeInteger(candidateValue) || candidateValue < 1 || candidateValue > maximum) {
      throw new StudyRuntimeUsageError("INVALID_CONFIGURATION");
    }
  }
  return Object.freeze(result);
}

export function normalizeStudyRuntimeSource(value: unknown, limits: StudyRuntimeLimits): string {
  if (typeof value !== "string" || value.trim().length === 0 || hasLoneSurrogate(value)
    || studyRuntimeBytes(value) > limits.maxSourceBytes) {
    throw new StudyRuntimeUsageError("INVALID_SOURCE");
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0 || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
      || (code >= 0x7f && code <= 0x9f)) throw new StudyRuntimeUsageError("INVALID_SOURCE");
  }
  return value;
}

export function normalizeStudyRuntimeEntry(value: unknown, language: StudyRuntimeLanguage): string | undefined {
  if (language === "javascript") {
    if (value !== undefined) throw new StudyRuntimeUsageError("INVALID_ENTRY");
    return undefined;
  }
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(value)
    || value.startsWith("__tfsb_")) throw new StudyRuntimeUsageError("INVALID_ENTRY");
  return value;
}

export function normalizeStudyRuntimeInput(value: unknown, limits: StudyRuntimeLimits): { readonly value: StudyRuntimeJsonValue; readonly inputJson: string } {
  const normalized = normalizeJson(value, limits, 0, { seen: new WeakSet<object>(), nodes: 0 });
  let inputJson: string;
  try { inputJson = JSON.stringify(normalized); } catch { throw new StudyRuntimeUsageError("INVALID_INPUT"); }
  if (typeof inputJson !== "string" || studyRuntimeBytes(inputJson) > limits.maxInputBytes) {
    throw new StudyRuntimeUsageError("INVALID_INPUT");
  }
  return Object.freeze({ value: normalized, inputJson });
}

function validJsonValue(value: unknown, limits: StudyRuntimeLimits, depth: number, state: JsonState): value is StudyRuntimeJsonValue {
  if (depth > limits.maxOutputDepth) return false;
  state.nodes += 1;
  if (state.nodes > limits.maxOutputNodes) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return studyRuntimeBytes(value) <= limits.maxOutputBytes;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (state.seen.has(value)) return false;
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return false;
      const names = Object.getOwnPropertyNames(value);
      if (names.some((name) => name !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(name))) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)
          || !validJsonValue(descriptor.value, limits, depth + 1, state)) return false;
      }
      return true;
    }
    const record = plainRecord(value, true);
    if (!record) return false;
    for (const key of Object.keys(record)) {
      if (!validJsonValue(dataField(record, key), limits, depth + 1, state)) return false;
    }
    return true;
  } finally {
    state.seen.delete(value);
  }
}

function validProtocol(value: unknown): value is typeof STUDY_RUNTIME_PROTOCOL {
  return value === STUDY_RUNTIME_PROTOCOL;
}

const PROBE_PHASES = new Set<StudyRuntimeProbePhase>(["startup", "init", "program", "terminal"]);
const PROBE_CATEGORIES = new Set<StudyRuntimeProbeCategory>([
  "INIT_STARTED", "INIT_OK", "PROGRAM_STARTED", "COMPLETED", "STOPPED",
  "OUTPUT_LIMIT", "INVALID_SOURCE", "INVALID_INPUT", "INVALID_ENTRY", "INIT_FAILED", "RUNTIME_ERROR",
]);
const ERROR_CODES = new Set<StudyRuntimeErrorCode>([
  "PROTOCOL_ERROR", "HOST_UNAVAILABLE", "INIT_FAILED", "RUNTIME_ERROR", "INVALID_SOURCE", "INVALID_INPUT", "INVALID_ENTRY", "OUTPUT_LIMIT",
]);

export function parseStudyRuntimeInbound(
  value: unknown,
  runId: string,
  limits: StudyRuntimeLimits,
): StudyRuntimeInboundMessage {
  const record = plainRecord(value);
  if (!record) return { kind: "ignore" };
  if (dataField(record, "runId") !== runId || !validProtocol(dataField(record, "protocol"))) return { kind: "ignore" };
  const type = dataField(record, "type");
  if (type === "probe") {
    if (!exactFields(record, ["type", "protocol", "runId", "phase", "category", "terminal"])) return { kind: "protocol" };
    const phase = dataField(record, "phase");
    const category = dataField(record, "category");
    const terminal = dataField(record, "terminal");
    if (typeof phase !== "string" || !PROBE_PHASES.has(phase as StudyRuntimeProbePhase)
      || typeof category !== "string" || !PROBE_CATEGORIES.has(category as StudyRuntimeProbeCategory)
      || typeof terminal !== "boolean") return { kind: "protocol" };
    return { kind: "probe", value: { phase: phase as StudyRuntimeProbePhase, category: category as StudyRuntimeProbeCategory, terminal } };
  }
  if (type === "stdout" || type === "stderr") {
    if (!exactFields(record, ["type", "protocol", "runId", "text", "bytes"])) return { kind: "protocol" };
    const text = dataField(record, "text");
    const reportedBytes = dataField(record, "bytes");
    if (typeof text !== "string" || typeof reportedBytes !== "number" || !Number.isSafeInteger(reportedBytes)
      || reportedBytes < 0 || reportedBytes !== studyRuntimeBytes(text)
      || reportedBytes > limits.maxOutputBytes) return { kind: "protocol" };
    return { kind: "output", value: { stream: type, text } };
  }
  if (type === "result") {
    if (!exactFields(record, ["type", "protocol", "runId", "value"])) return { kind: "protocol" };
    const resultValue = dataField(record, "value");
    if (!validJsonValue(resultValue, limits, 0, { seen: new WeakSet<object>(), nodes: 0 })) return { kind: "protocol" };
    try {
      const serialized = JSON.stringify(resultValue);
      if (typeof serialized !== "string" || studyRuntimeBytes(serialized) > limits.maxOutputBytes) return { kind: "protocol" };
    } catch {
      return { kind: "protocol" };
    }
    return { kind: "result", value: resultValue };
  }
  if (type === "error") {
    if (!exactFields(record, ["type", "protocol", "runId", "code"])) return { kind: "protocol" };
    const code = dataField(record, "code");
    return typeof code === "string" && ERROR_CODES.has(code as StudyRuntimeErrorCode)
      ? { kind: "error", code: code as StudyRuntimeErrorCode } : { kind: "protocol" };
  }
  return { kind: "protocol" };
}

export function nextStudyRuntimeRunId(): string {
  nextRunNumber += 1;
  return `${STUDY_RUNTIME_PROTOCOL}-${nextRunNumber}`;
}

export function isStudyRuntimeAssetConfig(value: unknown): value is StudyRuntimeAssetConfig {
  const record = plainRecord(value);
  if (!record || !exactFields(record, Object.keys(STUDY_RUNTIME_ASSET_PATHS))) return false;
  return (Object.keys(STUDY_RUNTIME_ASSET_PATHS) as (keyof typeof STUDY_RUNTIME_ASSET_PATHS)[])
    .every((key) => dataField(record, key) === STUDY_RUNTIME_ASSET_PATHS[key]);
}

export function isStudyRuntimeOrigin(value: unknown): value is string {
  return canonicalStudyRuntimeOrigin(value) === value;
}

/** Return the browser's serialized origin only for an allowed origin value. */
export function canonicalStudyRuntimeOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 256) return undefined;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return undefined; }
  if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/"
    || parsed.search !== "" || parsed.hash !== "") return undefined;
  if (parsed.protocol !== "https:"
    && !(parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"))) {
    return undefined;
  }
  return parsed.origin;
}
