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
