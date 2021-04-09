import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import marshalArray from "./array";
import marshalFunction from "./function";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";
import VMMap from "../vmmap";

export type Options = {
  vm: QuickJSVm;
  map: VMMap;
  marshalable?: (target: any) => boolean;
  unmarshaler: (handle: QuickJSHandle) => unknown;
  proxyKeySymbol?: QuickJSHandle;
};

export class Marshaler {
  options: Omit<Options, "map">;

  constructor(options: Omit<Options, "map">) {
    this.options = options;
  }

  marshal(target: unknown, map: VMMap) {
    return marshal(target, { ...this.options, map });
  }
}

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

  if (options?.marshalable?.(target) === false) {
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
      options.unmarshaler,
      preMarshal,
      options.proxyKeySymbol
    ) ??
    marshalObject(options.vm, target, marshal2, preMarshal) ??
    options.vm.undefined
  );
}
