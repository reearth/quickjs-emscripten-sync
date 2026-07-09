import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { newDeferred } from "../util";
import { call, consume, instanceOf } from "../vmutil";

export default function unmarshalPromise<T = unknown>(
  ctx: QuickJSContext,
  handle: QuickJSHandle,
  /** marshal returns handle and boolean indicates that the handle should be disposed after use */
  marshal: (value: unknown) => [QuickJSHandle, boolean],
  preUnmarshal: <T>(target: T, handle: QuickJSHandle) => T | undefined,
): Promise<T> | undefined {
  if (!isPromiseHandle(ctx, handle)) return;

  const deferred = newDeferred<T>();
  const [resHandle, resShouldBeDisposed] = marshal(deferred.resolve);
  const [rejHandle, rejShouldBeDisposed] = marshal(deferred.reject);
  call(ctx, "(p, res, rej) => { p.then(res, rej); }", undefined, handle, resHandle, rejHandle);
  if (resShouldBeDisposed) resHandle.dispose();
  if (rejShouldBeDisposed) rejHandle.dispose();

  return preUnmarshal(deferred.promise, handle) ?? deferred.promise;
}

function isPromiseHandle(ctx: QuickJSContext, handle: QuickJSHandle): boolean {
  if (!handle.owner) return false;
  // `consume` disposes the Promise constructor handle even if `instanceOf`
  // throws mid-flight (e.g. an interrupt or OOM lands in the `a instanceof b`
  // VM call); the raw `Lifetime.consume` would skip disposal on throw, orphaning
  // the constructor handle.
  return consume(ctx.unwrapResult(ctx.evalCode("Promise")), promise => {
    if (!handle.owner) return false;
    return instanceOf(ctx, handle, promise);
  });
}
