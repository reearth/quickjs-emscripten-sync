import variant from "@jitl/quickjs-wasmfile-debug-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";
import { describe, expect, it } from "vitest";

import { Arena } from ".";

// Marshalling the same host object into the VM more than once used to leak a
// handle: the first registration stores both a wrapped (proxy) handle and its
// unwrapped sibling. Once the VM frees the proxy, the map entry goes stale, and
// the lazy eviction in VMMap.get dropped the entry without disposing the
// still-alive sibling. The debug-sync runtime aborts on dispose if any GC
// object handle leaked, so reaching ctx.dispose() without an abort proves the
// sibling is now released.
async function withArena(fn: (arena: Arena) => void) {
  const mod = await newQuickJSWASMModuleFromVariant(variant as any);
  const ctx = mod.newContext();
  const arena = new Arena(ctx, { isMarshalable: true });
  fn(arena);
  arena.dispose();
  expect(() => ctx.dispose()).not.toThrow();
}

describe("re-marshal handle leak", () => {
  // Calling an exposed function from inside the VM marshals the whole global
  // graph on each call, which is slow under the debug-sync runtime + coverage,
  // so these get a generous timeout (cf. the "many newFunction" edge test).
  it(
    "does not leak when a host function returns the same object twice",
    async () => {
      await withArena(arena => {
        const shared = { k: 1 };
        arena.expose({ get: () => shared });
        arena.evalCode(`get(); get();`);
      });
    },
    90000,
  );

  it(
    "does not leak when the same object is compared across two calls",
    async () => {
      await withArena(arena => {
        const shared = { k: 1 };
        arena.expose({ get: () => shared });
        arena.evalCode(`get() === get();`);
      });
    },
    90000,
  );
});
