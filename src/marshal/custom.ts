import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { call, consume, consumeAll } from "../vmutil";

export default function marshalCustom(
  ctx: QuickJSContext,
  target: unknown,
  preMarshal: (target: unknown, handle: QuickJSHandle) => QuickJSHandle | undefined,
  custom: Iterable<(target: unknown, ctx: QuickJSContext) => QuickJSHandle | undefined>,
): QuickJSHandle | undefined {
  let handle: QuickJSHandle | undefined;
  for (const c of custom) {
    handle = c(target, ctx);
    if (handle) break;
  }
  if (!handle) return undefined;
  // Own the custom-marshalled handle until `preMarshal` registers it; dispose it
  // if `preMarshal` throws mid-flight so it is not orphaned.
  let owned = true;
  try {
    const result = preMarshal(target, handle) ?? handle;
    owned = false;
    return result;
  } finally {
    if (owned && handle.alive) handle.dispose();
  }
}

export function symbol(target: unknown, ctx: QuickJSContext): QuickJSHandle | undefined {
  if (typeof target !== "symbol") return;
  // `call` does not dispose its arguments, so the description string handle must
  // be consumed here or it leaks on every symbol marshal.
  return target.description
    ? consume(ctx.newString(target.description), d => call(ctx, "d => Symbol(d)", undefined, d))
    : call(ctx, "d => Symbol(d)", undefined, ctx.undefined);
}

export function date(target: unknown, ctx: QuickJSContext): QuickJSHandle | undefined {
  if (!(target instanceof Date)) return;
  // `call` does not dispose its arguments, so the time number handle is consumed
  // here rather than leaked.
  return consume(ctx.newNumber(target.getTime()), d => call(ctx, "d => new Date(d)", undefined, d));
}

export function arrayBuffer(target: unknown, ctx: QuickJSContext): QuickJSHandle | undefined {
  if (target instanceof ArrayBuffer) {
    return ctx.newArrayBuffer(target.slice(0));
  }
  if (ArrayBuffer.isView(target)) {
    // TypedArray or DataView: copy the viewed bytes and rebuild in the VM.
    const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength).slice();
    return consumeAll(
      [ctx.newArrayBuffer(bytes.buffer), ctx.newString(target.constructor.name)],
      ([buf, name]) => call(ctx, `(buf, name) => new globalThis[name](buf)`, undefined, buf, name),
    );
  }
}

export const defaultCustom = [symbol, date, arrayBuffer];
