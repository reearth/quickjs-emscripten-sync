import variant from "@jitl/quickjs-wasmfile-debug-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten";
import { describe, expect, test } from "vitest";

import { Arena } from ".";

// Deterministic fault-injection harness for issue #88.
//
// When a hard abort (memory limit or interrupt) lands *mid-flight* in the deep
// sync/marshal/unmarshal chain, a host-held QuickJS handle can be orphaned. The
// debug-sync runtime aborts on `ctx.dispose()` (a C-level `RuntimeError`) if any
// GC object handle leaked (`Assertion failed: list_empty(&rt->gc_obj_list) ... at
// JS_FreeRuntime`). That abort IS the detector: a scenario is run under an
// injected fault, then `arena.dispose()` + `ctx.dispose()` must NOT throw. A
// throw means a handle was orphaned.
//
// We deliberately use the debug-sync variant (not `getQuickJS()`): only the debug
// build asserts the GC object list is empty at `JS_FreeRuntime`, and that
// assertion is what surfaces the leak. This mirrors the sibling leak tests
// (jsonleak/remarshalleak).
//
// Two injection mechanisms:
//
// A. Memory-limit sweep — `arena.setMemoryLimit(limit)` makes any VM allocation
//    (`ctx.new*` / `callFunction`) fail once the working set crosses `limit`, so
//    the abort lands at an allocation deep in the host-driven marshal/unmarshal
//    chain. Swept over a fixed byte range that brackets each scenario's working
//    set. The step (320) is chosen to match the range used while developing the
//    fix: a *finer* step occasionally lands the OOM on an exact byte that trips a
//    pre-existing quickjs-emscripten hang (an OOM inside its GC that never
//    returns control — unrelated to handle leaks, and unfixable host-side). The
//    step here is verified hang-free for these payloads, and, because the WASM is
//    deterministic, that holds in CI too.
//
// B. Interrupt sweep — `arena.setInterruptHandler` fires only during VM bytecode
//    execution, so it cannot land in the *host-side* marshal code that the
//    memory sweep targets (a direct `expose`/`evalCode` never invokes the
//    handler — its VM work is below the interrupt-check interval). To exercise
//    the boundary under interrupts we drive it from *inside* a VM loop: a synced
//    mutation loop and a host-function round-trip loop repeatedly cross into the
//    marshal/unmarshal chain, and the interrupt can trip inside a nested VM
//    `call` there. A counter-based handler interrupts on its Nth invocation; N is
//    swept until a run completes uninterrupted.

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  dist() {
    return Math.hypot(this.x, this.y);
  }
}

// A payload that crosses every marshal path: primitives, arrays, Date & Symbol
// (custom), a function, a class instance (custom prototype + method), Map & Set
// (mapset), and nesting.
const richHost = () => ({
  n: 42,
  s: "hi",
  arr: [1, 2, 3],
  d: new Date(0),
  sym: Symbol("k"),
  fn: (a: number, b: number) => a + b,
  pt: new Point(3, 4),
  m: new Map<string, number>([
    ["a", 1],
    ["b", 2],
  ]),
  set: new Set<number>([7, 8, 9]),
  nested: { a: { b: [{ c: 1 }] } },
});

const scenarios: Record<string, (arena: Arena) => void> = {
  // 1. Mutating a synced object from the VM (the known-bad case from the issue):
  //    the abort is swept through the sync -> marshal -> setter chain.
  syncedMutation: arena => {
    const s: any = arena.sync({ a: { b: 1 } });
    arena.expose({ s });
    arena.evalCode(`s.a.b = { deep: [1, 2, 3] }`);
  },
  // 2. Marshal chain: expose a nested object/function mix.
  marshal: arena => {
    arena.expose({ obj: richHost() });
    arena.evalCode(`obj.pt.x + obj.arr[1] + obj.m.get("a") + obj.set.size`);
  },
  // 3. Unmarshal chain: evaluate a deep object literal with functions/arrays. It
  //    deliberately avoids holding BOTH a Map and a Set in one unmarshalled
  //    literal, which trips the pre-existing quickjs OOM hang described above;
  //    the mapset *marshal* path is covered by scenarios 2 and 4 instead.
  unmarshal: arena => {
    arena.evalCode(
      `({ n: 1, s: "x", arr: [1, 2, { z: 3 }], d: new Date(0), fn: a => a * 2, nested: { a: { b: { c: [4, 5] } } }, sym: Symbol("q") })`,
    );
  },
  // 4. Round-trip: an exposed host function called from the VM with an object
  //    argument (unmarshal) and an object return (marshal, incl. Date/Symbol/Set).
  roundTrip: arena => {
    arena.expose({
      host: (o: any) => ({
        sum: o.a + o.b,
        when: new Date(0),
        tag: Symbol("r"),
        items: [o.a, o.b],
        pt: new Point(o.a, o.b),
        tags: new Set([o.a]),
      }),
    });
    arena.evalCode(`host({ a: 1, b: 2 }).sum`);
  },
};

async function newModule(): Promise<QuickJSWASMModule> {
  return newQuickJSWASMModuleFromVariant(variant as any);
}

function newArena(mod: QuickJSWASMModule) {
  const ctx = mod.newContext();
  return { ctx, arena: new Arena(ctx, { isMarshalable: true }) };
}

