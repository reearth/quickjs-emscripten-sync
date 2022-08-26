import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

export default function unmarshalPrimitive(
  ctx: QuickJSContext,
  handle: QuickJSHandle,
): [any, boolean] {
  const ty = ctx.typeof(handle);
  if (ty === "undefined" || ty === "number" || ty === "string" || ty === "boolean") {
    return [ctx.dump(handle), true];
  } else if (ty === "object") {
    const isNull = ctx
      .unwrapResult(ctx.evalCode("a => a === null"))
      .consume(n => ctx.dump(ctx.unwrapResult(ctx.callFunction(n, ctx.undefined, handle))));
    if (isNull) {
      return [null, true];
    }
  }

  // BigInt is not supported by quickjs-emscripten
  // if (ty === "bigint") {
  //   const str = ctx
  //     .getProp(handle, "toString")
  //     .consume(toString => vm.unwrapResult(vm.callFunction(toString, handle)))
  //     .consume(str => ctx.getString(str));
  //   const bi = BigInt(str);
  //   return [bi, true];
  // }

  return [undefined, false];
}
