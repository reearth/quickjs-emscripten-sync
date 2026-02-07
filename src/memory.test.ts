import { getQuickJS } from "quickjs-emscripten";
import { describe, expect, test } from "vitest";

import { Arena } from ".";

describe("memory", () => {
  test("memory leak", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, {
      isMarshalable: true,
      registeredObjects: [],
      syncEnabled: false,
    });

    const getMemory = () => {
      const handle = ctx.runtime.computeMemoryUsage();
      const mem = ctx.dump(handle);
      handle.dispose();
      return mem;
    };

    arena.expose({
      fnFromHost: () => {
        return {
          id: "some id",
          data: Math.random(),
        };
      },
    });

    arena.evalCode(`globalThis.test = {
      check: () => {
        return fnFromHost();
      }
    }`);

    const memoryBefore = getMemory().memory_used_size as number;
    const data = arena.evalCode("globalThis.test.check()");
    expect(data).not.toBeNull();

    for (let i = 0; i < 100; i++) {
      const data = arena.evalCode("globalThis.test.check()");
      expect(data).not.toBeNull();
    }

    const memoryAfter = getMemory().memory_used_size as number;

    console.log("Allocation increased %d", memoryAfter - memoryBefore);
    expect((memoryAfter - memoryBefore) / 1024).toBe(0);

    arena.dispose();
    ctx.dispose();
  });

  test("memory leak promise", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, {
      isMarshalable: true,
      registeredObjects: [],
      syncEnabled: false,
    });

    const getMemory = () => {
      const handle = ctx.runtime.computeMemoryUsage();
      const mem = ctx.dump(handle);
      handle.dispose();
      return mem;
    };

    arena.expose({
      fnFromHost: () => {
        return {
          id: "some id",
          data: Math.random(),
        };
      },
    });

    arena.evalCode(`globalThis.test = {
      check: async () => {
        const hostData = await fnFromHost();
        return hostData;
      }
    }`);

    const memoryBefore = getMemory().memory_used_size as number;

    const promise = arena.evalCode<Promise<any>>("globalThis.test.check()");
    arena.executePendingJobs();
    const data = await promise;
    expect(data).not.toBeNull();

    for (let i = 0; i < 100; i++) {
      const promise = arena.evalCode<Promise<any>>("globalThis.test.check()");
      arena.executePendingJobs();
      const data = await promise;
      expect(data).not.toBeNull();
    }

    const memoryAfter = getMemory().memory_used_size as number;

    console.log("Allocation increased %d", memoryAfter - memoryBefore);
    expect((memoryAfter - memoryBefore) / 1024).toBe(0);

    arena.dispose();
    ctx.dispose();
  });
});
