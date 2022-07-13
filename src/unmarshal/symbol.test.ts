import { getQuickJS } from "quickjs-emscripten";
import { expect, test, vi } from "vitest";

import unmarshalSymbol from "./symbol";

test("works", async () => {
  const ctx = (await getQuickJS()).newContext();
  const pre = vi.fn();
  const obj = ctx.newObject();
  const handle = ctx.unwrapResult(ctx.evalCode(`Symbol("foobar")`));

  expect(unmarshalSymbol(ctx, obj, pre)).toBe(undefined);
  expect(pre).toBeCalledTimes(0);

  const sym = unmarshalSymbol(ctx, handle, pre);
  expect(typeof sym).toBe("symbol");
  expect((sym as any).description).toBe("foobar");
  expect(pre).toReturnTimes(1);
  expect(pre.mock.calls[0][0]).toBe(sym);
  expect(pre.mock.calls[0][1] === handle).toBe(true);

  handle.dispose();
  obj.dispose();
  ctx.dispose();
});
