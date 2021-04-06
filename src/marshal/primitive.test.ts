import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import marshalPrimitive from "./primitive";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const eqh = vm.unwrapResult(vm.evalCode(`Object.is`));
  const eq = (a: QuickJSHandle | undefined, b: QuickJSHandle) =>
    !!vm.dump(
      vm.unwrapResult(vm.callFunction(eqh, vm.undefined, a ?? vm.undefined, b))
    );

  expect(marshalPrimitive(vm, undefined)).toBe(vm.undefined);
  expect(marshalPrimitive(vm, null)).toBe(vm.null);
  expect(marshalPrimitive(vm, false)).toBe(vm.false);
  expect(marshalPrimitive(vm, true)).toBe(vm.true);
  expect(eq(marshalPrimitive(vm, 1), vm.newNumber(1))).toBe(true);
  expect(eq(marshalPrimitive(vm, -100), vm.newNumber(-100))).toBe(true);
  expect(eq(marshalPrimitive(vm, "hoge"), vm.newString("hoge"))).toBe(true);

  expect(marshalPrimitive(vm, () => {})).toBe(undefined);
  expect(marshalPrimitive(vm, [])).toBe(undefined);
  expect(marshalPrimitive(vm, {})).toBe(undefined);

  eqh.dispose();
  vm.dispose();
});
