import { getQuickJS } from "quickjs-emscripten";
import Arena from ".";

it("evalCode", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm);

  const result = arena.evalCode(`({ a: 1, b: a => Math.floor(a) })`);
  expect(result).toEqual({ a: 1, b: expect.any(Function) });
  expect(result.b(1.1)).toBe(1);

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
  expect(obj.a).toBe(1); // not affected
  expect(arena.evalCode(`obj.c()`)).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(3);
  expect(obj.a).toBe(1); // not affected
  expect(arena.evalCode(`obj.c()`)).toBe(3);
  expect(arena.evalCode(`obj.a`)).toBe(4);
  expect(obj.a).toBe(1); // not affected

  expect(obj).not.toBe(obj2.obj);
  obj2.obj.a = 10;
  expect(arena.evalCode(`obj.a`)).toBe(4); // not affected

  arena.evalCode(`obj.a = 100`);
  expect(obj.a).toBe(1); // not affected
  expect(obj2.obj.a).toBe(1); // not affected

  arena.dispose();
  vm.dispose();
});

it("expose with sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const arena = new Arena(vm);

  const obj = {
    a: 1,
    b: (a: number) => Math.floor(a),
    c() {
      return this.a++;
    },
  };
  const obj2 = arena.expose({ obj }, true);

  expect(arena.evalCode(`obj.b(1.1)`)).toBe(1);
  expect(arena.evalCode(`obj.c()`)).toBe(1);
  expect(arena.evalCode(`obj.a`)).toBe(2);
  expect(obj.a).toBe(2); // affected
  expect(arena.evalCode(`obj.c()`)).toBe(2);
  expect(arena.evalCode(`obj.a`)).toBe(3);
  expect(obj.a).toBe(3); // affected
  expect(arena.evalCode(`obj.c()`)).toBe(3);
  expect(arena.evalCode(`obj.a`)).toBe(4);
  expect(obj.a).toBe(4); // affected

  expect(obj).not.toBe(obj2.obj);
  obj2.obj.a = 10;
  expect(arena.evalCode(`obj.a`)).toBe(10); // affected

  arena.evalCode(`obj.a = 100`);
  expect(obj.a).toBe(100); // affected
  expect(obj2.obj.a).toBe(100); // affected

  arena.dispose();
  vm.dispose();
});
