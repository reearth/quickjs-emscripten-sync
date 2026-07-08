import { getQuickJS, newAsyncContext } from "quickjs-emscripten";
import { describe, expect, test, vi } from "vitest";

import { isWrapped } from "./wrapper";

import { Arena, AsyncArena } from ".";

describe("readme", () => {
  test("first", async () => {
    class Cls {
      field = 0;

      method() {
        return ++this.field;
      }
    }

    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // We can pass objects to the VM and run code safely
    const exposed = {
      Cls,
      cls: new Cls(),
      syncedCls: arena.sync(new Cls()),
    };
    arena.expose(exposed);

    expect(arena.evalCode(`cls instanceof Cls`)).toBe(true);
    expect(arena.evalCode(`cls.field`)).toBe(0);
    expect(arena.evalCode(`cls.method()`)).toBe(1);
    expect(arena.evalCode(`cls.field`)).toBe(1);

    expect(arena.evalCode(`syncedCls.field`)).toBe(0);
    expect(exposed.syncedCls.method()).toBe(1);
    expect(arena.evalCode(`syncedCls.field`)).toBe(1);

    arena.dispose();
    ctx.dispose();
  });

  test("usage", async () => {
    const quickjs = await getQuickJS();
    const ctx = quickjs.newContext();

    // init Arena
    // ⚠️ Marshaling is opt-in for security reasons.
    // ⚠️ Be careful when activating marshalling.
    const arena = new Arena(ctx, { isMarshalable: true });

    // expose objects as global objects in QuickJS VM
    const log = vi.fn();
    arena.expose({
      console: { log },
    });
    arena.evalCode(`console.log("hello, world");`); // run console.log
    expect(log).toBeCalledWith("hello, world");
    arena.evalCode(`1 + 1`); // 2

    // expose objects but also enable sync
    const data = arena.sync({ hoge: "foo" });
    arena.expose({ data });

    arena.evalCode(`data.hoge = "bar"`);
    // eval code and operations to exposed objects are automatically synced
    expect(data.hoge).toBe("bar");
    data.hoge = "changed!";
    expect(arena.evalCode(`data.hoge`)).toBe("changed!");

    // Don't forget calling arena.dispose() before disposing QuickJS VM!
    arena.dispose();
    ctx.dispose();
  });
});

describe("class constructors (#92)", () => {
  test("new on an exposed class inside the VM", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    class Cls {
      hoge = "";

      constructor() {
        this.hoge = "foo";
      }
    }
    arena.expose({ Cls });

    const instance = arena.evalCode(`new Cls()`) as { hoge: string };
    expect(instance.hoge).toBe("foo");
    expect(arena.evalCode(`new Cls() instanceof Cls`)).toBe(true);

    arena.dispose();
    ctx.dispose();
  });

  test("constructor arguments reach the host", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    class Cls {
      value: number;

      constructor(a: number, b: number) {
        this.value = a + b;
      }
    }
    arena.expose({ Cls });

    const instance = arena.evalCode(`new Cls(2, 3)`) as { value: number };
    expect(instance.value).toBe(5);

    arena.dispose();
    ctx.dispose();
  });

  test("new on a synced class inside the VM", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    class Cls {
      hoge = "";

      constructor(v = "foo") {
        this.hoge = v;
      }
    }
    arena.expose({ Cls: arena.sync(Cls) });

    const instance = arena.evalCode(`new Cls("bar")`) as { hoge: string };
    expect(instance.hoge).toBe("bar");
    expect(arena.evalCode(`new Cls() instanceof Cls`)).toBe(true);

    arena.dispose();
    ctx.dispose();
  });
});

