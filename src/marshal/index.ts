import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import marshalArray from "./array";
import marshalFunction from "./function";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";

export type Options = {
  vm: QuickJSVm;
  unmarshal: (handle: QuickJSHandle) => unknown;
  isMarshalable?: (target: unknown) => boolean;
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

  if (isMarshalable?.(target) === false) {
    return vm.undefined;
  }

  const marshal2 = (t: unknown) => marshal(t, options);

  const result =
    marshalArray(vm, target, marshal2, pre) ??
    marshalFunction(vm, target, marshal2, unmarshal, pre, options.preApply) ??
    marshalObject(vm, target, marshal2, pre) ??
    vm.undefined;

  return result;
}

export default marshal;
