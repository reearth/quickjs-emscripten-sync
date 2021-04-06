import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import marshalProperties from "./properties";

export default function marshalObject(
  vm: QuickJSVm,
  target: unknown,
  marshaler: (target: any) => QuickJSHandle
): QuickJSHandle | undefined {
  if (typeof target !== "object" || target === null) return;

  const handle = vm.newObject();

  // prototype
  const prototype = Object.getPrototypeOf(target);
  const prototypeHandle =
    prototype && prototype !== Object.prototype
      ? marshaler(prototype)
      : undefined;
  if (prototypeHandle) {
    vm.unwrapResult(vm.evalCode("Object.setPrototypeOf")).consume(
      setPrototypeOf => {
        vm.unwrapResult(
          vm.callFunction(setPrototypeOf, vm.undefined, handle, prototypeHandle)
        ).dispose();
      }
    );
  }

  marshalProperties(vm, target, handle, marshaler);

  return handle;
}
