import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call } from "../vmutil";

import marshalProperties from "./properties";

export default function marshalObject(
  ctx: QuickJSContext,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  preMarshal: (target: unknown, handle: QuickJSHandle) => QuickJSHandle | undefined,
  disposeTransient: (handle: QuickJSHandle) => void = () => {},
): QuickJSHandle | undefined {
  if (typeof target !== "object" || target === null) return;

  const raw = Array.isArray(target) ? ctx.newArray() : ctx.newObject();
  // We own `raw` until `preMarshal` registers it (in the map or the transient
  // set) or returns it as `handle`. If `preMarshal` throws mid-flight (e.g. an
  // OOM while creating the proxy), dispose `raw` so it is not orphaned.
  let ownRaw = true;
  try {
    const handle = preMarshal(target, raw) ?? raw;
    ownRaw = false;

    // prototype
    const prototype = Object.getPrototypeOf(target);
    const prototypeHandle =
      prototype && prototype !== Object.prototype && prototype !== Array.prototype
        ? marshal(prototype)
        : undefined;
    if (prototypeHandle) {
      call(ctx, "Object.setPrototypeOf", undefined, handle, prototypeHandle).dispose();
      // setPrototypeOf has taken its own reference; drop ours if it was transient.
      disposeTransient(prototypeHandle);
    }

    marshalProperties(ctx, target, raw, marshal, disposeTransient);

    return handle;
  } finally {
    if (ownRaw && raw.alive) raw.dispose();
  }
}
