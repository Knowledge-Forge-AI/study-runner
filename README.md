# Knowledge Forge AI study runner

This bundle contains the source and static artifact for the proposed
`Knowledge-Forge-AI/study-runner` repository. It provides a separate-origin
browser runtime for interactive lessons, with JavaScript and Python support
through the bundled Pyodide 314.0.8 runtime (Python 3.14.2).

The build uses Node 22.23.4 and TypeScript 7.0.2 without installing packages or
using the network. The public contract is included in the source tree so all
runtime source files compile under TypeScript 7; the prior `TS1355` issue is not
silently hidden by excluding the contract. Expected hashes and asset pins are
bound by `runtime-inputs.json`.

`runtime/frame.html` is a deliberate host wrapper around the retained core fixture:
it adds the reviewed meta CSP and loads one classic SRI-bound bundle. That
bundle runs a synchronous owned admission guard before the byte-exact embedded
retained core, for fixed approved HTTPS parents or local loopback QA:

```text
default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'
```

This is not a `frame-ancestors` response-header claim and does not claim cookie
isolation. The synchronous admission gate is not browser embedding prevention;
the retained core still binds actual event origin, source window, and port.
Worker outcomes remain learner-controlled data; parent-side accounting and
validation remain the enforcement boundary.
The HTTPS parent gate is deliberately host-agnostic for approved HTTPS origins;
pinning a single runner origin would be a separate runtime change. Core and
parent protocol binding remain the enforcement boundary.

The output route map, notice bodies, source-availability record, workflow pins,
and static-only checks are recorded in `build-receipts/` when the local build
and verifier are run. The workflow is manual-only.

## Build prerequisites

The public source tree intentionally does not include `node_modules`, `.build`,
or compiler binaries. `tools/build-public-runner.mjs` performs no package
installation and no network access; a maintainer must provide the pinned
Node 22.23.4 runtime and TypeScript 7.0.2 compiler through an independently
qualified toolchain before regenerating `dist/`. This does not claim that a
clean environment already contains `tsc`, and it does not change the pinned
runtime inputs or public artifact hashes.
