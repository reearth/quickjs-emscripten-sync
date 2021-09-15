import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { json } from "../vmutil";

export default function marshalJSON(
  vm: QuickJSVm,
  target: unknown,
  preMarshal: (
    target: unknown,
    handle: QuickJSHandle
  ) => QuickJSHandle | undefined
): QuickJSHandle {
  const raw = json(vm, target);
  const handle = preMarshal(target, raw) ?? raw;
  return handle;
}
