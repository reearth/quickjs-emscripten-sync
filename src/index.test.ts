import { getQuickJS } from "quickjs-emscripten";
import Arena from ".";

it("evalCode", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm);

  const result = arena.evalCode(`({ a: 1, b: a => Math.floor(a) })`);
  expect(result).toEqual({ a: 1, b: expect.any(Function) });
  expect(result.b(1.1)).toBe(1);

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

it("evalCode with sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm);

  const obj = arena.evalCode(`globalThis.AAA = { a: 1 }`, true);

  expect(obj).toEqual({ a: 1 });
  expect(arena.evalCode(`AAA.a`)).toBe(1);
  obj.a = 2;
  expect(obj).toEqual({ a: 2 });
  expect(arena.evalCode(`AAA.a`)).toBe(2);

  arena.dispose();
  vm.dispose();
});

it("expose", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm);

  const obj = {
    a: 1,
    b: (a: number) => Math.floor(a),
    c() {
      return this.a++;
    },
  };
  const obj2 = arena.expose({ obj });

  expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
  expect(arena.evalCode(`obj.c()`)).toBe(1);
  expect(arena.evalCode(`obj.a`)).toBe(2);
  expect(obj.a).toBe(2); // affected
  expect(arena.evalCode(`obj.c()`)).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(3);
  expect(obj.a).toBe(3); // affected

  expect(obj).toBe(obj2.obj);
  obj.a = 10;
  expect(obj.a).toBe(10);
  expect(arena.evalCode(`obj.a`)).toBe(3); // not affected

  arena.evalCode(`obj.a = 100`);
  expect(obj.a).toBe(10); // not affected
  expect(arena.evalCode(`obj.a`)).toBe(100);

  arena.dispose();
  vm.dispose();
});
