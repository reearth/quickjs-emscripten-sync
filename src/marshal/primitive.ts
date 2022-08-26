import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

// import { call } from "../vmutil";

export default function marshalPrimitive(
  ctx: QuickJSContext,
  target: unknown,
): QuickJSHandle | undefined {
  switch (typeof target) {
    case "undefined":
      return ctx.undefined;
    case "number":
      return ctx.newNumber(target);
    case "string":
      return ctx.newString(target);
    case "boolean":
      return target ? ctx.true : ctx.false;
    case "object":
      return target === null ? ctx.null : undefined;

    // BigInt is not supported by quickjs-emscripten
    // case "bigint":
    //   return call(
    //     ctx,
    //     `s => BigInt(s)`,
    //     undefined,
    //     ctx.newString(target.toString())
    //   );
  }

  return undefined;
}
