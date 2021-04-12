import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import marshalArray from "./array";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const eqh = vm.unwrapResult(vm.evalCode(`Object.is`));
  const eq = (a: QuickJSHandle | undefined, b: QuickJSHandle) =>
    !!vm.dump(
      vm.unwrapResult(vm.callFunction(eqh, vm.undefined, a ?? vm.undefined, b))
    );

  const marshal = jest.fn(v =>
    v === true ? vm.true : v === "a" ? vm.newString(v) : vm.null
  );
  const preMarshal = jest.fn((_, a) => a);
  const target = ["a", null, true];
  const handle = marshalArray(vm, target, marshal, preMarshal);
  if (!handle) throw new Error("handle is undefined");

  expect(vm.getNumber(vm.getProp(handle, "length"))).toBe(3);
  expect(eq(vm.getProp(handle, 0), vm.newString("a"))).toBe(true);
  expect(eq(vm.getProp(handle, 1), vm.null)).toBe(true);
  expect(eq(vm.getProp(handle, 2), vm.true)).toBe(true);
  expect(marshal.mock.calls).toEqual([["a"], [null], [true]]);
  expect(preMarshal.mock.calls).toEqual([[target, handle]]);

  handle.dispose();
  eqh.dispose();
  vm.dispose();
});

it("undefined", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = jest.fn();
  const preMarshal = jest.fn((_, a) => a);

  expect(marshalArray(vm, undefined, marshal, preMarshal)).toBe(undefined);
  expect(marshalArray(vm, null, marshal, preMarshal)).toBe(undefined);
  expect(marshalArray(vm, false, marshal, preMarshal)).toBe(undefined);
  expect(marshalArray(vm, true, marshal, preMarshal)).toBe(undefined);
  expect(marshalArray(vm, 1, marshal, preMarshal)).toBe(undefined);
  expect(marshalArray(vm, () => {}, marshal, preMarshal)).toBe(undefined);
  expect(marshalArray(vm, { a: 1 }, marshal, preMarshal)).toBe(undefined);
  expect(marshal).toBeCalledTimes(0);

  vm.dispose();
});