describe("evalCode", () => {
  test("simple object and function", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const result = arena.evalCode(
      `({
        a: 1,
        b: a => Math.floor(a),
        c: () => { throw new Error("hoge") },
        d: (yourFavoriteNumber) => ({
          myFavoriteNumber: 42,
          yourFavoriteNumber,
        }),
        get e() {
          return { a: 1 };
        }
      })`,
    );
    expect(result).toEqual({
      a: 1,
      b: expect.any(Function),
      c: expect.any(Function),
      d: expect.any(Function),
      e: { a: 1 },
    });
    expect(result.b(1.1)).toBe(1);
    expect(() => result.c()).toThrow("hoge");
    expect(result.d(1)).toStrictEqual({
      myFavoriteNumber: 42,
      yourFavoriteNumber: 1,
    });
    expect(result.e).toStrictEqual({ a: 1 });

    arena.dispose();
    ctx.dispose();
  });

  test("Math", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const VMMath = arena.evalCode(`Math`) as Math;
    expect(VMMath.floor(1.1)).toBe(1);

    arena.dispose();
    ctx.dispose();
  });

  test("Date", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const date = new Date(2022, 7, 26);
    expect(arena.evalCode("new Date(2022, 7, 26)")).toEqual(date);
    expect(arena.evalCode("d => d instanceof Date")(date)).toBe(true);
    expect(arena.evalCode("d => d.getTime()")(date)).toBe(date.getTime());

    arena.dispose();
    ctx.dispose();
  });

  test("class", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const instance = arena.evalCode(`{
      globalThis.Cls = class D {
        constructor(a) {
          this.a = a + 1;
        }
        foo() {
          return ++this.a;
        }
      };

      new Cls(100);
    }`);
    const Cls = arena.evalCode(`globalThis.Cls`);
    expect(instance instanceof Cls).toBe(true);
    expect(instance.a).toBe(101);
    expect(instance.foo()).toBe(102);
    expect(instance.a).toBe(102);

    arena.dispose();
    ctx.dispose();
  });

  test("obj", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const obj = arena.evalCode(`globalThis.AAA = { a: 1 }`);

    expect(obj).toEqual({ a: 1 });
    expect(arena.evalCode(`AAA.a`)).toBe(1);
    obj.a = 2;
    expect(obj).toEqual({ a: 2 });
    expect(arena.evalCode(`AAA.a`)).toBe(2);

    arena.dispose();
    ctx.dispose();
  });

  test("promise", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const [promise, resolve] = arena.evalCode<[Promise<string>, (d: string) => void]>(`
      let resolve;
      const promise = new Promise(r => {
        resolve = r;
      }).then(d => d + "!");
      [promise, resolve]
    `);
    expect(promise).instanceOf(Promise);
    expect(isWrapped(arena._unwrapIfNotSynced(promise), arena._symbol)).toBe(false);

    resolve("hoge");
    expect(arena.executePendingJobs()).toBe(2);
    expect(await promise).toBe("hoge!");

    arena.dispose();
    ctx.dispose();
  });

  test("promise2", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const deferred: { resolve?: (s: string) => void } = {};
    const promise = new Promise(resolve => {
      deferred.resolve = resolve;
    });
    const res = vi.fn();
    arena.evalCode(`(p, r) => { p.then(d => { r(d + "!"); }); }`)(promise, res);

    deferred.resolve?.("hoge");
    await promise;
    expect(arena.executePendingJobs()).toBe(1);
    expect(res).toBeCalledWith("hoge!");

    arena.dispose();
    ctx.dispose();
  });

  test("async function", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const consolelog = vi.fn();
    arena.expose({
      console: {
        log: consolelog,
      },
    });

    arena.evalCode(`
      const someAsyncOperation = async () => "hello";
      const execute = async () => {
        try {
          const res = await someAsyncOperation();
          console.log(res);
        } catch (e) {
          console.log(e);
        }
      };
      execute();
    `);
    expect(consolelog).toBeCalledTimes(0);
    expect(arena.executePendingJobs()).toBe(2);

    arena.executePendingJobs();

    expect(consolelog).toBeCalledTimes(1);
    expect(consolelog).toBeCalledWith("hello");
    expect(arena.executePendingJobs()).toBe(0);

    arena.dispose();
    ctx.dispose();
  });

  test("options are forwarded (strict mode)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Assigning to an undeclared variable succeeds in sloppy mode...
    expect(arena.evalCode("x = 1")).toBe(1);
    // ...but throws a ReferenceError in strict mode.
    expect(() => arena.evalCode("y = 1", undefined, { strict: true })).toThrow(ReferenceError);

    arena.dispose();
    ctx.dispose();
  });

  test("filename appears in error stacks", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    try {
      arena.evalCode(`throw new Error("boom")`, "my-special-file.js");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe("boom");
      expect((e as Error).stack).toContain("my-special-file.js");
    }

    arena.dispose();
    ctx.dispose();
  });
});

describe("expose without sync", () => {
  test("simple object and function", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const obj = {
      a: 1,
      b: (a: number) => Math.floor(a),
      c: () => {
        throw new Error("hoge");
      },
      d: (yourFavoriteNumber: number) => ({
        myFavoriteNumber: 42,
        yourFavoriteNumber,
      }),
      get e() {
        return { a: 1 };
      },
    };
    arena.expose({
      obj,
    });

    expect(arena.evalCode(`obj`)).toBe(obj);
    expect(arena.evalCode(`obj.a`)).toBe(1);
    expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
    expect(() => arena.evalCode(`obj.c()`)).toThrow("hoge");
    expect(arena.evalCode(`obj.d(1)`)).toStrictEqual({
      myFavoriteNumber: 42,
      yourFavoriteNumber: 1,
    });
    expect(arena.evalCode(`obj.e`)).toStrictEqual({ a: 1 });

    arena.dispose();
    ctx.dispose();
  });

  test("Math", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    arena.expose({ Math2: Math });
    expect(arena.evalCode(`Math`)).not.toBe(Math);
    expect(arena.evalCode(`Math2`)).toBe(Math);
    expect(arena.evalCode(`Math2.floor(1.1)`)).toBe(1);

    arena.dispose();
    ctx.dispose();
  });

  test("class", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    class D {
      a: number;

      constructor(a: number) {
        this.a = a + 1;
      }

      foo() {
        return ++this.a;
      }
    }

    const d = new D(100);
    arena.expose({ D, d });
    expect(arena.evalCode(`D`)).toBe(D);
    expect(arena.evalCode(`d`)).toBe(d);
    expect(arena.evalCode(`d instanceof D`)).toBe(true);
    expect(arena.evalCode(`d.a`)).toBe(101);
    expect(arena.evalCode(`d.foo()`)).toBe(102);
    expect(arena.evalCode(`d.a`)).toBe(102);

    arena.dispose();
    ctx.dispose();
  });

  test("object and function", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const obj = {
      a: 1,
      b: (a: number) => Math.floor(a),
      c() {
        return this.a++;
      },
    };
    arena.expose({ obj });

    expect(arena.evalCode(`obj`)).toBe(obj);
    expect(arena.evalCode(`obj.a`)).toBe(1);
    expect(arena.evalCode(`obj.b`)).toBe(obj.b);
    expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
    expect(arena.evalCode(`obj.c`)).toBe(obj.c);
    expect(arena.evalCode(`obj.c()`)).toBe(1);
    expect(arena.evalCode(`obj.a`)).toBe(2);
    expect(obj.a).toBe(2);
    expect(arena.evalCode(`obj.c()`)).toBe(2);
    expect(arena.evalCode(`obj.a`)).toBe(3);
    expect(obj.a).toBe(3);

    obj.a = 10;
    expect(obj.a).toBe(10);
    expect(arena.evalCode(`obj.a`)).toBe(3); // not affected

    arena.evalCode(`obj.a = 100`);
    expect(obj.a).toBe(10); // not affected
    expect(arena.evalCode(`obj.a`)).toBe(100);

    arena.dispose();
    ctx.dispose();
  });
});

