import { getQuickJS } from "quickjs-emscripten";
import Arena from ".";

describe("evalCode", () => {
  test("simple object and function", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm);

    const result = arena.evalCode(
      `({ a: 1, b: a => Math.floor(a), c: () => { throw new Error("hoge") } })`
    );
    expect(result).toEqual({
      a: 1,
      b: expect.any(Function),
      c: expect.any(Function),
    });
    expect(result.b(1.1)).toBe(1);
    expect(() => result.c()).toThrow("hoge");

    arena.dispose();
    vm.dispose();
  });

  test("Math", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm);

    const VMMath = arena.evalCode(`Math`) as Math;
    expect(VMMath.floor(1.1)).toBe(1);

    arena.dispose();
    vm.dispose();
  });

  test("class", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm);

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
    const arena = new Arena(vm);

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
    const arena = new Arena(vm);

    arena.expose({
      obj: {
        a: 1,
        b: (a: number) => Math.floor(a),
        c: () => {
          throw new Error("hoge");
        },
      },
    });

    expect(arena.evalCode(`obj.a`)).toBe(1);
    expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
    expect(() => arena.evalCode(`obj.c()`)).toThrow("hoge");

    arena.dispose();
    vm.dispose();
  });

  test("Math", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm);

    arena.expose({ Math });
    expect(arena.evalCode(`Math.floor(1.1)`)).toBe(1);

    arena.dispose();
    vm.dispose();
  });

  test("class", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm);

    class D {
      a: number;

      constructor(a: number) {
        this.a = a + 1;
      }

      foo() {
        return ++this.a;
      }
    }

    arena.expose({ D, d: new D(100) });
    expect(arena.evalCode(`d instanceof D`)).toBe(true);
    expect(arena.evalCode(`d.a`)).toBe(101);
    expect(arena.evalCode(`d.foo()`)).toBe(102);
    expect(arena.evalCode(`d.a`)).toBe(102);

    arena.dispose();
    vm.dispose();
  });

  test("object and function", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm);

    const obj = {
      a: 1,
      b: (a: number) => Math.floor(a),
      c() {
        return this.a++;
      },
    };
    arena.expose({ obj });

    expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
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
  test("object and function", async () => {
    const vm = (await getQuickJS()).createVm();
    const arena = new Arena(vm);

    const obj = {
      a: 1,
      b: (a: number) => Math.floor(a),
      c() {
        return this.a++;
      },
    };
    const obj2 = arena.sync(obj);
    arena.expose({ obj: obj2 });

    expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
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
  const arena = new Arena(vm);

  const obj = arena.evalCode(`({ a: 1, b: 1 })`);
  arena.expose({ obj });

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
  const arena = new Arena(vm);

  const obj = { a: 1 };
  const obj2 = arena.sync(obj);
  arena.expose({ obj: obj2 });
  const obj3 = arena.evalCode(`obj`);

  expect(obj3).toBe(obj2);

  obj3.a = 2;
  expect(obj.a).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(2);

  arena.evalCode("obj.a = 4");
  expect(obj.a).toBe(4);
  expect(arena.evalCode(`obj.a`)).toBe(4);

  arena.dispose();
  vm.dispose();
});

test("register and unregister", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm, { registeredObjects: [] });

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
    registeredObjects: [[Symbol.iterator, "Symbol.iterator"]],
  });

  expect(arena.evalCode(`Symbol.iterator`)).toBe(Symbol.iterator);
  expect(arena.evalCode(`s => s === Symbol.iterator`)(Symbol.iterator)).toBe(
    true
  );

  arena.dispose();
  vm.dispose();
});

test("isMarshalable option", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm, {
    isMarshalable: o => o !== globalThis,
  });

  expect(arena.evalCode(`s => s === undefined`)(globalThis)).toBe(true);

  arena.dispose();
  vm.dispose();
});
