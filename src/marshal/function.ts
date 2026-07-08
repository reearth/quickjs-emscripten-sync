import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { isES2015Class, isObject } from "../util";
import { call } from "../vmutil";

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
): QuickJSHandle | undefined {
  if (typeof target !== "function") return;

  // `target` may be a host-side proxy wrapper; unwrap it before the class check,
  // because Function.prototype.toString on a callable proxy never matches /^class/.
  // Computed once here rather than per call to avoid the toString + regex on every
  // VM→host invocation.
  const isClass = isES2015Class(unwrap(target));

  const raw = ctx
    .newFunction(target.name, function (...argHandles) {
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
    .consume(handle2 =>
      // fucntions created by vm.newFunction are not callable as a class constrcutor
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

  const handle = preMarshal(target, raw) ?? raw;
  marshalProperties(ctx, target, raw, marshal, disposeTransient);

  return handle;
}
