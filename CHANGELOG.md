## [1.11.0] - 2026-07-09

### Changes
- chore: update dev dependencies (eslint 10, vitest 4.1.10) (#100)
- fix: dispose orphaned handles when an abort interrupts marshalling mid-flight (#99)
- feat: asyncify host functions so the guest can call them synchronously (#32) (#98)
- perf: per-property fast paths in marshal/unmarshal properties (#96)
- feat: accept filename and eval options in evalCode/evalModule (#95)
- perf: cut VM roundtrips on hot marshal/unmarshal paths (#94)
- fix: detect class constructors behind the host proxy wrapper (#92) (#93)
- docs: add @reearth/zushi callout at the top of the README (#89)
## [1.10.0] - 2026-06-09

### Changes
- perf: stop deep-copying the VM global when a host fn is called plainly (#85)
- fix: preserve object identity across the host boundary (#4) (#84)
- fix: dispose orphaned sibling handle when evicting a stale VMMap entry (#83)
- chore: add Backstage catalog-info.yaml (#82)
## [1.9.1] - 2026-05-28

### Changes
- fix: dispose handles of value-marshalled built-ins nested in another value
- fix: dispose unowned marshal handles (json copies, BigInt) instead of leaking
## [1.9.0] - 2026-05-28

### Changes
- ci: report coverage via vitest-coverage-report-action instead of codecov
- docs: rewrite and expand README
- feat: synchronize Object.defineProperty across the boundary
- feat: add marshalByReference for opaque pass-by-reference (HostRef)
- feat: marshal BigInt values
- feat: add syncEnabled option to disable sync globally (closes #31)
- docs: document new marshalling support, AsyncArena, and using
- feat: add AsyncArena for QuickJSAsyncContext
- feat: marshal ArrayBuffer/TypedArray/Map/Set and add Arena[Symbol.dispose]
- refactor: use native VM APIs and clean up VMMap
- perf: cache compiled functions per context in call()
- fix: upgrade to quickjs-emscripten 0.32 and fix handle leaks it surfaces
- ci: auto-push version tag when a release PR is merged
## [1.8.4] - 2026-05-28

### Changes
- fix: align package.json entry points with Vite v7 output filenames
## [1.8.3] - 2026-05-28

### Changes
- fix: add types condition to exports field
## [1.8.2] - 2026-05-14

### Changes
- chore: bump dev deps, harden CI, add Trusted-Publishing release workflow (#70)
## [1.8.1] - 2026-02-03

### Changes
- chore: Upgrade Dev Dependencies (#63)
# Changelog

All notable changes to this project will be documented in this file.

## [1.8.0] - 2025-12-12

### Changes
- feat: upgrade to quickjs-emscripten 0.31.0 (#60)

## [1.7.0] - 2025-12-08

### Changes

- feat: quickjs-emscripten upgrade to 0.29 (#58)

  ## Core Upgrade

  - Upgrade quickjs-emscripten from 0.25.0 to 0.29.0
  - Fix Disposable interface implementation in vmutil.ts to support Symbol.dispose (required by 0.29.0)

  ## Module System Enhancements (0.29.0)

  - Update evalModule() to return module exports (previously returned void)

## [1.6.0] - 2025-11-26

### Changes

- chore: update quickjs-emscripten package version and dependencies (#53)
- ci: update renovate.json
