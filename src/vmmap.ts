import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default class VMMap {
  vm: QuickJSVm;
  _map: Map<any, QuickJSHandle> = new Map();
  _counterMap: Map<number, any> = new Map();
  _disposables: Set<QuickJSHandle> = new Set();
  _mapGet: QuickJSHandle;
  _mapSet: QuickJSHandle;
  _mapDelete: QuickJSHandle;
  _mapClear: QuickJSHandle;
  _proxyTarget: QuickJSHandle;
  _counter = 0;

  constructor(vm: QuickJSVm, symbol?: QuickJSHandle) {
    this.vm = vm;

    const fn = vm.unwrapResult(
      vm.evalCode(`(proxyTarget) => {
        let map = new WeakMap();
        const unwrap = (obj) => {
          return typeof proxyTarget === "symbol" && (typeof obj === "object" && obj !== null || typeof obj === "function") ? (obj?.[proxyTarget] ?? obj) : obj;
        };
        return {
          get: key => map.get(unwrap(key)) ?? -1,
          set: (key, value) => { if (typeof key === "object" && key !== null || typeof key === "function") map.set(unwrap(key), value); },
          delete: key => map.delete(unwrap(key)),
          clear: () => { map = new WeakMap(); },
          proxyTarget
        };
      }`)
    );

    const result = this._call(fn, undefined, symbol ?? vm.undefined);
    this._mapGet = vm.getProp(result, "get");
    this._mapSet = vm.getProp(result, "set");
    this._mapDelete = vm.getProp(result, "delete");
    this._mapClear = vm.getProp(result, "clear");
    this._proxyTarget = vm.getProp(result, "proxyTarget");
    fn.dispose();
    result.dispose();
    this._disposables.add(this._mapGet);
    this._disposables.add(this._mapSet);
    this._disposables.add(this._mapDelete);
    this._disposables.add(this._mapClear);
    this._disposables.add(this._proxyTarget);
  }

  proxyTarget() {
    return this._proxyTarget;
  }

  set(key: any, value: QuickJSHandle) {
    if (this.setUnsafe(key, value)) {
      // Needed to avoid dangling handles
      throw new Error("handle already exists that points to the same value");
    }
  }

  setUnsafe(key: any, value: QuickJSHandle) {
    if (!value.alive) return false;

    const v = this.get(key);
    if (v) {
      return v !== value;
    }

    const counter = this._counter++;
    this._map.set(key, value);
    this._counterMap.set(counter, key);
    this.vm.newNumber(counter).consume(c => {
      this._call(this._mapSet, undefined, value, c);
    });

    return false;
  }

  merge(map: Iterable<[any, QuickJSHandle | undefined]> | undefined) {
    if (!map) return;
    for (const [o, h] of map) {
      if (h) {
        this.set(o, h);
      }
    }
  }

  get(key: any) {
    const handle = this._map.get(key);
    if (!handle) return;
    if (!handle.alive) {
      this.delete(key);
      return;
    }
    return handle;
  }

  getByHandle(handle: QuickJSHandle) {
    if (!handle.alive) {
      return;
    }
    return this._counterMap.get(
      this.vm.getNumber(this._call(this._mapGet, undefined, handle))
    );
  }

  has(key: any) {
    return !!this._map.get(key);
  }

  delete(key: any) {
    const handle = this._map.get(key);
    if (handle?.alive) {
      this._call(this._mapDelete, undefined, handle);
    }
    this._map.delete(key);
    for (const [k, v] of this._counterMap) {
      if (v === key) {
        this._counterMap.delete(k);
        return;
      }
    }
  }

  deleteByHandle(handle: QuickJSHandle) {
    const key = this.getByHandle(handle);
    if (typeof key !== "undefined") {
      this.delete(key);
    }
  }

  consume<T = void>(
    key: any,
    fn?: (handle: QuickJSHandle) => T
  ): T | undefined {
    const handle = this.get(key);
    if (!handle) return;
    this.delete(key);
    if (fn && handle) {
      return handle.consume(fn);
    }
    return;
  }

  consumeByHandle<T = void>(
    handle: QuickJSHandle,
    fn?: (handle: QuickJSHandle) => T
  ): T | undefined {
    const key = this.getByHandle(handle);
    if (typeof key === "undefined") return;
    const handle2 = this.get(key);
    this.delete(key);
    if (fn && handle2) {
      return handle2.consume(fn);
    }
    return;
  }

  get size() {
    return this._map.size;
  }

  cleanup() {
    for (const [k, v] of this._map) {
      if (!v.alive) {
        this._map.delete(k);
      }
    }
  }

  clear() {
    this._map.clear();
    this._counterMap.clear();
    if (this._mapClear.alive) {
      this._call(this._mapClear, undefined);
    }
    this._counter = 0;
  }

  entries() {
    return this._map.entries();
  }

  values() {
    return this._map.values();
  }

  dispose() {
    for (const v of this._disposables.values()) {
      if (v.alive) {
        v.dispose();
      }
    }
    for (const v of this._map.values()) {
      if (v.alive) {
        v.dispose();
      }
    }
    this._disposables.clear();
    this.clear();
  }

  [Symbol.iterator](): Iterator<[any, QuickJSHandle]> {
    const keys = this._map.keys();
    return {
      next: () => {
        while (true) {
          const k = keys.next();
          if (k.done) return { value: undefined, done: true };
          const v = this.get(k.value);
          if (!v) continue;
          return { value: [k.value, v], done: false };
        }
      },
    };
  }

  _call(
    fn: QuickJSHandle,
    thisArg: QuickJSHandle | undefined,
    ...args: QuickJSHandle[]
  ) {
    return this.vm.unwrapResult(
      this.vm.callFunction(
        fn,
        typeof thisArg === "undefined" ? this.vm.undefined : thisArg,
        ...args
      )
    );
  }
}
