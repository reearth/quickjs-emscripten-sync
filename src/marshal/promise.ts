import type { QuickJSDeferredPromise, QuickJSHandle, QuickJSContext } from "quickjs-emscripten";

export default function marshalPromise(
  ctx: QuickJSContext,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  preMarshal: (target: unknown, handle: QuickJSDeferredPromise) => QuickJSHandle | undefined,
) {
  if (!(target instanceof Promise)) return;

  const promise = ctx.newPromise();
  // Own the deferred promise until `preMarshal` registers it; dispose it (handle
  // plus resolve/reject callbacks) if `preMarshal` throws mid-flight.
  let owned = true;
  try {
    target.then(
      d => promise.resolve(marshal(d)),
      d => promise.reject(marshal(d)),
    );

    const result = preMarshal(target, promise) ?? promise.handle;
    owned = false;
    return result;
  } finally {
    if (owned && promise.alive) promise.dispose();
  }
}
