import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call } from "../vmutil";

import marshalProperties from "./properties";

export default function marshalObject(
  ctx: QuickJSContext,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  preMarshal: (target: unknown, handle: QuickJSHandle) => QuickJSHandle | undefined,
): QuickJSHandle | undefined {
  if (typeof target !== "object" || target === null) return;

  const raw = Array.isArray(target) ? ctx.newArray() : ctx.newObject();
  const handle = preMarshal(target, raw) ?? raw;

  // prototype
  const prototype = Object.getPrototypeOf(target);
  const prototypeHandle =
    prototype && prototype !== Object.prototype && prototype !== Array.prototype
      ? marshal(prototype)
      : undefined;
  if (prototypeHandle) {
    call(ctx, "Object.setPrototypeOf", undefined, handle, prototypeHandle).dispose();
  }

  marshalProperties(ctx, target, raw, marshal);

  return handle;
}