describe("expose with sync", () => {
  test("sync before expose", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const obj = {
      a: 1,
      b: (a: number) => Math.floor(a),
      c() {
        return this.a++;
      },
    };
    const obj2 = arena.sync(obj);
    arena.expose({ obj: obj2 });

    const obj3 = arena.evalCode(`obj`);
    expect(obj3).toBe(obj2);
    expect(arena.evalCode(`obj.c`)).not.toBe(obj.c); // wrapped object
    expect(arena.evalCode(`obj.b`)).not.toBe(obj2.b); // wrapped object
    expect(arena.evalCode(`obj.b`)).not.toBe(obj3.b); // wrapped object
    expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
    expect(arena.evalCode(`obj.a`)).toBe(1);
    expect(arena.evalCode(`obj.c`)).not.toBe(obj.c); // wrapped object
    expect(arena.evalCode(`obj.c`)).not.toBe(obj2.c); // wrapped object
    expect(arena.evalCode(`obj.c`)).not.toBe(obj3.c); // wrapped object
    expect(arena.evalCode(`obj.c()`)).toBe(1);
    expect(arena.evalCode(`obj.a`)).toBe(2);
    expect(obj.a).toBe(2);
    expect(arena.evalCode(`obj.c()`)).toBe(2);
    expect(arena.evalCode(`obj.a`)).toBe(3);
    expect(obj.a).toBe(3);

    expect(obj).not.toBe(obj2);
    obj2.a = 10;
    expect(obj.a).toBe(10);
    expect(arena.evalCode(`obj.a`)).toBe(10); // affected

    arena.evalCode(`obj.a = 100`);
    expect(obj.a).toBe(100); // affected
    expect(arena.evalCode(`obj.a`)).toBe(100);

    arena.dispose();
    ctx.dispose();
  });

  test("sync after expose", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const obj = {
      a: 1,
      b: (a: number) => Math.floor(a),
      c() {
        return this.a++;
      },
    };
    arena.expose({ obj });
    const obj2 = arena.sync(obj);

    const obj3 = arena.evalCode(`obj`);
    expect(obj3).not.toBe(obj); // wrapped object
    expect(obj3).not.toBe(obj2); // wrapped object
    expect(arena.evalCode(`obj.c`)).not.toBe(obj.c); // wrapped object
    expect(arena.evalCode(`obj.b`)).not.toBe(obj2.b); // wrapped object
    expect(arena.evalCode(`obj.b`)).not.toBe(obj3.b); // wrapped object
    expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
    expect(arena.evalCode(`obj.a`)).toBe(1);
    expect(arena.evalCode(`obj.c`)).not.toBe(obj.c); // wrapped object
    expect(arena.evalCode(`obj.c`)).not.toBe(obj2.c); // wrapped object
    expect(arena.evalCode(`obj.c`)).not.toBe(obj3.c); // wrapped object
    expect(arena.evalCode(`obj.c()`)).toBe(1);
    expect(arena.evalCode(`obj.a`)).toBe(2);
    expect(obj.a).toBe(2);
    expect(arena.evalCode(`obj.c()`)).toBe(2);
    expect(arena.evalCode(`obj.a`)).toBe(3);
    expect(obj.a).toBe(3);

    expect(obj).not.toBe(obj2);
    obj2.a = 10;
    expect(obj.a).toBe(10);
    expect(arena.evalCode(`obj.a`)).toBe(10); // affected

    arena.evalCode(`obj.a = 100`);
    expect(obj.a).toBe(100); // affected
    expect(arena.evalCode(`obj.a`)).toBe(100);

    arena.dispose();
    ctx.dispose();
  });
});

