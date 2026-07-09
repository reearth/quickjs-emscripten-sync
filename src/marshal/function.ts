import type { QuickJSAsyncContext, QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { isES2015Class, isObject } from "../util";
import { call, consume } from "../vmutil";

import marshalProperties from "./properties";

export default function marshalFunction(
  ctx: QuickJSContext,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => unknown,
  preMarshal: (target: unknown, handle: QuickJSHandle) => QuickJSHandle | undefined,
  preApply?: (target: (...args: any[]) => any, thisArg: unknown, args: unknown[]) => any,
  disposeTransient: (handle: QuickJSHandle) => void = () => {},
  prepareReturn: (handle: QuickJSHandle) => QuickJSHandle = h => h,
  unwrap: (target: unknown) => unknown = t => t,
  asyncify?: (target: unknown) => boolean,
): QuickJSHandle | undefined {
  if (typeof target !== "function") return;

  // `target` may be a host-side proxy wrapper; unwrap it before the class check,
  // because Function.prototype.toString on a callable proxy never matches /^class/.
  // Computed once here rather than per call to avoid the toString + regex on every
  // VM→host invocation.
  const unwrapped = unwrap(target);
  const isClass = isES2015Class(unwrapped);

  // Marshal as an Asyncified function only when the caller opts in for this
  // target AND the context actually supports it (a plain sync context has no
  // `newAsyncifiedFunction`, so fall back to the normal function marshalling,
  // which hands the guest a marshalled Promise as before).
  const useAsyncify =
    !!asyncify && asyncify(unwrapped) && "newAsyncifiedFunction" in ctx;

  const inner = (
    useAsyncify
      ? // Asyncify: the VM stack is suspended until the host promise settles, so
        // the guest receives the resolved value synchronously. Async functions
        // can never be class constructors, so the class-constructor path is
        // skipped here.
        (ctx as QuickJSAsyncContext).newAsyncifiedFunction(target.name, async function (
          ...argHandles
        ) {
          const that = ctx.sameValue(this, ctx.global) ? undefined : unmarshal(this);
          const args = argHandles.map(a => unmarshal(a));

          // `preApply` wraps the (synchronous) invocation to toggle temporal sync
          // around it; it returns the host promise, which we await here. Note that
          // its finally runs as soon as `apply` returns the promise, so temporal
          // sync is only active for the synchronous portion of the async function,
          // not across its awaits.
          const result = await (preApply
            ? preApply(target as (...args: any[]) => any, that, args)
            : (target as (...args: any[]) => any).apply(that, args));

          return prepareReturn(marshal(result));
        })
      : ctx.newFunction(target.name, function (...argHandles) {
          // A plain call (`fn()`) passes the VM global object as `this`. Unmarshalling
          // it would eagerly deep-copy the entire global graph (hundreds of handles)
          // on the first call, for a `this` host functions almost never use — and
          // leaking globalThis to the host is undesirable. So global `this` is passed
          // to the host function as `undefined`, which differs from plain JS where a
          // non-strict function sees `this === globalThis` (see README Limitations).
          // Real method calls still get their receiver unmarshalled.
          const that = ctx.sameValue(this, ctx.global) ? undefined : unmarshal(this);
          const args = argHandles.map(a => unmarshal(a));

          if (isClass && isObject(that)) {
            // Class constructors cannot be invoked without new expression, and new.target is not changed
            const result = new (target as new (...args: any[]) => any)(...args);
            Object.entries(result).forEach(([key, value]) => {
              const valueHandle = marshal(value);
              ctx.setProp(this, key, valueHandle);
              // setProp dup'd the value into `this`; drop ours if it was transient.
              disposeTransient(valueHandle);
            });
            return this;
          }

          // The VM disposes whatever we return here. `prepareReturn` dups the
          // handle when the VMMap retains it, so the map keeps a live copy and
          // identity (`x === fn()` across calls) survives instead of going stale.
          return prepareReturn(
            marshal(
              preApply
                ? preApply(target as (...args: any[]) => any, that, args)
                : (target as (...args: any[]) => any).apply(that, args),
            ),
          );
        })
  );

  // `consume` disposes the raw newFunction handle even if `call` throws (the raw
  // `Lifetime.consume` would skip disposal on throw, leaking the function handle).
  const raw = consume(inner, handle2 =>
    // functions created by vm.newFunction are not callable as a class constructor
    call(
      ctx,
      `Cls => {
        const fn = function(...args) { return Cls.apply(this, args); };
        fn.name = Cls.name;
        fn.length = Cls.length;
        return fn;
      }`,
      undefined,
      handle2,
    ),
  );

  // Own `raw` until `preMarshal` registers it; dispose it if `preMarshal` throws
  // mid-flight so the wrapped function handle is not orphaned.
  let ownRaw = true;
  try {
    const handle = preMarshal(target, raw) ?? raw;
    ownRaw = false;
    marshalProperties(ctx, target, raw, marshal, disposeTransient);
    return handle;
  } finally {
    if (ownRaw && raw.alive) raw.dispose();
  }
}
