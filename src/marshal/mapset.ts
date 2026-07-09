import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call } from "../vmutil";

export default function marshalMapSet(
  ctx: QuickJSContext,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  preMarshal: (target: unknown, handle: QuickJSHandle) => QuickJSHandle | undefined,
  disposeTransient: (handle: QuickJSHandle) => void = () => {},
): QuickJSHandle | undefined {
  if (target instanceof Map) {
    const raw = call(ctx, "() => new Map()");
    // Own `raw` until `preMarshal` registers it; dispose it if `preMarshal`
    // throws mid-flight so the fresh Map handle is not orphaned.
    let ownRaw = true;
    try {
      const handle = preMarshal(target, raw) ?? raw;
      ownRaw = false;
      for (const [k, v] of target) {
        const kh = marshal(k);
        const vh = marshal(v);
        call(ctx, "(m, k, v) => m.set(k, v)", undefined, raw, kh, vh).dispose();
        // set() has taken its own references; drop ours if they were transient.
        disposeTransient(kh);
        disposeTransient(vh);
      }
      return handle;
    } finally {
      if (ownRaw && raw.alive) raw.dispose();
    }
  }

  if (target instanceof Set) {
    const raw = call(ctx, "() => new Set()");
    let ownRaw = true;
    try {
      const handle = preMarshal(target, raw) ?? raw;
      ownRaw = false;
      for (const v of target) {
        const vh = marshal(v);
        call(ctx, "(s, v) => s.add(v)", undefined, raw, vh).dispose();
        // add() has taken its own reference; drop ours if it was transient.
        disposeTransient(vh);
      }
      return handle;
    } finally {
      if (ownRaw && raw.alive) raw.dispose();
    }
  }
}
