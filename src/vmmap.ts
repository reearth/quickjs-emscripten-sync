import type { QuickJSContext, QuickJSHandle } from "quickjs-emscripten";

import { unwrapResult } from "./vmutil";

/**
 * Bidirectional map between host values and QuickJS handles.
 *
 * Each registered pair gets a numeric id. A value may be registered under two
 * keys (e.g. a proxy-wrapped object and the underlying object), each with its
 * own handle, so every lookup direction is backed by an explicit map and id
 * reverse-lookups, keeping `delete` O(1).
 */
export default class VMMap {
  ctx: QuickJSContext;
  _keyToId = new Map<any, number>();
  _key2ToId = new Map<any, number>();
  _idToHandle = new Map<number, QuickJSHandle>();
  _idToHandle2 = new Map<number, QuickJSHandle>();
  _idToKey = new Map<number, any>();
  _idToKey2 = new Map<number, any>();
  _disposables = new Set<QuickJSHandle>();
  _mapGet: QuickJSHandle;
  _mapSet: QuickJSHandle;
  _mapDelete: QuickJSHandle;
  _mapClear: QuickJSHandle;
  _nextId = Number.MIN_SAFE_INTEGER;

  constructor(ctx: QuickJSContext) {
    this.ctx = ctx;

    const result = ctx
      .unwrapResult(
        ctx.evalCode(`() => {
        const mapSym = new Map();
        let map = new WeakMap();
        let map2 = new WeakMap();
        const isObj = o => typeof o === "object" && o !== null || typeof o === "function";
        return {
          get: key => mapSym.get(key) ?? map.get(key) ?? map2.get(key) ?? -1,
          set: (key, value, key2) => {
            if (typeof key === "symbol") mapSym.set(key, value);
            if (isObj(key)) map.set(key, value);
            if (isObj(key2)) map2.set(key2, value);
          },
          delete: (key, key2) => {
            mapSym.delete(key);
            map.delete(key);
            map2.delete(key2);
          },
          clear: () => {
            mapSym.clear();
            map = new WeakMap();
            map2 = new WeakMap();
          }
        };
      }`),
      )
      .consume(fn => this._call(fn, undefined));

    this._mapGet = ctx.getProp(result, "get");
    this._mapSet = ctx.getProp(result, "set");
    this._mapDelete = ctx.getProp(result, "delete");
    this._mapClear = ctx.getProp(result, "clear");

    result.dispose();

    this._disposables.add(this._mapGet);
    this._disposables.add(this._mapSet);
    this._disposables.add(this._mapDelete);
    this._disposables.add(this._mapClear);
  }

  set(key: any, handle: QuickJSHandle, key2?: any, handle2?: QuickJSHandle): boolean {
    if (!handle.alive || (handle2 && !handle2.alive)) return false;

    const v = this.get(key) ?? this.get(key2);
    if (v) {
      // handle and handle2 are unused so they should be disposed
      return v === handle || v === handle2;
    }

    const id = this._nextId++;
    this._keyToId.set(key, id);
    this._idToHandle.set(id, handle);
    this._idToKey.set(id, key);
    if (key2) {
      this._key2ToId.set(key2, id);
      this._idToKey2.set(id, key2);
      if (handle2) {
        this._idToHandle2.set(id, handle2);
      }
    }

    this.ctx.newNumber(id).consume(c => {
      this._call(this._mapSet, undefined, handle, c, handle2 ?? this.ctx.undefined);
    });

    return true;
  }

  merge(
    iteratable:
      | Iterable<
          | [any, QuickJSHandle | undefined]
          | [any, QuickJSHandle | undefined, any, QuickJSHandle | undefined]
        >
      | undefined,
  ) {
    if (!iteratable) return;
    for (const iter of iteratable) {
      if (!iter) continue;
      if (iter[1]) {
        this.set(iter[0], iter[1], iter[2], iter[3]);
      }
    }
  }

