import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function marshalPrimitive(
  vm: QuickJSVm,
  target: any
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
  }
  // bigint and symbol is not supported yet
  return undefined;
}
