import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { isObject } from "./util";

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

  return new Proxy(target as any, {
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
          handle2.consume(h => vm.setProp(h, key as string, marshal(v)));
        } else {
          vm.setProp(handle2, key as string, marshal(v));
        }
        return true;
      }
      return false;
    },
  }) as Wrapped<T>;
}

export function wrapHandle(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  proxyKeySymbol: symbol,
  proxyKeySymbolHandle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => any,
  syncMode?: (target: QuickJSHandle) => SyncMode | undefined
): Wrapped<QuickJSHandle> | undefined {
  if (!isHandleObject(vm, handle)) return undefined;
  if (isHandleWrapped(vm, handle, proxyKeySymbolHandle)) return handle;

  return consumeAll(
    [
      vm.newFunction("", h => {
        const res = syncMode?.(unmarshal(h));
        if (typeof res === "string") return vm.newString(res);
        return vm.undefined;
      }),
      vm.unwrapResult(
        vm.evalCode(`(target, setter, sym, getSyncMode) => new Proxy(target, {
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
              return true;
            }
            return false;
          }
      })`)
      ),
      vm.newFunction("", (h, keyHandle, valueHandle) => {
        const target = unmarshal(h);
        if (!target) return;
        const key = unmarshal(keyHandle);
        const value = unmarshal(valueHandle);
        unwrap(target, proxyKeySymbol)[key] = value;
      }),
    ],
    ([getSyncMode, wrapper, setter]) =>
      vm.unwrapResult(
        vm.callFunction(
          wrapper,
          vm.undefined,
          handle,
          setter,
          proxyKeySymbolHandle,
          getSyncMode
        )
      ) as Wrapped<QuickJSHandle>
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
  return [
    vm
      .unwrapResult(vm.evalCode(`(a, b) => a[b]`))
      .consume(f =>
        vm.unwrapResult(vm.callFunction(f, vm.undefined, handle, key))
      ),
    true,
  ];
}

export function isWrapped<T>(obj: T, key: string | symbol): obj is Wrapped<T> {
  return isObject(obj) && !!(obj as any)[key];
}

export function isHandleWrapped(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  key: QuickJSHandle
): handle is Wrapped<QuickJSHandle> {
  return vm
    .unwrapResult(
      vm.evalCode(
        `(a, s) => (typeof a === "object" && a !== null || typeof a === "function") && !!a[s]`
      )
    )
    .consume(f =>
      vm.dump(vm.unwrapResult(vm.callFunction(f, vm.undefined, handle, key)))
    );
}

export function isHandleObject(vm: QuickJSVm, handle: QuickJSHandle): boolean {
  return vm
    .unwrapResult(
      vm.evalCode(
        `a => typeof a === "object" && a !== null || typeof a === "function"`
      )
    )
    .consume(f =>
      vm.dump(vm.unwrapResult(vm.callFunction(f, vm.undefined, handle)))
    );
}

export function consumeAll<T extends QuickJSHandle[], K>(
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
