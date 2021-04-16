import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function unmarshalSymbol(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  preUnmarshal: <T>(target: T, handle: QuickJSHandle) => T | undefined
): symbol | undefined {
  if (vm.typeof(handle) !== "symbol") return;
  const desc = vm.getString(vm.getProp(handle, "description"));
  const sym = Symbol(desc);
  return preUnmarshal(sym, handle) ?? sym;
}
