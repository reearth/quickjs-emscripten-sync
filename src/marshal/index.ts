import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import marshalArray from "./array";
import marshalFunction from "./function";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";
import VMMap from "../vmmap";

export type Options = {
  vm: QuickJSVm;
  map: VMMap;
  isMarshalable?: (target: any) => boolean;
  unmarshal: (handle: QuickJSHandle) => unknown;
  proxyKeySymbol?: QuickJSHandle;
};

export function marshal(target: unknown, options: Options): QuickJSHandle {
  if (options.vm !== options.map.vm) {
    throw new Error("options.vm and map.vm do not match");
  }

  {
    const primitive = marshalPrimitive(options.vm, target);
    if (primitive) {
      return primitive;
    }
  }

  {
    const handle = options.map.get(target);
    if (handle) return handle;
  }

  if (options?.isMarshalable?.(target) === false) {
    return options.vm.undefined;
  }

  const marshal2 = (t: unknown) => marshal(t, options);
  const preMarshal = (t: unknown, h: QuickJSHandle) => {
    options.map.set(t, h);
  };

  return (
    marshalArray(options.vm, target, marshal2, preMarshal) ??
    marshalFunction(
      options.vm,
      target,
      marshal2,
      options.unmarshal,
      preMarshal,
      options.proxyKeySymbol
    ) ??
    marshalObject(options.vm, target, marshal2, preMarshal) ??
    options.vm.undefined
  );
}

export default marshal;
