import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function unmarshalPrimitive(
  vm: QuickJSVm,
  handle: QuickJSHandle
): [any, boolean] {
  const ty = vm.typeof(handle);
  if (
    ty === "undefined" ||
    ty === "number" ||
    ty === "string" ||
    ty === "boolean"
  ) {
    return [vm.dump(handle), true];
  } else if (ty === "object") {
    const isNull = vm.unwrapResult(vm.evalCode("a => a === null"));
    const result = vm.dump(
      vm.unwrapResult(vm.callFunction(isNull, vm.undefined, handle))
    );
    isNull.dispose();
    if (result) {
      return [null, true];
    }
  }

  // symbol and bigint not supported yet
  return [undefined, false];
}
