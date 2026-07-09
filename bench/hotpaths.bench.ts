// Hot-path benchmarks. Run: npm run bench
//
// Baseline (quickjs-emscripten 0.32.0, before perf work; ops/s, machine-specific):
//   A. eval+unmarshal object (20 items)  ~206 ops/s   <- dominated by call() re-compiling per op
//   B. expose/marshal nested object      ~230k ops/s
//   C. host fn called from VM (x500)     leaks handles after ~300 evalCodes (known issue)
//   D. sync writes from VM (x200)        ~57 ops/s    <- dominated by call() re-compiling per op
//   E. re-marshal same object            ~418k ops/s
//   F. call unmarshalled VM fn           ~206k ops/s
//
// Arenas are intentionally NOT disposed here. Under quickjs-emscripten >= 0.32
// the release-sync variant asserts that the runtime's GC object list is empty
// at dispose; some hot paths still leak handles across many iterations, which
// would abort the whole run. The process exits right after benchmarking, so
// skipping dispose keeps the numbers comparable without that noise.
import { getQuickJS  } from "quickjs-emscripten";
import type {QuickJSContext} from "quickjs-emscripten";
import { bench, describe, beforeAll } from "vitest";

import { Arena } from "../src/index";

function makeNested(depth: number, breadth: number): Record<string, any> {
  if (depth <= 0) return { a: 1, b: "x", c: true };
  const o: Record<string, any> = {};
  for (let i = 0; i < breadth; i++) o["k" + i] = makeNested(depth - 1, breadth);
  return o;
}

async function newArena(): Promise<Arena> {
  const ctx: QuickJSContext = (await getQuickJS()).newContext();
  return new Arena(ctx, { isMarshalable: true });
}

describe("eval + unmarshal", () => {
  let arena: Arena;
  beforeAll(async () => {
    arena = await newArena();
  });
  const code = `({ items: Array.from({length: 20}, (_, i) => ({ id: i, name: "item" + i, ok: i % 2 === 0 })) })`;
  bench(
    "A. eval+unmarshal object (20 items)",
    () => {
      const r = arena.evalCode(code);
      void r.items.length;
    },
    { iterations: 300, warmupIterations: 20, time: 0 },
  );
});

describe("marshal", () => {
  let arena: Arena;
  const data = makeNested(3, 4);
  let i = 0;
  beforeAll(async () => {
    arena = await newArena();
  });
  bench(
    "B. expose/marshal nested object",
    () => {
      arena.expose({ ["d" + (i++ & 1023)]: data });
    },
    { iterations: 2000, warmupIterations: 100, time: 0 },
  );
});

describe("host fn called from VM", () => {
  let arena: Arena;
  beforeAll(async () => {
    arena = await newArena();
    let sum = 0;
    arena.expose({ add: (a: number, b: number) => (sum += a + b) });
  });
  bench(
    "C. host fn called from VM (x500)",
    () => {
      arena.evalCode(`for (let i = 0; i < 500; i++) add(i, 1);`);
    },
    { iterations: 100, warmupIterations: 10, time: 0 },
  );
});

describe("sync writes", () => {
  let arena: Arena;
  beforeAll(async () => {
    arena = await newArena();
    const synced = arena.sync({ items: [] as number[] });
    arena.expose({ data: synced });
  });
  bench(
    "D. sync writes from VM (x200)",
    () => {
      arena.evalCode(`for (let i = 0; i < 200; i++) data.items[i] = i;`);
    },
    { iterations: 200, warmupIterations: 10, time: 0 },
  );
});

describe("re-marshal cached object", () => {
  let arena: Arena;
  const data = makeNested(2, 4);
  beforeAll(async () => {
    arena = await newArena();
    arena.expose({ base: data });
  });
  bench(
    "E. re-marshal same object",
    () => {
      arena.expose({ base: data });
    },
    { iterations: 10000, warmupIterations: 200, time: 0 },
  );
});

describe("call unmarshalled VM fn", () => {
  let arena: Arena;
  let f: (a: number, b: number) => number;
  let i = 0;
  beforeAll(async () => {
    arena = await newArena();
    f = arena.evalCode(`(a, b) => a + b`);
  });
  bench(
    "F. call unmarshalled VM fn",
    () => {
      void f(i++, 1);
    },
    { iterations: 10000, warmupIterations: 200, time: 0 },
  );
});
