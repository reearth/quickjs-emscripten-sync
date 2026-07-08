import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call, consume } from "../vmutil";

// The VM-side iterator computes a numeric bitmask per property so the host can
// rebuild the PropertyDescriptor with at most one `ctx.getProp` (for the single
// value/get/set entry that is actually present) plus one `ctx.getNumber`,
// instead of the previous six `getProp` + six `typeof` calls per property.
//
// Bit layout (a "present" bit for every field, plus a "value" bit for the three
// boolean fields whose value we cannot recover from a handle):
//   bit 0 (1)   value present        (typeof d.value !== "undefined")
//   bit 1 (2)   get present          (typeof d.get   !== "undefined")
//   bit 2 (4)   set present          (typeof d.set   !== "undefined")
//   bit 3 (8)   configurable present (typeof d.configurable === "boolean")
//   bit 4 (16)  configurable value   (d.configurable === true)
//   bit 5 (32)  enumerable present   (typeof d.enumerable === "boolean")
//   bit 6 (64)  enumerable value     (d.enumerable === true)
//   bit 7 (128) writable present     (typeof d.writable === "boolean")
//   bit 8 (256) writable value       (d.writable === true)
//
// This mirrors the previous logic exactly: value/get/set are copied only when
// defined (an explicit `value: undefined` is treated as absent, so defaults
// apply, just as `typeof === "undefined"` skipped it before); a boolean field
// is copied only when actually a boolean, and absent boolean fields stay absent
// so `Object.defineProperty` applies its defaults. Data vs accessor descriptors
// are distinguished naturally: data descriptors carry a `writable` present bit
// and no get/set, accessors carry get/set and no `writable`.
const flagsFn = `(o, fn) => {
  const descs = Object.getOwnPropertyDescriptors(o);
  const emit = (k, d) => {
    let f = 0;
    if (typeof d.value !== "undefined") f |= 1;
    if (typeof d.get !== "undefined") f |= 2;
    if (typeof d.set !== "undefined") f |= 4;
    if (typeof d.configurable === "boolean") { f |= 8; if (d.configurable) f |= 16; }
    if (typeof d.enumerable === "boolean") { f |= 32; if (d.enumerable) f |= 64; }
    if (typeof d.writable === "boolean") { f |= 128; if (d.writable) f |= 256; }
    fn(k, d, f);
  };
  Object.entries(descs).forEach(([k, v]) => emit(k, v));
  Object.getOwnPropertySymbols(descs).forEach(k => emit(k, descs[k]));
}`;

export default function unmarshalProperties(
  ctx: QuickJSContext,
  handle: QuickJSHandle,
  target: object | ((...args: any[]) => any),
  unmarshal: (handle: QuickJSHandle) => [unknown, boolean],
) {
  consume(
    ctx.newFunction("", (key, descHandle, flagsHandle) => {
      const [keyName] = unmarshal(key);
      if (typeof keyName !== "string" && typeof keyName !== "number" && typeof keyName !== "symbol")
        return;

      const flags = ctx.getNumber(flagsHandle);
      const desc: PropertyDescriptor = {};

      // Obtain value/get/set as host-owned handles via `ctx.getProp` exactly as
      // before: these must NOT come from the (scope-borrowed, auto-disposed)
      // callback arguments, because `unmarshal` may retain the handle in the
      // Arena's VMMap for identity tracking. Dispose only when `unmarshal`
      // reports the value already existed (so the fresh handle is redundant);
      // otherwise ownership was transferred to the map and we must keep it.
      const readHandle = (fieldKey: string): unknown => {
        const h = ctx.getProp(descHandle, fieldKey);
        const [v, alreadyExists] = unmarshal(h);
        if (alreadyExists) h.dispose();
        return v;
      };

      if (flags & 1) desc.value = readHandle("value");
      if (flags & 2) desc.get = readHandle("get") as any;
      if (flags & 4) desc.set = readHandle("set") as any;
      if (flags & 8) desc.configurable = !!(flags & 16);
      if (flags & 32) desc.enumerable = !!(flags & 64);
      if (flags & 128) desc.writable = !!(flags & 256);

      Object.defineProperty(target, keyName, desc);
    }),
    fn => {
      call(ctx, flagsFn, undefined, handle, fn).dispose();
    },
  );
}
