import { getQuickJS } from "quickjs-emscripten";
import { expect, test } from "vitest";


import marshalPrimitive from "./primitive";

test("works", async () => {
  const ctx = (await getQuickJS()).newContext();

  expect(marshalPrimitive(ctx, undefined)).toBe(ctx.undefined);
  expect(marshalPrimitive(ctx, null)).toBe(ctx.null);
  expect(marshalPrimitive(ctx, false)).toBe(ctx.false);
  expect(marshalPrimitive(ctx, true)).toBe(ctx.true);
  expect(ctx.sameValue(marshalPrimitive(ctx, 1) ?? ctx.undefined, ctx.newNumber(1))).toBe(true);
  expect(ctx.sameValue(marshalPrimitive(ctx, -100) ?? ctx.undefined, ctx.newNumber(-100))).toBe(true);
  expect(ctx.sameValue(marshalPrimitive(ctx, "hoge") ?? ctx.undefined, ctx.newString("hoge"))).toBe(true);
  // expect(
  //   ctx.sameValue(
  //     marshalPrimitive(ctx, BigInt(1)) ?? ctx.undefined,
  //     ctx.unwrapResult(ctx.evalCode("BigInt(1)"))
  //   )
  // ).toBe(true);

  expect(marshalPrimitive(ctx, () => {})).toBe(undefined);
  expect(marshalPrimitive(ctx, [])).toBe(undefined);
  expect(marshalPrimitive(ctx, {})).toBe(undefined);

  ctx.dispose();
});
