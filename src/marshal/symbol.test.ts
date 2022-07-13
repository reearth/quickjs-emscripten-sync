import { getQuickJS } from "quickjs-emscripten";
import { expect, test, vi } from "vitest";

import marshalSymbol from "./symbol";

test("works", async () => {
  const ctx = (await getQuickJS()).newContext();
  const pre = vi.fn();
  const sym = Symbol("foobar");

  expect(marshalSymbol(ctx, {}, pre)).toBe(undefined);
  expect(pre).toBeCalledTimes(0);

  const handle = marshalSymbol(ctx, sym, pre);
  if (!handle) throw new Error("handle is undefined");
  expect(ctx.typeof(handle)).toBe("symbol");
  expect(ctx.getString(ctx.getProp(handle, "description"))).toBe("foobar");
  expect(pre).toReturnTimes(1);
  expect(pre.mock.calls[0][0]).toBe(sym);
  expect(pre.mock.calls[0][1] === handle).toBe(true);

  handle.dispose();
  ctx.dispose();
});
