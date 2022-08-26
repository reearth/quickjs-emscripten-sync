import { getQuickJS } from "quickjs-emscripten";
import { expect, test } from "vitest";

import unmarshalPrimitive from "./primitive";

test("works", async () => {
  const ctx = (await getQuickJS()).newContext();

  expect(unmarshalPrimitive(ctx, ctx.undefined)).toEqual([undefined, true]);
  expect(unmarshalPrimitive(ctx, ctx.true)).toEqual([true, true]);
  expect(unmarshalPrimitive(ctx, ctx.false)).toEqual([false, true]);
  expect(unmarshalPrimitive(ctx, ctx.null)).toEqual([null, true]);
  expect(unmarshalPrimitive(ctx, ctx.newString("hoge"))).toEqual(["hoge", true]);
  expect(unmarshalPrimitive(ctx, ctx.newNumber(-10))).toEqual([-10, true]);
  // expect(
  //   unmarshalPrimitive(ctx, ctx.unwrapResult(vm.evalCode(`BigInt(1)`)))
  // ).toEqual([BigInt(1), true]);

  const obj = ctx.newObject();
  expect(unmarshalPrimitive(ctx, obj)).toEqual([undefined, false]);
  const array = ctx.newArray();
  expect(unmarshalPrimitive(ctx, array)).toEqual([undefined, false]);
  const func = ctx.newFunction("", () => {});
  expect(unmarshalPrimitive(ctx, func)).toEqual([undefined, false]);

  obj.dispose();
  array.dispose();
  func.dispose();
  ctx.dispose();
});
