import { getQuickJS } from "quickjs-emscripten";
import { Arena } from ".";

describe("evalCode", () => {
  test("simple object and function", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

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
      })`
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
    vm.dispose();
  });

  test("Math", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

    const VMMath = arena.evalCode(`Math`) as Math;
    expect(VMMath.floor(1.1)).toBe(1);

    arena.dispose();
    vm.dispose();
  });

  test("class", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

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
    vm.dispose();
  });

  test("obj", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

    const obj = arena.evalCode(`globalThis.AAA = { a: 1 }`);

    expect(obj).toEqual({ a: 1 });
    expect(arena.evalCode(`AAA.a`)).toBe(1);
    obj.a = 2;
    expect(obj).toEqual({ a: 2 });
    expect(arena.evalCode(`AAA.a`)).toBe(2);

    arena.dispose();
    vm.dispose();
  });
});

describe("expose without sync", () => {
  test("simple object and function", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

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
    vm.dispose();
  });

  test("Math", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

    arena.expose({ Math2: Math });
    expect(arena.evalCode(`Math`)).not.toBe(Math);
    expect(arena.evalCode(`Math2`)).toBe(Math);
    expect(arena.evalCode(`Math2.floor(1.1)`)).toBe(1);

    arena.dispose();
    vm.dispose();
  });

  test("class", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

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
    vm.dispose();
  });

  test("object and function", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

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
    vm.dispose();
  });
});

describe("expose with sync", () => {
  test("sync before expose", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

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
    vm.dispose();
  });

  test("sync after expose", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: true });

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
    vm.dispose();
  });
});

test("evalCode -> expose", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm, { isMarshalable: true });

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
  vm.dispose();
});

test("expose -> evalCode", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm, { isMarshalable: true });

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
  vm.dispose();
});

test("evalCode -> expose -> evalCode", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm, { isMarshalable: true });

  const obj = [1];
  expect(arena.evalCode("a => a[0] + 10")(obj)).toBe(11);
  arena.expose({ obj });
  expect(arena.evalCode("obj")).toBe(obj);

  arena.dispose();
  vm.dispose();
});

test("register and unregister", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm, { isMarshalable: true, registeredObjects: [] });

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
  vm.dispose();
});

test("registeredObjects option", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm, {
    isMarshalable: true,
    registeredObjects: [[Symbol.iterator, "Symbol.iterator"]],
  });

  expect(arena.evalCode(`Symbol.iterator`)).toBe(Symbol.iterator);
  expect(arena.evalCode(`s => s === Symbol.iterator`)(Symbol.iterator)).toBe(
    true
  );

  arena.dispose();
  vm.dispose();
});

describe("isMarshalable option", () => {
  test("false", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: false });

    expect(arena.evalCode(`s => s === undefined`)(globalThis)).toBe(true);
    expect(arena.evalCode(`s => s === undefined`)({})).toBe(true);
    arena.expose({ aaa: globalThis });
    expect(arena.evalCode(`aaa`)).toBeUndefined();

    arena.dispose();
    vm.dispose();
  });

  test("json", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, { isMarshalable: "json" });

    const obj = { a: () => {}, b: new Date(), c: [() => {}, 1] };
    const objJSON = { b: obj.b.toISOString(), c: [null, 1] };
    const objJSON2 = arena.evalCode(`a => a`)(obj);
    expect(objJSON2).toStrictEqual(objJSON);
    arena.expose({ obj });
    const exposedObj = arena.evalCode(`obj`);
    expect(exposedObj).toStrictEqual(objJSON);
    expect(exposedObj).not.toBe(objJSON2);

    arena.dispose();
    vm.dispose();
  });

  test("conditional", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm, {
      isMarshalable: (o) => o !== globalThis,
    });

    const obj = { a: 1 };
    expect(arena.evalCode(`s => s === undefined`)(globalThis)).toBe(true);
    expect(arena.evalCode(`s => s === undefined`)(obj)).toBe(false);
    arena.expose({ aaa: globalThis, bbb: obj });
    expect(arena.evalCode(`aaa`)).toBeUndefined();
    expect(arena.evalCode(`bbb`)).toBe(obj);

    arena.dispose();
    vm.dispose();
  });
});
