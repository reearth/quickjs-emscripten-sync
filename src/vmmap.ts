import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default class VMMap {
  vm: QuickJSVm;
  _map: Map<any, QuickJSHandle> = new Map();
  _counterMap: Map<number, any> = new Map();
  _disposables: Set<QuickJSHandle> = new Set();
  _mapGet: QuickJSHandle;
  _mapSet: QuickJSHandle;
  _mapDelete: QuickJSHandle;
  _proxyTarget: QuickJSHandle;
  _counter = 0;

  constructor(vm: QuickJSVm, symbol?: QuickJSHandle) {
    this.vm = vm;

    const fn = vm.unwrapResult(
      vm.evalCode(`(proxyTarget) => {
        const map = new WeakMap();
        const unwrap = (obj) => {
          return typeof proxyTarget === "symbol" && (typeof obj === "object" && obj !== null || typeof obj === "function") ? (obj?.[proxyTarget] ?? obj) : obj;
        };
        return {
          get: key => map.get(unwrap(key)) ?? -1,
          set: (key, value) => { if (typeof key === "object" && key !== null || typeof key === "function") map.set(unwrap(key), value); },
          delete: key => map.delete(unwrap(key)),
          proxyTarget
        };
      }`)
    );

    const result = this._call(fn, undefined, symbol ?? vm.undefined);
    this._mapGet = vm.getProp(result, "get");
    this._mapSet = vm.getProp(result, "set");
    this._mapDelete = vm.getProp(result, "delete");
    this._proxyTarget = vm.getProp(result, "proxyTarget");
    fn.dispose();
    result.dispose();
    this._disposables.add(this._mapGet);
    this._disposables.add(this._mapSet);
    this._disposables.add(this._mapDelete);
    this._disposables.add(this._proxyTarget);
  }

  proxyTarget() {
    return this._proxyTarget;
  }

  set(key: any, value: QuickJSHandle) {
    const counter = this._counter++;
    this._map.set(key, value);
    this._counterMap.set(counter, key);
    this.vm.newNumber(counter).consume(c => {
      this._call(this._mapSet, undefined, value, c);
    });
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

  get size() {
    return this._map.size;
  }

  cleanup() {
    for (const v of this._disposables) {
      if (!v.alive) {
        this._disposables.delete(v);
      }
    }
    for (const [k, v] of this._map) {
      if (!v.alive) {
        this._map.delete(k);
      }
    }
  }

  clear() {
    this._map.clear();
    this._counterMap.clear();
  }

  entries() {
    return this._map.entries();
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

  [Symbol.iterator](): Iterator<
    [any, QuickJSHandle | undefined],
    [any, QuickJSHandle | undefined]
  > {
    const keys = this._map.keys();
    return {
      next: () => {
        const k = keys.next();
        const v = this.get(k);
        return { value: [k.value, v], done: !!k.done };
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