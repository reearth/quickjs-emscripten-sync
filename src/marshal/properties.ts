import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call } from "../vmutil";

export default function marshalProperties(
  ctx: QuickJSContext,
  target: object | ((...args: any[]) => any),
  handle: QuickJSHandle,
  marshal: (target: unknown) => QuickJSHandle,
  disposeTransient: (handle: QuickJSHandle) => void = () => {},
): void {
  // `descs` aggregates only the properties that need the full descriptor path
  // (accessors, non-default flags, symbol keys). It is created lazily so plain
  // objects/arrays skip both the `ctx.newObject()` and the final
  // `Object.defineProperties` roundtrip entirely.
  let descs: QuickJSHandle | undefined;
  // Descriptor-path values may be transient (json copies / BigInt) with no
  // owner; once `Object.defineProperties` has copied them into `handle` the
  // standalone handles are redundant and disposed below. Owned handles are left
  // untouched. Fast-path values are disposed inline (see below).
  const transient: QuickJSHandle[] = [];

  // `ctx.setProp` uses `[[Set]]` semantics, which walks the prototype chain and
  // would invoke an inherited accessor/setter (or the `__proto__` setter)
  // instead of creating an own property. That only matters when `marshalObject`
  // installed a custom prototype (see marshal/object.ts): a default-prototype VM
  // object (plain object / array) has no shadowing accessors, so `setProp` on a
  // normal string key is identical to `defineProperty` with all flags true. For
  // custom-prototype objects (e.g. class instances) we must keep the descriptor
  // path, which uses `[[DefineOwnProperty]]` semantics.
  const proto = Object.getPrototypeOf(target);
  const defaultProto = proto === Object.prototype || proto === Array.prototype;

  const cb = (key: string | number | symbol, desc: PropertyDescriptor) => {
    // Fast path: a plain data property with a string key and all flags at their
    // defaults, on a default-prototype object, is semantically identical to
    // `ctx.setProp` on a fresh object/array, so we skip building a descriptor
    // object. `writable === true` implies a data descriptor (accessors have no
    // `writable`), so there is no get/set. Symbol keys keep the descriptor path
    // (setProp string-key fast path does not apply). `__proto__` is excluded
    // because it resolves to the prototype setter under `[[Set]]`. The value is
    // copied into `handle` by setProp immediately, so its transient handle can
    // be disposed right away.
    if (
      defaultProto &&
      typeof key === "string" &&
      key !== "__proto__" &&
      desc.writable === true &&
      desc.enumerable === true &&
      desc.configurable === true &&
      desc.get === undefined &&
      desc.set === undefined
    ) {
      const keyHandle = marshal(key);
      const valueHandle = marshal(desc.value);
      ctx.setProp(handle, keyHandle, valueHandle);
      disposeTransient(valueHandle);
      return;
    }

    const keyHandle = marshal(key);
    const valueHandle = typeof desc.value === "undefined" ? undefined : marshal(desc.value);
    const getHandle = typeof desc.get === "undefined" ? undefined : marshal(desc.get);
    const setHandle = typeof desc.set === "undefined" ? undefined : marshal(desc.set);
    if (valueHandle) transient.push(valueHandle);
    if (getHandle) transient.push(getHandle);
    if (setHandle) transient.push(setHandle);

    const descsHandle = (descs ??= ctx.newObject());
    ctx.newObject().consume(descObj => {
      Object.entries(desc).forEach(([k, v]) => {
        const v2 =
          k === "value"
            ? valueHandle
            : k === "get"
            ? getHandle
            : k === "set"
            ? setHandle
            : v
            ? ctx.true
            : ctx.false;
        if (v2) {
          ctx.setProp(descObj, k, v2);
        }
      });
      ctx.setProp(descsHandle, keyHandle, descObj);
    });
  };

  try {
    const desc = Object.getOwnPropertyDescriptors(target);
    Object.entries(desc).forEach(([k, v]) => cb(k, v));
    Object.getOwnPropertySymbols(desc).forEach(k => cb(k, (desc as any)[k]));

    if (descs) {
      call(ctx, `Object.defineProperties`, undefined, handle, descs).dispose();
      // Safe only after defineProperties has dup'd the values into `handle`;
      // `descs` still holds its own references until its own dispose() below.
      for (const h of transient) disposeTransient(h);
    }
  } finally {
    descs?.dispose();
  }
}
