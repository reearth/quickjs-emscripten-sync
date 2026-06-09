import { getQuickJS } from "quickjs-emscripten";
import { describe, expect, test } from "vitest";

import { Arena } from ".";

// tests for edge cases

describe("edge cases", () => {
  // this test takes more than about 20s
  test("getter", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const called: string[] = [];
    const obj = { c: 0 };
    const exposed = {
      get a() {
        called.push("a");
        return {
          get b() {
            called.push("b");
            return obj;
          },
        };
      },
    };
    const cb: { current?: () => any } = {};
    const register = (fn: () => any) => {
      cb.current = fn;
    };

    arena.expose({ exposed, register });
    expect(called).toEqual([]);

    arena.evalCode(`register(() => exposed.a.b.c);`);
    expect(cb.current?.()).toBe(0);
    expect(called).toEqual(["a", "b"]);

    // The host getters are still traversed on every access, so `called` grows.
    // But `obj` keeps its identity across marshals (sync is on), so the VM holds
    // the value snapshot from the first marshal: a later host-side mutation is
    // not re-marshalled. Use `arena.sync(obj)` to propagate host writes (see the
    // "getter (synced)" test below).
    obj.c = 1;
    expect(cb.current?.()).toBe(0);
    expect(called).toEqual(["a", "b", "a", "b"]);

    arena.dispose();
    // Re-marshalling `obj` used to leak a handle, which aborted ctx.dispose().
    // Now that the stale-entry handle is disposed, the context disposes cleanly.
    expect(() => ctx.dispose()).not.toThrow();
  });

  // this test takes more than about 20s
  test("getter (synced)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // A synced object propagates host-side writes to the VM, so re-reads see the
    // updated value while still keeping a stable identity.
    const obj = arena.sync({ c: 0 });
    const exposed = {
      get a() {
        return {
          get b() {
            return obj;
          },
        };
      },
    };
    const cb: { current?: () => any } = {};
    arena.expose({
      exposed,
      register: (fn: () => any) => {
        cb.current = fn;
      },
    });

    arena.evalCode(`register(() => exposed.a.b.c);`);
    expect(cb.current?.()).toBe(0);

    obj.c = 1;
    expect(cb.current?.()).toBe(1);

    arena.dispose();
    expect(() => ctx.dispose()).not.toThrow();
  });

  test(
    "many newFunction",
    async () => {
      const rt = (await getQuickJS()).newRuntime();
      const ctx = rt.newContext();
      const arena = new Arena(ctx, {
        isMarshalable: true,
        // enable this option to solve this problem
        experimentalContextEx: true,
      });

      arena.expose({
        hoge: () => {},
      });
      // should have an object as an arg
      const fn = arena.evalCode(`() => { hoge([]); }`);
      // error happens from 3926 times
      for (let i = 0; i < 10000; i++) {
        fn();
      }

      arena.dispose();
      ctx.dispose();
      rt.dispose();
    },
    90000,
  );
});
