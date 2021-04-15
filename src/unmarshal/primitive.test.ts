import { getQuickJS } from "quickjs-emscripten";
import unmarshalPrimitive from "./primitive";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();

  expect(unmarshalPrimitive(vm, vm.undefined)).toEqual([undefined, true]);
  expect(unmarshalPrimitive(vm, vm.true)).toEqual([true, true]);
  expect(unmarshalPrimitive(vm, vm.false)).toEqual([false, true]);
  expect(unmarshalPrimitive(vm, vm.null)).toEqual([null, true]);
  expect(unmarshalPrimitive(vm, vm.newString("hoge"))).toEqual(["hoge", true]);
  expect(unmarshalPrimitive(vm, vm.newNumber(-10))).toEqual([-10, true]);
  // expect(
  //   unmarshalPrimitive(vm, vm.unwrapResult(vm.evalCode(`BigInt(1)`)))
  // ).toEqual([BigInt(1), true]);

  const obj = vm.newObject();
  expect(unmarshalPrimitive(vm, obj)).toEqual([undefined, false]);
  const array = vm.newArray();
  expect(unmarshalPrimitive(vm, array)).toEqual([undefined, false]);
  const func = vm.newFunction("", () => {});
  expect(unmarshalPrimitive(vm, func)).toEqual([undefined, false]);

  obj.dispose();
  array.dispose();
  func.dispose();
  vm.dispose();
});
