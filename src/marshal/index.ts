import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import marshalArray from "./array";
import marshalFunction from "./function";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";
import VMMap from "../vmmap";
import { isObject } from "..";

export type SyncMode = "both" | "host" | "vm";

export type Options = {
  vm: QuickJSVm;
  map: VMMap;
  isMarshalable?: (target: any) => boolean;
  unmarshal: (handle: QuickJSHandle) => unknown;
  proxyKeySymbol?: QuickJSHandle;
  sync?: SyncMode;
};

export function marshal(target: unknown, options: Options): QuickJSHandle {
  const { vm, map, isMarshalable, unmarshal, proxyKeySymbol, sync } = options;

  if (vm !== map.vm) {
    throw new Error("options.vm and map.vm do not match");
  }

  {
    const primitive = marshalPrimitive(vm, target);
    if (primitive) {
      return primitive;
    }
  }

  {
    const handle = map.get(target);
    if (handle) return handle;
  }

  if (isMarshalable?.(target) === false) {
    return vm.undefined;
  }

  const marshal2 = (t: unknown) => marshal(t, options);
  const preMarshal = (t: unknown, handle: QuickJSHandle): QuickJSHandle => {
    const h =
      sync && isObject(target) && proxyKeySymbol
        ? handle.consume(h =>
            wrap(sync, vm, target, h, unmarshal, proxyKeySymbol)
          )
        : handle;

    map.set(t, h);
    return h;
  };

  const result =
    marshalArray(vm, target, marshal2, preMarshal) ??
    marshalFunction(
      vm,
      target,
      marshal2,
      unmarshal,
      preMarshal,
      proxyKeySymbol
    ) ??
    marshalObject(vm, target, marshal2, preMarshal) ??
    vm.undefined;

  return result;
}

function wrap(
  sync: SyncMode,
  vm: QuickJSVm,
  target: any,
  handle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => any,
  proxyKeySymbol: QuickJSHandle
): QuickJSHandle {
  return vm
    .unwrapResult(
      vm.evalCode(`(target, setter, sym, sync) => new Proxy(target, {
        get(obj, key) {
          return key === sym ? obj : Reflect.get(obj, key)
        },
        set(obj, key, value) {
          const v = typeof value === "object" && value !== null || typeof value === "function"
            ? value[sym] ?? value
            : value;
          if (sync === "host" || Reflect.set(obj, key, v)) {
            if (sync !== "vm") {
              setter(key, v);
            }
            return true;
          }
          return false;
        }
      })`)
    )
    .consume(wrapper => {
      return vm
        .newFunction("", (keyHandle, valueHandle) => {
          const key = unmarshal(keyHandle);
          const value = unmarshal(valueHandle);
          target[key] = value;
        })
        .consume(setter => {
          return vm.unwrapResult(
            vm.callFunction(
              wrapper,
              vm.undefined,
              handle,
              setter,
              proxyKeySymbol,
              vm.newString(sync)
            )
          );
        });
    });
}

export default marshal;