// Dispose the arena then the context; report whether the C-level GC assertion
// aborted (which surfaces as a thrown RuntimeError). A leaked handle => true.
function disposeAborted(arena: Arena, ctx: ReturnType<QuickJSWASMModule["newContext"]>): boolean {
  try {
    arena.dispose();
    ctx.dispose();
    return false;
  } catch {
    return true;
  }
}

// Sweep the memory limit across [lo, hi]; return the limits at which dispose
// aborted plus how many runs failed vs. succeeded (to confirm the range brackets
// the scenario's working set). A recreated module isolates any abort so the
// sweep can enumerate every offending limit.
async function memoryLimitSweep(run: (arena: Arena) => void) {
  const lo = 8000;
  const hi = 14000;
  const step = 320;
  let mod = await newModule();
  const reds: number[] = [];
  let failed = 0;
  let succeeded = 0;
  for (let limit = lo; limit <= hi; limit += step) {
    const { ctx, arena } = newArena(mod);
    let threw = false;
    arena.setMemoryLimit(limit);
    try {
      run(arena);
    } catch {
      threw = true;
    }
    // Reset before teardown so disposal (which allocates, e.g. to clear the map)
    // is not itself starved by the limit.
    arena.setMemoryLimit(-1);
    if (threw) failed++;
    else succeeded++;
    if (disposeAborted(arena, ctx)) {
      reds.push(limit);
      mod = await newModule();
    }
  }
  return { reds, failed, succeeded };
}

// Sweep the interrupt threshold N = 1, 2, ... until a run completes without the
// handler firing N times (i.e. the whole loop ran with fewer than N interrupt
// checks), which means every interruptible depth has been covered.
async function interruptSweep(setup: (arena: Arena) => void, body: string, cap = 100) {
  let mod = await newModule();
  const reds: number[] = [];
  let fullCount = -1;
  for (let n = 1; n <= cap; n++) {
    const { ctx, arena } = newArena(mod);
    setup(arena);
    let count = 0;
    arena.setInterruptHandler(() => ++count === n);
    try {
      arena.evalCode(body);
    } catch {
      // any thrown Error is acceptable
    }
    arena.removeInterruptHandler();
    if (disposeAborted(arena, ctx)) {
      reds.push(n);
      mod = await newModule();
    }
    if (count < n) {
      // The run finished before the handler reached N: all depths swept.
      fullCount = count;
      break;
    }
  }
  return { reds, fullCount, capHit: fullCount < 0 };
}

describe("fault injection: memory-limit sweep leaves no orphaned handle", () => {
  for (const [name, run] of Object.entries(scenarios)) {
    test(
      `${name}`,
      async () => {
        const { reds, failed, succeeded } = await memoryLimitSweep(run);
        // The range must bracket the working set (some limits fail mid-flight,
        // some succeed) or the sweep would not be injecting faults at all.
        expect(failed, `scenario "${name}": no memory limit forced a mid-flight failure`).toBeGreaterThan(0);
        expect(succeeded, `scenario "${name}": no memory limit let the run complete`).toBeGreaterThan(0);
        expect(
          reds,
          `scenario "${name}": ctx.dispose() aborted (a GC handle leaked) at memory limit(s) ${reds.join(", ")}`,
        ).toEqual([]);
      },
      30000,
    );
  }
});

describe("fault injection: interrupt sweep leaves no orphaned handle", () => {
  // Loop-driven forms so the VM interrupt actually lands in the marshal/unmarshal
  // chain (see header). Each asserts the interrupt genuinely fired (fullCount > 0)
  // and that no swept threshold orphaned a handle.
  test(
    "synced mutation loop",
    async () => {
      const { reds, fullCount, capHit } = await interruptSweep(
        arena => {
          const s: any = arena.sync({ a: { b: 0 } });
          arena.expose({ s });
        },
        `for (let i = 0; i < 100; i++) { s.a.b = { deep: [i, i + 1], when: new Date(i) }; }`,
      );
      expect(capHit, "interrupt handler never stopped firing; raise the cap").toBe(false);
      expect(fullCount, "interrupt never fired; the scenario does not exercise mechanism B").toBeGreaterThan(0);
      expect(reds, `dispose aborted (a GC handle leaked) at interrupt threshold(s) ${reds.join(", ")}`).toEqual([]);
    },
    30000,
  );

  test(
    "host round-trip loop",
    async () => {
      const { reds, fullCount, capHit } = await interruptSweep(
        arena => {
          arena.expose({
            host: (o: any) => ({
              sum: o.a + o.b,
              when: new Date(0),
              tag: Symbol("r"),
              items: [o.a, o.b],
              pt: new Point(o.a, o.b),
            }),
          });
        },
        `let acc = 0; for (let i = 0; i < 150; i++) { acc += host({ a: i, b: 1 }).sum; } acc`,
      );
      expect(capHit, "interrupt handler never stopped firing; raise the cap").toBe(false);
      expect(fullCount, "interrupt never fired; the scenario does not exercise mechanism B").toBeGreaterThan(0);
      expect(reds, `dispose aborted (a GC handle leaked) at interrupt threshold(s) ${reds.join(", ")}`).toEqual([]);
    },
    30000,
  );
});
