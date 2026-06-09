import variant from "@jitl/quickjs-wasmfile-debug-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";
import { describe, expect, it } from "vitest";

import { Arena } from ".";

// A host function's return value is disposed by the VM once consumed. Marshalled
// object handles are retained in the VMMap for identity while sync is on, so the
// returned handle must be dup'd — otherwise the map entry goes stale and the same
// value marshalled twice yields two distinct VM objects (and used to leak). These
// tests pin the identity behaviour (issue #4).
async function withArena(
  options: ConstructorParameters<typeof Arena>[1],
  fn: (arena: Arena) => void,
) {
  const mod = await newQuickJSWASMModuleFromVariant(variant as any);
  const ctx = mod.newContext();
  const arena = new Arena(ctx, options);
  fn(arena);
  arena.dispose();
  expect(() => ctx.dispose()).not.toThrow();
}

describe("marshal identity", () => {
  it("preserves identity for a VM object round-tripped through the host", async () => {
    await withArena({ isMarshalable: true }, arena => {
      arena.expose({ id: (x: any) => x });
      // foo originates in the VM, is passed to the host and returned: the
      // round-trip must yield the same object.
      expect(arena.evalCode(`let foo = id({}); foo === id(foo)`)).toBe(true);
    });
  });

  it("returns the same VM object when a host function returns the same object twice", async () => {
    await withArena({ isMarshalable: true }, arena => {
      const shared = { k: 1 };
      arena.expose({ get: () => shared });
      expect(arena.evalCode(`get() === get()`)).toBe(true);
    });
  });

  it("keeps identity across retained references", async () => {
    await withArena({ isMarshalable: true }, arena => {
      const shared = { k: 1 };
      arena.expose({ get: () => shared });
      expect(arena.evalCode(`let a = get(); let b = get(); a === b`)).toBe(true);
    });
  });

  it("does not retain identity when sync is disabled", async () => {
    await withArena({ isMarshalable: true, syncEnabled: false }, arena => {
      const shared = { k: 1 };
      arena.expose({ get: () => shared });
      // With sync off, objects are not retained, so each marshal is independent.
      expect(arena.evalCode(`get() === get()`)).toBe(false);
    });
  });
});
