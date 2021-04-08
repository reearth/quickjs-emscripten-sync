import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalProperties from "./properties";

export default function unmarshalFunction(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  marshal: (value: unknown) => QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => unknown,
  preUnmarshal: (target: unknown, handle: QuickJSHandle) => void
): Function | undefined {
  if (vm.typeof(handle) !== "function") return;

  const func = function(this: any, ...args: any[]) {
    const thisHandle = marshal(this);
    const argHandles = args.map(a => marshal(a));
    return unmarshal(
      vm.unwrapResult(vm.callFunction(handle, thisHandle, ...argHandles))
    );
  };

  preUnmarshal(func, handle);
  unmarshalProperties(vm, handle, func, unmarshal);

  return func;
}