test("evalCode -> expose", async () => {
  const ctx = (await getQuickJS()).newContext();
  const arena = new Arena(ctx, { isMarshalable: true });

  const obj = arena.evalCode(`({ a: 1, b: 1 })`);
  arena.expose({ obj });

  expect(obj).toBe(obj);
  expect(obj.a).toBe(1);
  expect(arena.evalCode(`obj.a`)).toBe(1);
  expect(obj.b).toBe(1);
  expect(arena.evalCode(`obj.b`)).toBe(1);

  obj.a = 2;

  expect(obj.a).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(2);
  expect(obj.b).toBe(1);
  expect(arena.evalCode(`obj.b`)).toBe(1);

  expect(arena.evalCode(`obj.b = 2`)).toBe(2);

  expect(obj.a).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(2);
  expect(obj.b).toBe(2);
  expect(arena.evalCode(`obj.b`)).toBe(2);

  arena.dispose();
  ctx.dispose();
});

test("expose -> evalCode", async () => {
  const ctx = (await getQuickJS()).newContext();
  const arena = new Arena(ctx, { isMarshalable: true });

  const obj = { a: 1 };
  arena.expose({ obj });
  const obj2 = arena.evalCode(`obj`);

  expect(obj2).toBe(obj);

  obj2.a = 2;
  expect(obj.a).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(1);

  arena.evalCode("obj.a = 3");
  expect(obj.a).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(3);

  arena.dispose();
  ctx.dispose();
});

test("evalCode -> expose -> evalCode", async () => {
  const ctx = (await getQuickJS()).newContext();
  const arena = new Arena(ctx, { isMarshalable: true });

  const obj = [1];
  expect(arena.evalCode("a => a[0] + 10")(obj)).toBe(11);
  arena.expose({ obj });
  expect(arena.evalCode("obj")).toBe(obj);

  arena.dispose();
  ctx.dispose();
});

test("register and unregister", async () => {
  const ctx = (await getQuickJS()).newContext();
  const arena = new Arena(ctx, { isMarshalable: true, registeredObjects: [] });

  arena.register(Math, `Math`);
  expect(arena.evalCode(`Math`)).toBe(Math);
  expect(arena.evalCode(`m => m === Math`)(Math)).toBe(true);

  arena.unregister(Math);
  expect(arena.evalCode(`Math`)).not.toBe(Math);
  expect(arena.evalCode(`m => m === Math`)(Math)).toBe(false);

  arena.register(Error, `Error`);
  arena.register(Error.prototype, `Error.prototype`);
  expect(arena.evalCode(`new Error()`)).toBeInstanceOf(Error);

  arena.dispose();
  ctx.dispose();
});

test("plain call passes `this` as undefined, method call passes the receiver", async () => {
  const ctx = (await getQuickJS()).newContext();
  const arena = new Arena(ctx, { isMarshalable: true });

  arena.expose({
    whoAmI() {
      return this;
    },
  });

  // A plain call would see `this === globalThis` in plain JS; the VM global is
  // intentionally not marshalled to the host, so `this` is undefined here.
  expect(arena.evalCode(`whoAmI()`)).toBe(undefined);
  // A method call still receives its receiver.
  expect(arena.evalCode(`const o = { v: 42, whoAmI }; o.whoAmI().v`)).toBe(42);

  arena.dispose();
  ctx.dispose();
});

test("registeredObjects option", async () => {
  const ctx = (await getQuickJS()).newContext();
  const arena = new Arena(ctx, {
    isMarshalable: true,
    registeredObjects: [[Symbol.iterator, "Symbol.iterator"]],
  });

  expect(arena.evalCode(`Symbol.iterator`)).toBe(Symbol.iterator);
  expect(arena.evalCode(`s => s === Symbol.iterator`)(Symbol.iterator)).toBe(true);

  arena.dispose();
  ctx.dispose();
});

describe("isMarshalable option", () => {
  test("false", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: false });

    expect(arena.evalCode(`s => s === undefined`)(globalThis)).toBe(true);
    expect(arena.evalCode(`s => s === undefined`)({})).toBe(true);
    arena.expose({ aaa: globalThis });
    expect(arena.evalCode(`aaa`)).toBeUndefined();

    arena.dispose();
    ctx.dispose();
  });

  test("json", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: "json" });

    const obj = { a: () => {}, b: new Date(), c: [() => {}, 1] };
    const objJSON = { b: obj.b.toISOString(), c: [null, 1] };
    const objJSON2 = arena.evalCode(`a => a`)(obj);
    expect(objJSON2).toStrictEqual(objJSON);
    arena.expose({ obj });
    const exposedObj = arena.evalCode(`obj`);
    expect(exposedObj).toStrictEqual(objJSON);
    expect(exposedObj).not.toBe(objJSON2);

    arena.dispose();
    ctx.dispose();
  });

  test("conditional", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, {
      isMarshalable: o => o !== globalThis,
    });

    const obj = { a: 1 };
    expect(arena.evalCode(`s => s === undefined`)(globalThis)).toBe(true);
    expect(arena.evalCode(`s => s === undefined`)(obj)).toBe(false);
    arena.expose({ aaa: globalThis, bbb: obj });
    expect(arena.evalCode(`aaa`)).toBeUndefined();
    expect(arena.evalCode(`bbb`)).toBe(obj);

    arena.dispose();
    ctx.dispose();
  });
});

