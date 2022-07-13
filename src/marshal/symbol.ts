import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call } from "../vmutil";

export default function marshalSymbol(
  ctx: QuickJSContext,
  target: unknown,
  preMarshal: (
    target: unknown,
    handle: QuickJSHandle
  ) => QuickJSHandle | undefined
): QuickJSHandle | undefined {
  if (typeof target !== "symbol") return;
  const handle = call(
    ctx,
    "d => Symbol(d)",
    undefined,
    target.description ? ctx.newString(target.description) : ctx.undefined
  );
  return preMarshal(target, handle) ?? handle;
}
