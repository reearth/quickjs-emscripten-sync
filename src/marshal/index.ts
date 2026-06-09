import type { QuickJSDeferredPromise, QuickJSHandle, QuickJSContext } from "quickjs-emscripten";

import marshalCustom, { defaultCustom } from "./custom";
import marshalFunction from "./function";
import marshalHostRef from "./hostref";
import marshalJSON from "./json";
import marshalMapSet from "./mapset";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";
import marshalPromise from "./promise";

export type Options = {
  ctx: QuickJSContext;
  unmarshal: (handle: QuickJSHandle) => unknown;
  isMarshalable?: (target: unknown) => boolean | "json";
  marshalByReference?: (target: unknown) => boolean;
  registerHostRef?: (target: unknown, handle: QuickJSHandle) => QuickJSHandle;
  find: (target: unknown) => QuickJSHandle | undefined;
  // Track a handle that nobody else owns (json copies, BigInt) so it can be
  // disposed once consumed.
  registerTransient?: (handle: QuickJSHandle) => void;
  // Dispose a handle previously registered as transient, right after a parent
  // consumer has copied it into the parent value. A no-op for owned handles.
  disposeTransient?: (handle: QuickJSHandle) => void;
  pre: (
    target: unknown,
    handle: QuickJSHandle | QuickJSDeferredPromise,
    mode: true | "json" | undefined,
  ) => QuickJSHandle | undefined;
  preApply?: (target: (...args: any[]) => any, thisArg: unknown, args: unknown[]) => any;
  // Adjust ownership of a handle that is about to be handed to the VM as a host
  // function's return value. The VM disposes whatever it receives, so a handle
  // the VMMap retains (for identity, while sync is on) must be dup'd here or its
  // map entry goes stale. Defaults to identity (no-op).
  prepareReturn?: (handle: QuickJSHandle) => QuickJSHandle;
  custom?: Iterable<(obj: unknown, ctx: QuickJSContext) => QuickJSHandle | undefined>;
};

export function marshal(target: unknown, options: Options): QuickJSHandle {
  const { ctx, unmarshal, isMarshalable, find, pre } = options;

  {
    const primitive = marshalPrimitive(ctx, target);
    if (primitive) {
      // BigInt handles are heap-allocated and, unlike strings and numbers, are
      // not reclaimed unless explicitly disposed. Track them as transient so a
      // nested one is freed by its parent consumer (or on dispose as a fallback).
      if (typeof target === "bigint") options.registerTransient?.(primitive);
      return primitive;
    }
  }

  {
    const handle = find(target);
    if (handle) return handle;
  }

  // Opt-in pass-by-reference: hand the object to the VM as an opaque HostRef
  // instead of marshalling its contents. Bypasses isMarshalable on purpose.
  if (options.marshalByReference?.(target) && options.registerHostRef) {
    const handle = marshalHostRef(ctx, target, options.registerHostRef);
    if (handle) return handle;
  }

  const marshalable = isMarshalable?.(target);
  if (marshalable === false) {
    return ctx.undefined;
  }

  const pre2 = (target: any, handle: QuickJSHandle | QuickJSDeferredPromise) =>
    pre(target, handle, marshalable);
  if (marshalable === "json") {
    return marshalJSON(ctx, target, pre2);
  }

  const marshal2 = (t: unknown) => marshal(t, options);
  const disposeTransient = options.disposeTransient;
  return (
    marshalCustom(ctx, target, pre2, [...defaultCustom, ...(options.custom ?? [])]) ??
    marshalPromise(ctx, target, marshal2, pre2) ??
    marshalFunction(
      ctx,
      target,
      marshal2,
      unmarshal,
      pre2,
      options.preApply,
      disposeTransient,
      options.prepareReturn,
    ) ??
    marshalMapSet(ctx, target, marshal2, pre2, disposeTransient) ??
    marshalObject(ctx, target, marshal2, pre2, disposeTransient) ??
    ctx.undefined
  );
}

export default marshal;
