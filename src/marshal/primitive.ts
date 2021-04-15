import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
// import { call } from "../vmutil";

export default function marshalPrimitive(
  vm: QuickJSVm,
  target: unknown
): QuickJSHandle | undefined {
  switch (typeof target) {
    case "undefined":
      return vm.undefined;
    case "number":
      return vm.newNumber(target);
    case "string":
      return vm.newString(target);
    case "boolean":
      return target ? vm.true : vm.false;
    case "object":
      return target === null ? vm.null : undefined;
    // BigInt is not supported by quickjs-emscripten
    // case "bigint":
    //   return call(vm, `s => BigInt(s)`, undefined, vm.newString(target.toString()));
  }
  // symbol is not supported yet
  return undefined;
}
