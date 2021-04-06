import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import marshalArray from "./array";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const eqh = vm.unwrapResult(vm.evalCode(`Object.is`));
  const eq = (a: QuickJSHandle | undefined, b: QuickJSHandle) =>
    !!vm.dump(
      vm.unwrapResult(vm.callFunction(eqh, vm.undefined, a ?? vm.undefined, b))
    );

  const marshaler = jest.fn(v =>
    v === true ? vm.true : v === "a" ? vm.newString(v) : vm.null
  );
  const handle = marshalArray(vm, ["a", null, true], marshaler);
  if (!handle) throw new Error("handle is undefined");

  expect(vm.getNumber(vm.getProp(handle, "length"))).toBe(3);
  expect(eq(vm.getProp(handle, 0), vm.newString("a"))).toBe(true);
  expect(eq(vm.getProp(handle, 1), vm.null)).toBe(true);
  expect(eq(vm.getProp(handle, 2), vm.true)).toBe(true);
  expect(marshaler.mock.calls).toEqual([["a"], [null], [true]]);

  handle.dispose();
  eqh.dispose();
  vm.dispose();
});

it("undefined", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshaler = jest.fn();

  expect(marshalArray(vm, undefined, marshaler)).toBe(undefined);
  expect(marshalArray(vm, null, marshaler)).toBe(undefined);
  expect(marshalArray(vm, false, marshaler)).toBe(undefined);
  expect(marshalArray(vm, true, marshaler)).toBe(undefined);
  expect(marshalArray(vm, 1, marshaler)).toBe(undefined);
  expect(marshalArray(vm, () => {}, marshaler)).toBe(undefined);
  expect(marshalArray(vm, { a: 1 }, marshaler)).toBe(undefined);
  expect(marshaler).toBeCalledTimes(0);

  vm.dispose();
});
