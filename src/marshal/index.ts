import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import marshalFunction from "./function";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";
import marshalSymbol from "./symbol";
import marshalJSON from "./json";

export type Options = {
  vm: QuickJSVm;
  unmarshal: (handle: QuickJSHandle) => unknown;
  isMarshalable?: (target: unknown) => boolean | "json";
  find: (target: unknown) => QuickJSHandle | undefined;
  pre: (target: unknown, handle: QuickJSHandle) => QuickJSHandle | undefined;
  preApply?: (target: Function, thisArg: unknown, args: unknown[]) => any;
};

export function marshal(target: unknown, options: Options): QuickJSHandle {
  const { vm, unmarshal, isMarshalable, find, pre } = options;

  {
    const primitive = marshalPrimitive(vm, target);
    if (primitive) {
      return primitive;
    }
  }

  {
    const handle = find(target);
    if (handle) return handle;
  }

  {
    const marshalable = isMarshalable?.(target);
    if (marshalable === false) {
      return vm.undefined;
    } else if (marshalable === "json") {
      return marshalJSON(vm, target, pre);
    }
  }

  const marshal2 = (t: unknown) => marshal(t, options);
  return (
    marshalSymbol(vm, target, pre) ??
    marshalFunction(vm, target, marshal2, unmarshal, pre, options.preApply) ??
    marshalObject(vm, target, marshal2, pre) ??
    vm.undefined
  );
}

export default marshal;