  get(key: any) {
    const id = this._keyToId.get(key) ?? this._key2ToId.get(key);
    const handle = typeof id === "number" ? this._idToHandle.get(id) : undefined;

    if (!handle) return;
    if (!handle.alive) {
      // The primary handle was freed by the VM, so this entry is stale. Dispose
      // its sibling handle while evicting it: otherwise the sibling (e.g. the
      // unwrapped handle registered alongside a proxy) is orphaned and leaks
      // when the same value is marshalled again.
      this.delete(key, true);
      return;
    }

    return handle;
  }

  getByHandle(handle: QuickJSHandle) {
    if (!handle.alive) {
      return;
    }
    return this._idToKey.get(this.ctx.getNumber(this._call(this._mapGet, undefined, handle)));
  }

  has(key: any) {
    return !!this.get(key);
  }

  hasHandle(handle: QuickJSHandle) {
    return typeof this.getByHandle(handle) !== "undefined";
  }

  keys() {
    return this._keyToId.keys();
  }

  delete(key: any, dispose?: boolean) {
    const id = this._keyToId.get(key) ?? this._key2ToId.get(key);
    if (typeof id === "undefined") return;

    const handle = this._idToHandle.get(id);
    const handle2 = this._idToHandle2.get(id);
    this._call(
      this._mapDelete,
      undefined,
      ...[handle, handle2].filter((h): h is QuickJSHandle => !!h?.alive),
    );

    const key1 = this._idToKey.get(id);
    const key2 = this._idToKey2.get(id);
    if (typeof key1 !== "undefined") this._keyToId.delete(key1);
    if (typeof key2 !== "undefined") this._key2ToId.delete(key2);
    this._idToHandle.delete(id);
    this._idToHandle2.delete(id);
    this._idToKey.delete(id);
    this._idToKey2.delete(id);

    if (dispose) {
      if (handle?.alive) handle.dispose();
      if (handle2?.alive) handle2.dispose();
    }
  }

  deleteByHandle(handle: QuickJSHandle, dispose?: boolean) {
    const key = this.getByHandle(handle);
    if (typeof key !== "undefined") {
      this.delete(key, dispose);
    }
  }

  clear() {
    this._nextId = 0;
    this._keyToId.clear();
    this._key2ToId.clear();
    this._idToHandle.clear();
    this._idToHandle2.clear();
    this._idToKey.clear();
    this._idToKey2.clear();
    if (this._mapClear.alive) {
      this._call(this._mapClear, undefined);
    }
  }

  dispose() {
    for (const v of this._disposables.values()) {
      if (v.alive) {
        v.dispose();
      }
    }
    for (const v of this._idToHandle.values()) {
      if (v.alive) {
        v.dispose();
      }
    }
    for (const v of this._idToHandle2.values()) {
      if (v.alive) {
        v.dispose();
      }
    }
    this._disposables.clear();
    this.clear();
  }

  get size() {
    return this._keyToId.size;
  }

  [Symbol.iterator](): Iterator<[any, QuickJSHandle, any, QuickJSHandle | undefined]> {
    const keys = this._keyToId.keys();
    return {
      next: () => {
        while (true) {
          const k1 = keys.next();
          if (k1.done) return { value: undefined, done: true };
          const id = this._keyToId.get(k1.value);
          if (typeof id === "undefined") continue;
          const v1 = this._idToHandle.get(id);
          const v2 = this._idToHandle2.get(id);
          if (!v1) continue;
          const k2 = this._idToKey2.get(id);
          return { value: [k1.value, v1, k2, v2], done: false };
        }
      },
    };
  }

  _call(fn: QuickJSHandle, thisArg: QuickJSHandle | undefined, ...args: QuickJSHandle[]) {
    return unwrapResult(
      this.ctx,
      this.ctx.callFunction(
        fn,
        typeof thisArg === "undefined" ? this.ctx.undefined : thisArg,
        ...args,
      ),
    );
  }
}
