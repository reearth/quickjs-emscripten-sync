import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import marshalArray from "./array";
import marshalFunction from "./function";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";
import VMMap from "../vmmap";
import { isObject } from "..";

export type SyncMode = "both" | "host";

export type Options = {
  vm: QuickJSVm;
  map: VMMap;
  isMarshalable?: (target: any) => boolean;
  unmarshal: (handle: QuickJSHandle) => unknown;
  proxyKeySymbol?: QuickJSHandle;
  sync?: SyncMode;
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

  const result =
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
    options.vm.undefined;

  const pks = options.proxyKeySymbol;
  const syncMode = options.sync;
  if (syncMode && isObject(target) && pks) {
    const result2 = result.consume(h =>
      wrap(syncMode, options.vm, target, h, options.unmarshal, pks)
    );
    options.map.delete(target);
    options.map.set(target, result2);
    return result2;
  }

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

          if (sync === "host") {
            setter(key, v);
            return true;
          }

          if (Reflect.set(obj, key, v)) {
            setter(key, v);
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