describe("evalModule", () => {
  test("module can modify exposed globals", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const data = arena.sync({ count: 0, message: "" });
    arena.expose({ data });

    // Module code can have side effects on exposed globals
    arena.evalModule(`
      data.count = 42;
      data.message = "Hello from module";
    `);

    expect(data.count).toBe(42);
    expect(data.message).toBe("Hello from module");

    arena.dispose();
    ctx.dispose();
  });

  test("module with function side effects", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const results: number[] = [];
    arena.expose({
      results,
      push: (value: number) => results.push(value),
    });

    arena.evalModule(`
      push(1);
      push(2);
      push(3);
    `);

    expect(results).toEqual([1, 2, 3]);

    arena.dispose();
    ctx.dispose();
  });

  test("module can define and use internal exports", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const output = arena.sync({ value: 0 });
    arena.expose({ output });

    // Module can export and use its own exports internally
    arena.evalModule(`
      export function double(x) {
        return x * 2;
      }

      export const value = 21;

      // Use the exports internally
      output.value = double(value);
    `);

    expect(output.value).toBe(42);

    arena.dispose();
    ctx.dispose();
  });

  test("module with custom filename", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const state = arena.sync({ executed: false });
    arena.expose({ state });

    // Test that custom filename doesn't break functionality
    arena.evalModule(`state.executed = true;`, "custom-module.js");

    expect(state.executed).toBe(true);

    arena.dispose();
    ctx.dispose();
  });

  test("module with strict mode", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const result = arena.sync({ ok: false });
    arena.expose({ result });

    // Modules are strict by default
    arena.evalModule(`
      // This would fail in strict mode if we tried: undeclaredVariable = 1;
      result.ok = true;
    `);

    expect(result.ok).toBe(true);

    arena.dispose();
    ctx.dispose();
  });

  test("module returns exported values (0.29+)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const exports = arena.evalModule(`
      export const value = 42;
      export const message = "Hello";
      export const obj = { a: 1, b: 2 };
    `);

    expect(exports.value).toBe(42);
    expect(exports.message).toBe("Hello");
    expect(exports.obj).toEqual({ a: 1, b: 2 });

    arena.dispose();
    ctx.dispose();
  });

  test("module returns exported functions (0.29+)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const exports = arena.evalModule(`
      export function greet(name) {
        return "Hello, " + name;
      }
      export function add(a, b) {
        return a + b;
      }
    `);

    expect(exports.greet("World")).toBe("Hello, World");
    expect(exports.add(2, 3)).toBe(5);

    arena.dispose();
    ctx.dispose();
  });

  test("module with default export (0.29+)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const exports = arena.evalModule(`
      export default function(x) {
        return x * 2;
      }
    `);

    expect(exports.default(21)).toBe(42);

    arena.dispose();
    ctx.dispose();
  });

  test("module with class export (0.29+)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Export objects and static methods from a class
    const exports = arena.evalModule(`
      export class Counter {
        static create(initial = 0) {
          return { count: initial };
        }
        static increment(obj) {
          return ++obj.count;
        }
      }
    `);

    // Static methods can be called from the host
    const counter = exports.Counter.create(10);
    expect(counter.count).toBe(10);
    expect(exports.Counter.increment(counter)).toBe(11);
    expect(counter.count).toBe(11);

    arena.dispose();
    ctx.dispose();
  });

  test("module with top-level await (0.29+)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const exportsPromise = arena.evalModule(`
      export const data = await Promise.resolve(123);
      export const message = "loaded";
    `);

    expect(exportsPromise).toBeInstanceOf(Promise);

    arena.executePendingJobs();

    const exports = await exportsPromise;
    expect(exports.data).toBe(123);
    expect(exports.message).toBe("loaded");

    arena.dispose();
    ctx.dispose();
  });

  test("user options are merged and type is forced to module", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // `strict` is passed through, and a user-supplied `type` is overridden with
    // "module" so `export` still works and the exports are returned.
    const exports = arena.evalModule(
      `
      export const value = 42;
      export function greet(name) {
        return "Hi, " + name;
      }
    `,
      "with-options.js",
      { strict: true, type: "global" },
    );

    expect(exports.value).toBe(42);
    expect(exports.greet("World")).toBe("Hi, World");

    arena.dispose();
    ctx.dispose();
  });
});

describe("memory management", () => {
  test("getMemoryUsage returns statistics", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const stats = arena.getMemoryUsage();

    // Check that key properties exist
    expect(stats).toHaveProperty("memory_used_size");
    expect(stats).toHaveProperty("malloc_limit");
    expect(stats).toHaveProperty("obj_count");
    expect(stats).toHaveProperty("malloc_count");

    // Memory should be used
    expect(stats.memory_used_size).toBeGreaterThan(0);
    expect(stats.malloc_count).toBeGreaterThan(0);

    arena.dispose();
    ctx.dispose();
  });

  test("getMemoryUsage tracks allocations", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const before = arena.getMemoryUsage();

    // Allocate some objects
    arena.evalCode(`
      const arr = [];
      for (let i = 0; i < 100; i++) {
        arr.push({ id: i, data: "test".repeat(10) });
      }
    `);

    const after = arena.getMemoryUsage();

    // Memory usage should increase
    expect(after.memory_used_size).toBeGreaterThan(before.memory_used_size);
    expect(after.obj_count).toBeGreaterThan(before.obj_count);

    arena.dispose();
    ctx.dispose();
  });

  test("dumpMemoryUsage returns formatted string", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const dump = arena.dumpMemoryUsage();

    // Should be a non-empty string
    expect(typeof dump).toBe("string");
    expect(dump.length).toBeGreaterThan(0);

    // Should contain key memory metrics (the format varies)
    expect(dump).toMatch(/memory|malloc/i);

    arena.dispose();
    ctx.dispose();
  });

  test("setMemoryLimit enforces memory constraints", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Set a low memory limit (100KB)
    arena.setMemoryLimit(100 * 1024);

    // Verify limit is set
    const stats = arena.getMemoryUsage();
    expect(stats.malloc_limit).toBe(100 * 1024);

    // Try to allocate too much memory
    expect(() => {
      arena.evalCode(`
        const huge = [];
        for (let i = 0; i < 1000000; i++) {
          huge.push({ data: "x".repeat(1000) });
        }
      `);
    }).toThrow();

    arena.dispose();
    ctx.dispose();
  });

  test("setMemoryLimit can be removed with -1", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Set a limit
    arena.setMemoryLimit(100 * 1024);
    expect(arena.getMemoryUsage().malloc_limit).toBe(100 * 1024);

    // Remove the limit
    arena.setMemoryLimit(-1);
    const stats = arena.getMemoryUsage();
    expect(stats.malloc_limit).toBeGreaterThan(100 * 1024);

    arena.dispose();
    ctx.dispose();
  });

  test("setMaxStackSize prevents stack overflow", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Set a small stack size (256KB)
    arena.setMaxStackSize(256 * 1024);

    // Try to cause stack overflow with deep recursion
    expect(() => {
      arena.evalCode(`
        function recurse(n) {
          if (n > 0) return recurse(n - 1);
          return n;
        }
        recurse(100000);
      `);
    }).toThrow();

    arena.dispose();
    ctx.dispose();
  });

  test("setMaxStackSize can be removed with 0", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Set a very small stack
    arena.setMaxStackSize(128 * 1024);

    // This should fail with small stack
    expect(() => {
      arena.evalCode(`
        function recurse(n) {
          if (n > 0) return recurse(n - 1);
          return n;
        }
        recurse(10000);
      `);
    }).toThrow();

    // Remove the limit
    arena.setMaxStackSize(0);

    // Now it should work (or at least get further)
    const result = arena.evalCode(`
      function recurse(n) {
        if (n > 0) return recurse(n - 1);
        return n;
      }
      recurse(1000);
    `);

    expect(result).toBe(0);

    arena.dispose();
    ctx.dispose();
  });

  test("memory limits work with marshaling", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Set limit
    arena.setMemoryLimit(200 * 1024);

    const data = arena.sync({ items: [] as any[] });
    arena.expose({ data });

    // Should be able to add reasonable data
    arena.evalCode(`
      for (let i = 0; i < 10; i++) {
        data.items.push({ id: i });
      }
    `);

    expect(data.items.length).toBe(10);

    // But not unlimited data. The allocation happens in a local (non-synced)
    // structure on purpose: a hard out-of-memory hit while mutating a synced
    // global mid-flight leaves the VM unrecoverable, so it would not be safe to
    // keep using or cleanly dispose afterwards.
    expect(() => {
      arena.evalCode(`
        const huge = [];
        for (let i = 0; i < 1000000; i++) {
          huge.push({ id: i, data: "x".repeat(1000) });
        }
      `);
    }).toThrow();

    arena.dispose();
    ctx.dispose();
  });

  test("setInterruptHandler interrupts infinite loops", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Interrupt after the handler has been called a number of times.
    let calls = 0;
    arena.setInterruptHandler(() => ++calls > 1000);

    expect(() => {
      arena.evalCode(`while (true) {}`);
    }).toThrow();
    expect(calls).toBeGreaterThan(1000);

    // After removing the handler, normal evaluation works again.
    arena.removeInterruptHandler();
    expect(arena.evalCode(`1 + 2`)).toBe(3);

    arena.dispose();
    ctx.dispose();
  });
});

describe("intrinsics configuration", () => {
  test("intrinsics can be configured when creating context", async () => {
    const quickjs = await getQuickJS();
    const runtime = quickjs.newRuntime();

    // Example: disable eval for sandboxing
    const ctx = runtime.newContext({ intrinsics: { Eval: false } });
    const arena = new Arena(ctx, { isMarshalable: true });

    // This test demonstrates that intrinsics are configured at context creation
    // The actual restrictions would be enforced by quickjs-emscripten
    expect(arena).toBeDefined();
    expect(arena.context).toBeDefined();

    arena.dispose();
    ctx.dispose();
    runtime.dispose();
  });
});

describe("syncEnabled", () => {
  const objCount = (ctx: any) => {
    const h = ctx.runtime.computeMemoryUsage();
    const c = ctx.dump(h).obj_count as number;
    h.dispose();
    return c;
  };

  const growth = async (syncEnabled: boolean) => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true, registeredObjects: [], syncEnabled });

    arena.expose({ fnFromHost: () => ({ id: "x", data: Math.random() }) });
    arena.evalCode(`globalThis.run = () => { for (let i = 0; i < 200; i++) fnFromHost(); }`);

    arena.evalCode(`run()`);
    const before = objCount(ctx);
    arena.evalCode(`run()`);
    const after = objCount(ctx);

    arena.dispose();
    ctx.dispose();
    return after - before;
  };

  test("syncEnabled: false does not retain marshalled objects", async () => {
    // returned objects are not retained, so repeated runs don't grow memory
    expect(await growth(false)).toBeLessThan(50);
  });

  test("syncEnabled: true retains marshalled objects (default)", async () => {
    // with sync on, every returned object is kept for identity, so memory grows
    expect(await growth(true)).toBeGreaterThan(150);
  });
});

describe("AsyncArena", () => {
  test("evalCodeAsync returns values", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true });

    expect(await arena.evalCodeAsync(`1 + 2`)).toBe(3);
    expect(await arena.evalCodeAsync(`({ a: 1, b: [2, 3] })`)).toEqual({ a: 1, b: [2, 3] });

    arena.dispose();
    ctx.dispose();
  });

  test("evalCodeAsync re-throws errors", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true });

    await expect(arena.evalCodeAsync(`throw new Error("boom")`)).rejects.toThrow("boom");

    arena.dispose();
    ctx.dispose();
  });
});

describe("asyncify (#32)", () => {
  test("without the option an async fn yields a Promise in the guest", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true });

    arena.expose({ f: async () => "result" });
    expect(await arena.evalCodeAsync(`typeof f()`)).toBe("object");

    arena.dispose();
    ctx.dispose();
  });

  test("asyncify: true resolves the value synchronously in the guest", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true, asyncify: true });

    arena.expose({
      f: async () => {
        await new Promise(r => setTimeout(r, 1));
        return "result";
      },
      g: async () => ({ a: 1, b: [2, 3] }),
    });

    expect(await arena.evalCodeAsync(`typeof f()`)).toBe("string");
    expect(await arena.evalCodeAsync(`f()`)).toBe("result");
    expect(await arena.evalCodeAsync(`const o = g(); [typeof o, o.a, o.b[1]]`)).toEqual([
      "object",
      1,
      3,
    ]);

    arena.dispose();
    ctx.dispose();
  });

  test("asyncify: true passes arguments through", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true, asyncify: true });

    arena.expose({ add: async (a: number, b: number) => a + b });
    expect(await arena.evalCodeAsync(`add(2, 3)`)).toBe(5);

    arena.dispose();
    ctx.dispose();
  });

  test("predicate form only asyncifies matching functions", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, {
      isMarshalable: true,
      asyncify: target => (target as any).asyncified === true,
    });

    const yes = async () => "sync-value";
    (yes as any).asyncified = true;
    const no = async () => "promise-value";

    arena.expose({ yes, no });

    expect(await arena.evalCodeAsync(`typeof yes()`)).toBe("string");
    expect(await arena.evalCodeAsync(`yes()`)).toBe("sync-value");
    expect(await arena.evalCodeAsync(`typeof no()`)).toBe("object");

    arena.dispose();
    ctx.dispose();
  });

  test("a rejecting asyncified fn surfaces as a catchable VM error", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true, asyncify: true });

    arena.expose({
      boom: async () => {
        throw new Error("kaboom");
      },
    });

    // Uncaught in the guest: the error propagates back to the host.
    await expect(arena.evalCodeAsync(`boom()`)).rejects.toThrow("kaboom");

    // Caught in the guest: the guest can handle it synchronously.
    expect(
      await arena.evalCodeAsync(`
        try {
          boom();
          "no-throw";
        } catch (e) {
          "caught:" + e.message;
        }
      `),
    ).toBe("caught:kaboom");

    arena.dispose();
    ctx.dispose();
  });

  test("sequential asyncified calls in one evalCodeAsync work", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true, asyncify: true });

    arena.expose({
      first: async () => 10,
      second: async (n: number) => n + 5,
    });

    expect(await arena.evalCodeAsync(`const a = first(); const b = second(a); a + b`)).toBe(25);

    arena.dispose();
    ctx.dispose();
  });

  test("calling an asyncified fn during synchronous evalCode fails", async () => {
    const ctx = await newAsyncContext();
    const arena = new AsyncArena(ctx, { isMarshalable: true, asyncify: true });

    arena.expose({ f: async () => "result" });

    // Asyncify can only suspend through an async entry point; a synchronous
    // evalCode cannot unwind the stack, so it throws.
    expect(() => arena.evalCode(`f()`)).toThrow("Function unexpectedly returned a Promise");

    arena.dispose();
    ctx.dispose();
  });

  test("sync context fallback: asyncify does not break, async fn behaves as today", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true, asyncify: true });

    arena.expose({ f: async () => "result" });
    // No newAsyncifiedFunction on a plain context: falls back to Promise marshalling.
    expect(arena.evalCode(`globalThis.__p = f(); typeof __p`)).toBe("object");
    // Let the host promise settle into the VM promise before disposing, so the
    // marshalled resolution does not touch a disposed context.
    await new Promise(r => setTimeout(r));
    arena.executePendingJobs();

    arena.dispose();
    ctx.dispose();
  });
});

describe("Symbol.dispose", () => {
  test("using disposes the arena", async () => {
    const ctx = (await getQuickJS()).newContext();
    {
      using arena = new Arena(ctx, { isMarshalable: true });
      expect(arena.evalCode(`1 + 1`)).toBe(2);
    }
    // arena is disposed here; the context can still be disposed cleanly
    ctx.dispose();
  });
});

describe("defineProperty sync", () => {
  test("host -> VM", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });
    const data = arena.sync<any>({});
    arena.expose({ data });

    Object.defineProperty(data, "x", { value: 42, enumerable: true, configurable: true });
    expect(arena.evalCode(`data.x`)).toBe(42);

    arena.dispose();
    ctx.dispose();
  });

  test("VM -> host", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });
    const data = arena.sync<any>({});
    arena.expose({ data });

    arena.evalCode(
      `Object.defineProperty(data, "y", { value: 7, enumerable: true, configurable: true })`,
    );
    expect(data.y).toBe(7);

    arena.dispose();
    ctx.dispose();
  });

  test("syncs accessor descriptors host -> VM", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });
    const data = arena.sync<any>({});
    arena.expose({ data });

    Object.defineProperty(data, "g", { get: () => 99, enumerable: true, configurable: true });
    expect(arena.evalCode(`data.g`)).toBe(99);

    arena.dispose();
    ctx.dispose();
  });
});

describe("marshalByReference", () => {
  test("passes objects through the VM by reference (identity preserved)", async () => {
    const ctx = (await getQuickJS()).newContext();
    const secret = {
      hidden: 42,
      method() {
        return this.hidden;
      },
    };
    const arena = new Arena(ctx, {
      isMarshalable: true,
      marshalByReference: t => t === secret,
    });

    arena.expose({
      getSecret: () => secret,
      useSecret: (s: typeof secret) => s.method(),
    });

    // VM receives the opaque ref and passes it back; host resolves the original
    expect(arena.evalCode(`useSecret(getSecret())`)).toBe(42);

    // host -> VM -> host keeps identity
    const echo = arena.evalCode<(x: typeof secret) => typeof secret>(`x => x`);
    expect(echo(secret)).toBe(secret);

    // the guest cannot read into the opaque ref
    expect(
      arena.evalCode(`(() => { try { return getSecret().hidden; } catch { return "threw"; } })()`),
    ).not.toBe(42);

    arena.dispose();
    ctx.dispose();
  });

  test("resolves host refs nested in objects", async () => {
    const ctx = (await getQuickJS()).newContext();
    const secret = { token: "abc" };
    const arena = new Arena(ctx, {
      isMarshalable: true,
      marshalByReference: t => t === secret,
    });

    arena.expose({ wrap: () => ({ inner: secret, label: "x" }) });
    const out = arena.evalCode(`wrap()`);
    expect(out.label).toBe("x");
    expect(out.inner).toBe(secret);

    arena.dispose();
    ctx.dispose();
  });
});

describe("BigInt", () => {
  test("roundtrip", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    expect(arena.evalCode(`123n`)).toBe(123n);
    expect(arena.evalCode(`2n ** 64n`)).toBe(2n ** 64n);

    const double = arena.evalCode<(x: bigint) => bigint>(`x => x * 2n`);
    expect(double(21n)).toBe(42n);
    expect(double(9007199254740993n)).toBe(18014398509481986n);

    arena.dispose();
    ctx.dispose();
  });
});

describe("ArrayBuffer and TypedArray", () => {
  test("roundtrip", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const fromVM = arena.evalCode(`new Uint8Array([1, 2, 3, 250])`);
    expect(fromVM).toBeInstanceOf(Uint8Array);
    expect(Array.from(fromVM)).toEqual([1, 2, 3, 250]);

    const buf = arena.evalCode(`new ArrayBuffer(4)`);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(4);

    const echo = arena.evalCode<(x: Uint8Array) => Uint8Array>(`x => x`);
    const back = echo(new Uint8Array([9, 8, 7]));
    expect(back).toBeInstanceOf(Uint8Array);
    expect(Array.from(back)).toEqual([9, 8, 7]);

    const sum = arena.evalCode<(a: Float64Array) => number>(
      `a => a.reduce((x, y) => x + y, 0)`,
    );
    expect(sum(new Float64Array([1.5, 2.5, 3]))).toBe(7);

    arena.dispose();
    ctx.dispose();
  });
});

describe("Map and Set", () => {
  test("roundtrip", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    const map = arena.evalCode(`new Map([["a", 1], ["b", { n: 2 }]])`);
    expect(map).toBeInstanceOf(Map);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toEqual({ n: 2 });

    const set = arena.evalCode(`new Set([1, 2, 3])`);
    expect(set).toBeInstanceOf(Set);
    expect([...set]).toEqual([1, 2, 3]);

    const mapSum = arena.evalCode<(m: Map<string, number>) => number>(
      `m => { let s = 0; for (const v of m.values()) s += v; return s; }`,
    );
    expect(mapSum(new Map([["x", 10], ["y", 20]]))).toBe(30);

    const echo = arena.evalCode<(s: Set<string>) => Set<string>>(`s => s`);
    const back = echo(new Set(["p", "q"]));
    expect(back).toBeInstanceOf(Set);
    expect([...back]).toEqual(["p", "q"]);

    arena.dispose();
    ctx.dispose();
  });
});
