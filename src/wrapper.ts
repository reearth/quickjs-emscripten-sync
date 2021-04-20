import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { isObject } from "./util";
import { call, isHandleObject, consumeAll } from "./vmutil";

export type SyncMode = "both" | "vm" | "host";

export type Wrapped<T> = T & { __qes_wrapped: never };

export function wrap<T = any>(
  vm: QuickJSVm,
  target: T,
  proxyKeySymbol: symbol,
  proxyKeySymbolHandle: QuickJSHandle,
  marshal: (target: any) => QuickJSHandle,
  syncMode?: (target: T) => SyncMode | undefined
): Wrapped<T> | undefined {
  if (!isObject(target)) return undefined;
  if (isWrapped(target, proxyKeySymbol)) return target;

  const rec = new Proxy(target as any, {
    get(obj, key) {
      return key === proxyKeySymbol ? obj : Reflect.get(obj, key);
    },
    set(obj, key, value, receiver) {
      const v = unwrap(value, proxyKeySymbol);
      const sync = syncMode?.(receiver) ?? "host";
      if (sync === "vm" || Reflect.set(obj, key, v, receiver)) {
        if (sync === "host") return true;
        const [handle2, unwrapped] = unwrapHandle(
          vm,
          marshal(receiver),
          proxyKeySymbolHandle
        );
        if (unwrapped) {
          handle2.consume(h => vm.setProp(h, marshal(key), marshal(v)));
        } else {
          vm.setProp(handle2, marshal(key), marshal(v));
        }
      }
      return true;
    },
    deleteProperty(obj, key) {
      const sync = syncMode?.(rec) ?? "host";
      const [handle2, unwrapped] = unwrapHandle(
        vm,
        marshal(rec),
        proxyKeySymbolHandle
      );
      if (sync === "vm" || Reflect.deleteProperty(obj, key)) {
        if (sync === "host") return true;
        if (unwrapped) {
          handle2.consume(h =>
            call(vm, `(a, b) => delete a[b]`, undefined, h, marshal(key))
          );
        } else {
          call(vm, `(a, b) => delete a[b]`, undefined, handle2, marshal(key));
        }
      }
      return true;
    },
  }) as Wrapped<T>;
  return rec;
}

export function wrapHandle(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  proxyKeySymbol: symbol,
  proxyKeySymbolHandle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => any,
  syncMode?: (target: QuickJSHandle) => SyncMode | undefined
): [Wrapped<QuickJSHandle> | undefined, boolean] {
  if (!isHandleObject(vm, handle)) return [undefined, false];
  if (isHandleWrapped(vm, handle, proxyKeySymbolHandle)) return [handle, false];

  return consumeAll(
    [
      vm.newFunction("getSyncMode", h => {
        const res = syncMode?.(unmarshal(h));
        if (typeof res === "string") return vm.newString(res);
        return vm.undefined;
      }),
      vm.newFunction("setter", (h, keyHandle, valueHandle) => {
        const target = unmarshal(h);
        if (!target) return;
        const key = unmarshal(keyHandle);
        if (key === "__proto__") return; // for security
        const value = unmarshal(valueHandle);
        unwrap(target, proxyKeySymbol)[key] = value;
      }),
      vm.newFunction("deleter", (h, keyHandle) => {
        const target = unmarshal(h);
        if (!target) return;
        const key = unmarshal(keyHandle);
        delete unwrap(target, proxyKeySymbol)[key];
      }),
    ],
    args => [
      call(
        vm,
        `(target, sym, getSyncMode, setter, deleter) => {
          const rec =  new Proxy(target, {
            get(obj, key, receiver) {
              return key === sym ? obj : Reflect.get(obj, key, receiver)
            },
            set(obj, key, value, receiver) {
              const v = typeof value === "object" && value !== null || typeof value === "function"
                ? value[sym] ?? value
                : value;
              const sync = getSyncMode(receiver) ?? "vm";
              if (sync === "host" || Reflect.set(obj, key, v, receiver)) {
                if (sync !== "vm") {
                  setter(receiver, key, v);
                }
              }
              return true;
            },
            deleteProperty(obj, key) {
              const sync = getSyncMode(rec) ?? "vm";
              if (sync === "host" || Reflect.deleteProperty(obj, key)) {
                if (sync !== "vm") {
                  deleter(rec, key);
                }
              }
              return true;
            },
          });
          return rec;
        }`,
        undefined,
        handle,
        proxyKeySymbolHandle,
        ...args
      ) as Wrapped<QuickJSHandle>,
      true,
    ]
  );
}

export function unwrap<T>(obj: T, key: string | symbol): T {
  return isObject(obj) ? ((obj as any)[key] as T) ?? obj : obj;
}

export function unwrapHandle(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  key: QuickJSHandle
): [QuickJSHandle, boolean] {
  if (!isHandleWrapped(vm, handle, key)) return [handle, false];
  return [vm.getProp(handle, key), true];
}

export function isWrapped<T>(obj: T, key: string | symbol): obj is Wrapped<T> {
  return isObject(obj) && !!(obj as any)[key];
}

export function isHandleWrapped(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  key: QuickJSHandle
): handle is Wrapped<QuickJSHandle> {
  return !!vm.dump(
    call(
      vm,
      `(a, s) => (typeof a === "object" && a !== null || typeof a === "function") && !!a[s]`,
      undefined,
      handle,
      key
    )
  );
}
