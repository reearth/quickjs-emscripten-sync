import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalArray from "./array";
import unmarshalFunction from "./function";
import unmarshalObject from "./object";
import unmarshalPrimitive from "./primitive";
import VMMap from "../vmmap";
import { isObject } from "../util";

export type SyncMode = "both" | "vm" | "host";

export type Options = {
  vm: QuickJSVm;
  map: VMMap;
  proxyKeySymbol?: symbol;
  marshal: (target: unknown) => QuickJSHandle;
  syncMode?: (target: unknown) => SyncMode | undefined;
};

export function unmarshal(handle: QuickJSHandle, options: Options): any {
  const [result] = unmarshalInner(handle, options);
  return result;
}

function unmarshalInner(
  handle: QuickJSHandle,
  options: Options
): [any, boolean] {
  const { vm, map, marshal, proxyKeySymbol, syncMode } = options;

  if (vm !== map.vm) {
    throw new Error("vm and map.vm do not match");
  }

  {
    const [target, ok] = unmarshalPrimitive(vm, handle);
    if (ok) return [target, false];
  }

  {
    const target = map.getByHandle(handle);
    if (target) {
      return [target, true];
    }
  }

  const unmarshal2 = (h: QuickJSHandle) => unmarshalInner(h, options);
  const preUnmarshal = (target: any, h: QuickJSHandle): any => {
    const key =
      isObject(target) && proxyKeySymbol
        ? wrap(vm, target, proxyKeySymbol, marshal, syncMode)
        : target;
    map.set(key, h);
    return key;
  };

  const result =
    unmarshalArray(vm, handle, unmarshal2, preUnmarshal) ??
    unmarshalFunction(vm, handle, marshal, unmarshal2, preUnmarshal) ??
    unmarshalObject(vm, handle, unmarshal2, preUnmarshal);

  return [result, false];
}

function wrap<T extends object = any>(
  vm: QuickJSVm,
  target: T,
  proxyKeySymbol: symbol,
  marshal: (target: any) => QuickJSHandle,
  syncMode?: (target: T) => SyncMode | undefined
): T {
  return new Proxy(target, {
    get(obj, key) {
      return key === proxyKeySymbol ? obj : Reflect.get(obj, key);
    },
    set(obj, key, value, receiver) {
      const v = isObject(value)
        ? (value as any)[proxyKeySymbol] ?? value
        : value;
      const sync = syncMode?.(receiver) ?? "host";
      if (sync === "vm" || Reflect.set(obj, key, v, receiver)) {
        if (sync === "host") return true;
        vm.setProp(marshal(receiver), key as string, marshal(v));
        return true;
      }
      return false;
    },
  });
}

export default unmarshal;
