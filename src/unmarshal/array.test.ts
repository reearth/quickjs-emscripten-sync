import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import unmarshalArray from "./array";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const unmarshal = jest.fn((v: QuickJSHandle): [unknown, boolean] => [
    vm.dump(v),
    false,
  ]);
  const preUnmarshal = jest.fn();

  const handle = vm.unwrapResult(vm.evalCode(`[1, true, {}]`));
  const array = unmarshalArray(vm, handle, unmarshal, preUnmarshal);
  expect(array).toEqual([1, true, {}]);
  expect(unmarshal.mock.results[0].value).toEqual([1, false]);
  expect(unmarshal.mock.results[1].value).toEqual([true, false]);
  expect(unmarshal.mock.results[2].value).toEqual([{}, false]);
  expect(preUnmarshal).toBeCalledWith(array, handle);

  handle.dispose();
  vm.dispose();
});

it("undefined", async () => {
  const vm = (await getQuickJS()).createVm();
  const f = jest.fn();

  expect(unmarshalArray(vm, vm.undefined, f, f)).toEqual(undefined);
  expect(unmarshalArray(vm, vm.true, f, f)).toEqual(undefined);
  expect(unmarshalArray(vm, vm.false, f, f)).toEqual(undefined);
  expect(unmarshalArray(vm, vm.null, f, f)).toEqual(undefined);
  expect(unmarshalArray(vm, vm.newString("hoge"), f, f)).toEqual(undefined);
  expect(unmarshalArray(vm, vm.newNumber(-10), f, f)).toEqual(undefined);

  const obj = vm.newObject();
  expect(unmarshalArray(vm, obj, f, f)).toEqual(undefined);
  const func = vm.newFunction("", () => {});
  expect(unmarshalArray(vm, func, f, f)).toEqual(undefined);

  expect(f).toBeCalledTimes(0);

  obj.dispose();
  func.dispose();
  vm.dispose();
});
