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
  proxyKeySymbol?: QuickJSHandle;
  unmarshal: (handle: QuickJSHandle) => unknown;
  isMarshalable?: (target: unknown) => boolean;
  syncMode?: (target: unknown) => SyncMode | undefined;
};

export function marshal(target: unknown, options: Options): QuickJSHandle {
  const {
    vm,
    map,
    proxyKeySymbol,
    unmarshal,
    isMarshalable,
    syncMode,
  } = options;

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
      isObject(target) && proxyKeySymbol
        ? wrap(vm, target, handle, proxyKeySymbol, unmarshal, syncMode)
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
  vm: QuickJSVm,
  target: any,
  handle: QuickJSHandle,
  proxyKeySymbol: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => any,
  syncMode?: (target: unknown) => SyncMode | undefined
): QuickJSHandle {
  return consumeAll(
    [
      handle,
      vm.newFunction("", () => {
        const res = syncMode?.(target);
        if (typeof res === "string") return vm.newString(res);
        return vm.undefined;
      }),
      vm.unwrapResult(
        vm.evalCode(`(target, setter, sym, getSyncMode) => new Proxy(target, {
          get(obj, key) {
            return key === sym ? obj : Reflect.get(obj, key)
          },
          set(obj, key, value) {
            const v = typeof value === "object" && value !== null || typeof value === "function"
              ? value[sym] ?? value
              : value;
            const sync = getSyncMode() ?? "vm";
            if (sync === "host" || Reflect.set(obj, key, v)) {
              if (sync !== "vm") {
                setter(key, v);
              }
              return true;
            }
            return false;
          }
      })`)
      ),
      vm.newFunction("", (keyHandle, valueHandle) => {
        const key = unmarshal(keyHandle);
        const value = unmarshal(valueHandle);
        target[key] = value;
      }),
    ],
    ([handle2, getSyncMode, wrapper, setter]) =>
      vm.unwrapResult(
        vm.callFunction(
          wrapper,
          vm.undefined,
          handle2,
          setter,
          proxyKeySymbol,
          getSyncMode
        )
      )
  );
}

function consumeAll<T extends QuickJSHandle[], K>(
  handles: T,
  cb: (handles: T) => K
) {
  try {
    return cb(handles);
  } finally {
    for (const h of handles) {
      if (h.alive) h.dispose();
    }
  }
}

export default marshal;
