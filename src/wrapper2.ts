import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { call, consumeAll } from "./vmutil";

// experimental implementation

export function wrap(
  vm: QuickJSVm,
  symbol: symbol,
  marshal: (target: any) => QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => [any, boolean]
): any {
  const rec = new Proxy(
    {},
    {
      get(_, key) {
        if (key === symbol) return true;
        const handle = marshal(rec);
        const value = vm.getProp(handle, marshal(key));
        return disposeAndUnwrap(value, unmarshal(value));
      },
      getPrototypeOf() {
        const handle = marshal(rec);
        const proto = call(vm, `Object.getPrototypeOf`, undefined, handle);
        return disposeAndUnwrap(proto, unmarshal(proto));
      },
      getOwnPropertyDescriptor(_, key) {
        const handle = marshal(rec);
        const keyHandle = marshal(key);
        return call(
          vm,
          `Object.getOwnPropertyDescriptor`,
          undefined,
          handle,
          keyHandle
        ).consume(h => {
          const [res] = unmarshal(h);
          return res;
        });
      },
      ownKeys() {
        const handle = marshal(rec);
        return call(vm, `Reflect.ownKeys`, undefined, handle).consume(h => {
          const [res] = unmarshal(h);
          return res;
        });
      },
      has(_, key) {
        const handle = marshal(rec);
        const keyHandle = marshal(key);
        return call(vm, `Reflect.has`, undefined, handle, keyHandle).consume(
          h => {
            const [res] = unmarshal(h);
            return res;
          }
        );
      },
    }
  );
  return rec;
}

export function wrapHandle(
  vm: QuickJSVm,
  symbol: QuickJSHandle,
  marshal: (target: any) => QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => any
): QuickJSHandle {
  const handle2 = consumeAll(
    [
      vm.newFunction("get", (h, keyHandle) => {
        const target = unmarshal(h);
        const key = unmarshal(keyHandle);
        return marshal(target[key]);
      }),
      vm.newFunction("getPO", h => {
        const target = unmarshal(h);
        return marshal(Object.getPrototypeOf(target));
      }),
      vm.newFunction("getOPD", (h, keyHandle) => {
        const target = unmarshal(h);
        const key = unmarshal(keyHandle);
        return marshal(Object.getOwnPropertyDescriptor(target, key));
      }),
      vm.newFunction("ownKeys", h => {
        const target = unmarshal(h);
        return marshal(Reflect.ownKeys(target));
      }),
      vm.newFunction("has", (h, keyHandle) => {
        const target = unmarshal(h);
        const key = unmarshal(keyHandle);
        return marshal(Reflect.has(target, key));
      }),
    ],
    args => {
      return call(
        vm,
        `(symbol, get, getPO, getOPD, ownKeys, has) => {
          const rec = new Proxy({}, {
            get(_, key) {
              if (key === symbol) return true;
              return get(rec, key);
            },
            getPrototypeOf() {
              return getPO(rec);
            },
            getOwnPropertyDescriptor(_, key) {
              return getOPD(rec, key);
            },
            ownKeys() {
              return ownKeys(rec);
            },
            has(_, key) {
              return has(rec, key);
            }
          });
          return rec;
        }`,
        undefined,
        symbol,
        ...args
      );
    }
  );
  return handle2;
}

function disposeAndUnwrap<T>(handle: QuickJSHandle, result: [T, boolean]): T {
  if (result[1]) {
    handle.dispose();
  }
  return result[0];
}
