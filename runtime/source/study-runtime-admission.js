"use strict";

const HOST5_APPROVED_HTTPS_PARENTS = Object.freeze([
  "https://sam.lair.knowledge-forge.ai",
  "https://www.knowledge-forge.ai",
]);

function host5CanonicalOrigin(value) {
  if (typeof value !== "string" || value.length > 256) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/"
    || parsed.search !== "" || parsed.hash !== "") return undefined;
  if (parsed.protocol !== "https:"
    && !(parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"))) {
    return undefined;
  }
  return parsed.origin === value ? parsed.origin : undefined;
}

function host5IsLoopbackHttp(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.protocol === "http:"
      && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  } catch {
    return false;
  }
}

function host5IsHttps(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function host5AdmitParent(parentValue, runnerValue) {
  const parentOrigin = host5CanonicalOrigin(parentValue);
  const runnerOrigin = host5CanonicalOrigin(runnerValue);
  if (parentOrigin === undefined || runnerOrigin === undefined || parentOrigin === runnerOrigin) return undefined;
  if (host5IsHttps(runnerOrigin) && HOST5_APPROVED_HTTPS_PARENTS.includes(parentOrigin)) return parentOrigin;
  if (host5IsLoopbackHttp(runnerOrigin) && host5IsLoopbackHttp(parentOrigin)) return parentOrigin;
  return undefined;
}

