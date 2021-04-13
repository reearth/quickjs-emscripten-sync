import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalProperties from "./properties";

export default function unmarshalObject(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => [unknown, boolean],
  preUnmarshal: <T>(target: T, handle: QuickJSHandle) => T | undefined
): object | undefined {
  if (
    vm.typeof(handle) !== "object" ||
    // null check
    vm
      .unwrapResult(vm.evalCode("o => o === null"))
      .consume(n =>
        vm.dump(vm.unwrapResult(vm.callFunction(n, vm.undefined, handle)))
      )
  )
    return;

  const raw = {};
  const obj = preUnmarshal(raw, handle) ?? raw;

  const prototype = vm
    .unwrapResult(
      vm.evalCode(`o => {
        const p = Object.getPrototypeOf(o);
        return !p || p === Object.prototype ? undefined : p;
      }`)
    )
    .consume(getPrototypeOf =>
      vm.unwrapResult(vm.callFunction(getPrototypeOf, vm.undefined, handle))
    )
    .consume(prototype => {
      if (vm.typeof(prototype) === "undefined") return;
      const [proto] = unmarshal(prototype);
      return proto;
    });
  if (typeof prototype === "object") {
    Object.setPrototypeOf(obj, prototype);
  }

  unmarshalProperties(vm, handle, raw, unmarshal);

  return obj;
}
