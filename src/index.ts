import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import VMMap from "./vmmap";
import marshal from "./marshal";
import unmarshal from "./unmarshal";
import { complexity, isES2015Class, isObject, walkObject } from "./util";

export {
  Arena,
  VMMap,
  marshal,
  unmarshal,
  complexity,
  isES2015Class,
  isObject,
  walkObject,
};

export type Options = {
  isMarshalable?: (target: any) => boolean;
};

export default class Arena {
  vm: QuickJSVm;
  _map: VMMap;
  _sync: VMSet;
  _symbol: QuickJSHandle;
  _symbol2 = Symbol();
  _setterHandle: QuickJSHandle;
  _syncHandle: QuickJSHandle;
  _options?: Options;

  constructor(vm: QuickJSVm, options?: Options) {
    this.vm = vm;
    this._options = options;
    this._symbol = vm.unwrapResult(vm.evalCode(`Symbol()`));
    this._map = new VMMap(vm, this._symbol);
    this._sync = new VMSet(vm, this._symbol);
    this._setterHandle = vm.newFunction("set", (robj, rkey, rvalue) => {
      const obj = this._map.getByHandle(robj);
      if (typeof obj === "undefined") return vm.false;

      const key = this._unmarshal(rkey);
      if (typeof key !== "string") return vm.false; // symbol is not supported

      const value = this._unmarshal(rvalue);
      return Reflect.set(obj, key, value) ? vm.true : vm.false;
    });
    this._syncHandle = vm.unwrapResult(
      vm.evalCode(`(name, object, setter, proxyTarget) => {
        const handler = {
          get(obj, key) {
            if (typeof proxyTarget === "symbol" && key === proxyTarget) {
              return Reflect.get(obj, proxyTarget) ?? obj;
            }
            const target = Reflect.get(obj, key);
            if (typeof target === "function" || (typeof target === "object" && target !== null)) {
              return new Proxy(target, handler);
            }
            return target;
          },
          set(obj, key, value) {
            return Reflect.set(obj, key, value) && setter(obj, key, value);
          }
        };
        globalThis[name] = new Proxy(object, handler);
      }`)
    );
  }

  evalCode(code: string): any {
    const result = this.vm.evalCode(code);
    if (!result) return undefined;
    if ("value" in result) {
      return result.value.consume(v => this._unmarshal(v));
    }
    throw result.error.consume(err => this._unmarshal(err));
  }

  expose<T extends { [k: string]: any }>(obj: T, sync?: boolean): T {
    const newobject = Object.entries(obj).map(([key, value]) => {
      const isSyncable = sync && isObject(value);
      const handle = this._marshal(value, isSyncable);

      if (isSyncable) {
        this.vm.newString(key).consume(n => {
          this.vm.unwrapResult(
            this.vm.callFunction(
              this._syncHandle,
              this.vm.undefined,
              n,
              handle,
              this._setterHandle,
              this._symbol
            )
          );
        });
      } else {
        this.vm.setProp(this.vm.global, key, handle);
      }

      return [key, new Proxy(value, this._proxyHandler(!isSyncable))] as const;
    });

    return Object.fromEntries(newobject) as T;
  }

  _unwrap(value: any): any {
    return isObject(value) ? (value as any)[this._symbol2] ?? value : value;
  }

  _proxyHandler = (vmOnly: boolean): ProxyHandler<any> => ({
    get: (o, key) => {
      if (key === this._symbol2) {
        return o;
      }
      const v = Reflect.get(o, key);
      return isObject(v) ? new Proxy(v, this._proxyHandler(vmOnly)) : v;
    },
    set: (o, key, value) => {
      const v = this._unwrap(value);

      if (vmOnly) {
        const o2 = this._map.get(o);
        if (o2) {
          this.vm.setProp(o2, key as any, this._marshal(v));
          // delete item to avoid gap of the value between host and vm
          this._map.delete(o);
          o2.dispose();
        }
        return true;
      }

      if (Reflect.set(o, key, v)) {
        const o2 = this._map.get(o);
        if (o2) {
          this.vm.setProp(o2, key as any, this._marshal(v));
        }
        return true;
      }
      return false;
    },
  });

  _marshal(target: any, sync?: boolean): QuickJSHandle {
    const map = new VMMap(this.vm);
    map.merge(this._map);
    const d = marshal(target, {
      vm: this.vm,
      map,
      unmarshal: v => this._unmarshal(v, true, !sync),
      isMarshalable: this._options?.isMarshalable,
      proxyKeySymbol: this._symbol,
    });
    this._map.merge(map);
    if (sync && isObject(target)) {
      this._sync.add(...map.values());
    }
    map.clear();
    map.dispose();
    return d;
  }

  _unmarshal(handle: QuickJSHandle, sync?: boolean, vmOnly?: boolean): any {
    const result = unmarshal(this.vm, handle, this._map, v =>
      this._marshal(v, sync)
    );

    if ((sync && isObject(result)) || this._sync.has(result)) {
      return new Proxy(result, this._proxyHandler(!!vmOnly));
    }

    return result;
  }

  dispose() {
    this._sync.dispose();
    this._map.dispose();
    this._setterHandle.dispose();
    this._syncHandle.dispose();
    this._symbol.dispose();
  }
}
