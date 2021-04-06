import { getQuickJS } from "quickjs-emscripten";
import functions from "./functions";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();

  const [funcs, dispose] = functions(vm, {
    add: `(a, b) => a + b`,
    substract: `(a, b) => a - b`,
    thisarg: `(function() { return this === globalThis; })`,
  });

  const a = vm.newNumber(10);
  const b = vm.newNumber(1);

  expect(vm.getNumber(funcs.add(undefined, a, b))).toBe(11);
  expect(vm.getNumber(funcs.substract(undefined, a, b))).toBe(9);
  expect(vm.dump(funcs.thisarg(a))).toBe(false);
  expect(vm.dump(funcs.thisarg(vm.global))).toBe(true);

  dispose();
  expect(() => vm.getNumber(funcs.add(undefined, a, b))).toThrow(
    "Lifetime not alive"
  );
  expect(() => vm.getNumber(funcs.substract(undefined, a, b))).toThrow(
    "Lifetime not alive"
  );
  expect(() => vm.getNumber(funcs.thisarg(a))).toThrow("Lifetime not alive");

  a.dispose();
  b.dispose();
  vm.dispose();
});
