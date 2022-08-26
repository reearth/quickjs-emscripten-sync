import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { json } from "../vmutil";

export default function marshalJSON(
  ctx: QuickJSContext,
  target: unknown,
  preMarshal: (target: unknown, handle: QuickJSHandle) => QuickJSHandle | undefined,
): QuickJSHandle {
  const raw = json(ctx, target);
  const handle = preMarshal(target, raw) ?? raw;
  return handle;
}
