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
): QuickJSHandle | undefined {
  if (typeof target !== "function") return;

  const raw = ctx
    .newFunction(target.name, function (...argHandles) {
      const that = unmarshal(this);
      const args = argHandles.map(a => unmarshal(a));

      if (isES2015Class(target) && isObject(that)) {
        // Class constructors cannot be invoked without new expression, and new.target is not changed
        const result = new target(...args);
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
