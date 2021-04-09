import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalProperties from "./properties";

export default function unmarshalFunction(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  marshal: (value: unknown) => QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => [unknown, boolean],
  preUnmarshal: (target: unknown, handle: QuickJSHandle) => void
): Function | undefined {
  if (vm.typeof(handle) !== "function") return;

  const func = function(this: any, ...args: any[]) {
    const thisHandle = marshal(this);
    const argHandles = args.map(a => marshal(a));

    if (new.target) {
      return vm
        .unwrapResult(vm.evalCode(`(Cls, ...args) => new Cls(...args)`))
        .consume(n => {
          const [instance] = unmarshal(
            vm.unwrapResult(
              vm.callFunction(n, thisHandle, handle, ...argHandles)
            )
          );
          Object.defineProperties(
            this,
            Object.getOwnPropertyDescriptors(instance)
          );
          return this;
        });
    }

    const [result] = unmarshal(
      vm.unwrapResult(vm.callFunction(handle, thisHandle, ...argHandles))
    );
    return result;
  };

  preUnmarshal(func, handle);
  unmarshalProperties(vm, handle, func, unmarshal);

  return func;
}