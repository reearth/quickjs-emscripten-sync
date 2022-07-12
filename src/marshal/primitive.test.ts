import { getQuickJS } from "quickjs-emscripten";
import { expect, test } from "vitest";

import { eq } from "../vmutil";
import marshalPrimitive from "./primitive";

test("works", async () => {
  const vm = (await getQuickJS()).createVm();

  expect(marshalPrimitive(vm, undefined)).toBe(vm.undefined);
  expect(marshalPrimitive(vm, null)).toBe(vm.null);
  expect(marshalPrimitive(vm, false)).toBe(vm.false);
  expect(marshalPrimitive(vm, true)).toBe(vm.true);
  expect(eq(vm, marshalPrimitive(vm, 1) ?? vm.undefined, vm.newNumber(1))).toBe(
    true
  );
  expect(
    eq(vm, marshalPrimitive(vm, -100) ?? vm.undefined, vm.newNumber(-100))
  ).toBe(true);
  expect(
    eq(vm, marshalPrimitive(vm, "hoge") ?? vm.undefined, vm.newString("hoge"))
  ).toBe(true);
  // expect(
  //   eq(
  //     vm,
  //     marshalPrimitive(vm, BigInt(1)) ?? vm.undefined,
  //     vm.unwrapResult(vm.evalCode("BigInt(1)"))
  //   )
  // ).toBe(true);

  expect(marshalPrimitive(vm, () => {})).toBe(undefined);
  expect(marshalPrimitive(vm, [])).toBe(undefined);
  expect(marshalPrimitive(vm, {})).toBe(undefined);

  vm.dispose();
});
