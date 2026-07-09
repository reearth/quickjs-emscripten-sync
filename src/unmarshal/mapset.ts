import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call, consume } from "../vmutil";

export default function unmarshalMapSet(
  ctx: QuickJSContext,
  handle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => [unknown, boolean],
  preUnmarshal: <T>(target: T, handle: QuickJSHandle) => T | undefined,
): Map<any, any> | Set<any> | undefined {
  const isMap = consume(call(ctx, "a => a instanceof Map", undefined, handle), h => ctx.dump(h));
  const isSet =
    !isMap && consume(call(ctx, "a => a instanceof Set", undefined, handle), h => ctx.dump(h));
  if (!isMap && !isSet) return;

  const result: Map<any, any> | Set<any> = isMap ? new Map() : new Set();
  preUnmarshal(result, handle);

  const iterator = ctx.unwrapResult(ctx.getIterator(handle));
  try {
    for (const elResult of iterator) {
      const el = ctx.unwrapResult(elResult);
      if (isMap) {
        // `disposeKey`/`disposeValue` start true so a mid-flight throw (e.g. OOM
        // inside `unmarshal`) disposes the property handles instead of orphaning
        // them; on success they are disposed only when redundant (already owned).
        const keyHandle = ctx.getProp(el, 0);
        const valueHandle = ctx.getProp(el, 1);
        let disposeKey = true;
        let disposeValue = true;
        try {
          const [key, dk] = unmarshal(keyHandle);
          disposeKey = dk;
          const [value, dv] = unmarshal(valueHandle);
          disposeValue = dv;
          (result as Map<any, any>).set(key, value);
        } finally {
          if (disposeKey && keyHandle.alive) keyHandle.dispose();
          if (disposeValue && valueHandle.alive) valueHandle.dispose();
          if (el.alive) el.dispose();
        }
      } else {
        let disposeValue = true;
        try {
          const [value, dv] = unmarshal(el);
          disposeValue = dv;
          (result as Set<any>).add(value);
        } finally {
          if (disposeValue && el.alive) el.dispose();
        }
      }
    }
  } finally {
    if (iterator.alive) iterator.dispose();
  }

  return result;
}
