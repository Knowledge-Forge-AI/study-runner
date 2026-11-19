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

### Optional browser compiler assets

The source includes three unmodified files from the locked [TypeScript 5.9.3 npm archive](https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz).
The compiler is an explicit opt-in asset for compatible lesson consumers.
The runner frame continues to accept JavaScript and Python. The static build
and verifier bind the three files by byte count and SHA-256:

- [TypeScript compiler](dist/assets/typescript-5.9.3.js)
- [Apache 2.0 license](dist/assets/typescript-5.9.3-LICENSE.txt)
- [Third-party notices](dist/assets/typescript-5.9.3-ThirdPartyNoticeText.txt)

The [upstream source commit for v5.9.3](https://github.com/microsoft/TypeScript/tree/c63de15a992d37f0d6cec03ac7631872838602cb)
is the provenance reference. The archive matches the study-components lockfile
integrity
`sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==`.
The checked-in browser compiler is separate from the pinned TypeScript tool
used to build the runner. Hosts must verify JavaScript MIME, compression, and
CORS at the compiler URL before enabling a lesson consumer.

### Runner build toolchain

The public source tree intentionally does not include `node_modules`, `.build`,
or compiler binaries. `tools/build-public-runner.mjs` performs no package
installation and no network access; a maintainer must provide the pinned
Node 22.23.4 runtime and TypeScript 7.0.2 compiler through an independently
qualified toolchain before regenerating `dist/`. This does not claim that a
clean environment already contains `tsc`, and it does not change the pinned
runtime inputs or public artifact hashes.
