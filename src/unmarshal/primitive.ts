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
    const isNull = vm
      .unwrapResult(vm.evalCode("a => a === null"))
      .consume(n =>
        vm.dump(vm.unwrapResult(vm.callFunction(n, vm.undefined, handle)))
      );
    if (isNull) {
      return [null, true];
    }
  }

  // BigInt is not supported by quickjs-emscripten
  // if (ty === "bigint") {
  //   const str = vm
  //     .getProp(handle, "toString")
  //     .consume(toString => vm.unwrapResult(vm.callFunction(toString, handle)))
  //     .consume(str => vm.getString(str));
  //   const bi = BigInt(str);
  //   return [bi, true];
  // }

  return [undefined, false];
}
