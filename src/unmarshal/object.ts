import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalProperties from "./properties";

export default function unmarshalObject(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => unknown,
  preUnmarshal: (target: unknown, handle: QuickJSHandle) => void
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

  const obj = {};
  preUnmarshal(obj, handle);

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
    .consume(prototype =>
      vm.typeof(prototype) === "undefined" ? undefined : unmarshal(prototype)
    );
  if (typeof prototype === "object") {
    Object.setPrototypeOf(obj, prototype);
  }

  unmarshalProperties(vm, handle, obj, unmarshal);

  return obj;
}
