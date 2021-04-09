import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalArray from "./array";
import unmarshalFunction from "./function";
import unmarshalObject from "./object";
import unmarshalPrimitive from "./primitive";
import VMMap from "../vmmap";
import { isObject } from "../util";

export type SyncMode = "both" | "vm";

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
  const preUnmarshal = (target: unknown, h: QuickJSHandle) => {
    map.set(target, h);
  };

  const result =
    unmarshalArray(vm, handle, unmarshal2, preUnmarshal) ??
    unmarshalFunction(vm, handle, marshal, unmarshal2, preUnmarshal) ??
    unmarshalObject(vm, handle, unmarshal2, preUnmarshal);

  if (sync && isObject(result) && proxyKeySymbol) {
    const target = wrap(sync, vm, result, handle, marshal, proxyKeySymbol);
    map.deleteByHandle(handle);
    map.set(target, handle);
    return [target, false];
  }

  return [result, false];
}

function wrap<T extends object = any>(
  sync: SyncMode,
  vm: QuickJSVm,
  target: T,
  handle: QuickJSHandle,
  marshal: (target: any) => QuickJSHandle,
  proxyKeySymbol: symbol
): T {
  return new Proxy(target, {
    get(obj, key) {
      return key === proxyKeySymbol ? obj : Reflect.get(obj, key);
    },
    set(obj, key, value) {
      const v = isObject(value)
        ? (value as any)[proxyKeySymbol] ?? value
        : value;

      if (sync === "vm") {
        vm.setProp(handle, key as string, marshal(v));
        return true;
      }

      if (Reflect.set(obj, key, v)) {
        vm.setProp(handle, key as string, marshal(v));
        return true;
      }
      return false;
    },
  });
}

export default unmarshal;
