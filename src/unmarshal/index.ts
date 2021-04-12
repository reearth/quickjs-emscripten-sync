import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalArray from "./array";
import unmarshalFunction from "./function";
import unmarshalObject from "./object";
import unmarshalPrimitive from "./primitive";
import VMMap from "../vmmap";
import { isObject } from "../util";

export type SyncMode = "both" | "vm" | "host";

export function unmarshal(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  map: VMMap,
  marshal: (target: unknown) => QuickJSHandle,
  proxyKeySymbol?: symbol,
  sync?: SyncMode
): any {
  const [result] = unmarshalInner(
    vm,
    handle,
    map,
    marshal,
    proxyKeySymbol,
    sync
  );
  return result;
}

function unmarshalInner(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  map: VMMap,
  marshal: (target: unknown) => QuickJSHandle,
  proxyKeySymbol?: symbol,
  sync?: SyncMode
): [any, boolean] {
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

  const unmarshal2 = (h: QuickJSHandle) =>
    unmarshalInner(vm, h, map, marshal, proxyKeySymbol, sync);
  const preUnmarshal = (target: any, h: QuickJSHandle): any => {
    const key =
      sync && isObject(target) && proxyKeySymbol
        ? wrap(sync, vm, target, marshal, proxyKeySymbol)
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
  sync: SyncMode,
  vm: QuickJSVm,
  target: T,
  marshal: (target: any) => QuickJSHandle,
  proxyKeySymbol: symbol
): T {
  return new Proxy(target, {
    get(obj, key) {
      return key === proxyKeySymbol ? obj : Reflect.get(obj, key);
    },
    set(obj, key, value, receiver) {
      const v = isObject(value)
        ? (value as any)[proxyKeySymbol] ?? value
        : value;
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
