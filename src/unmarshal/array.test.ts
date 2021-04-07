import { getQuickJS } from "quickjs-emscripten";
import unmarshalArray from "./array";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const unmarshal = jest.fn(v => vm.dump(v));
  const preUnmarshal = jest.fn();

  const handle = vm.unwrapResult(vm.evalCode(`[1, true, {}]`));
  const array = unmarshalArray(vm, handle, unmarshal, preUnmarshal);
  expect(array).toEqual([1, true, {}]);
  expect(unmarshal.mock.results[0].value).toBe(1);
  expect(unmarshal.mock.results[1].value).toBe(true);
  expect(unmarshal.mock.results[2].value).toEqual({});
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
