import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { call } from "../vmutil";

export default function marshalSymbol(
  vm: QuickJSVm,
  target: unknown,
  preMarshal: (
    target: unknown,
    handle: QuickJSHandle
  ) => QuickJSHandle | undefined
): QuickJSHandle | undefined {
  if (typeof target !== "symbol") return;
  const handle = call(
    vm,
    "d => Symbol(d)",
    undefined,
    target.description ? vm.newString(target.description) : vm.undefined
  );
  return preMarshal(target, handle) ?? handle;
}
