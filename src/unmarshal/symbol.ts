import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

export default function unmarshalSymbol(
  ctx: QuickJSContext,
  handle: QuickJSHandle,
  preUnmarshal: <T>(target: T, handle: QuickJSHandle) => T | undefined
): symbol | undefined {
  if (ctx.typeof(handle) !== "symbol") return;
  const desc = ctx.getString(ctx.getProp(handle, "description"));
  const sym = Symbol(desc);
  return preUnmarshal(sym, handle) ?? sym;
}
