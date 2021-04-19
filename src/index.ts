import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import {
  SuccessOrFail,
  VmCallResult,
} from "quickjs-emscripten/dist/vm-interface";

import VMMap from "./vmmap";
import marshal from "./marshal";
import unmarshal from "./unmarshal";
import { wrap, wrapHandle, unwrap, unwrapHandle, Wrapped } from "./wrapper";
import { complexity, isES2015Class, isObject, walkObject } from "./util";
import { call, eq, isHandleObject, send, consumeAll } from "./vmutil";
import { defaultRegisteredObjects } from "./default";

export {
  Arena,
  VMMap,
  defaultRegisteredObjects,
  marshal,
  unmarshal,
  complexity,
  isES2015Class,
  isObject,
  walkObject,
  call,
  eq,
  isHandleObject,
  send,
  consumeAll
};

export type Options = {
  isMarshalable?: (target: any) => boolean;
  registeredObjects?: Iterable<[any, QuickJSHandle | string]>;
};


export default class Arena {
  vm: QuickJSVm;
  _map: VMMap;
  _registeredMap: VMMap;
  _registeredMapDispose: Set<any> = new Set();
  _sync: Set<any> = new Set();
  _temporalSync: Set<any> = new Set();
  _symbol = Symbol();
  _symbolHandle: QuickJSHandle;
  _options?: Options;

  constructor(vm: QuickJSVm, options?: Options) {
    this.vm = vm;
    this._options = options;
    this._symbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
    this._map = new VMMap(vm);
    this._registeredMap = new VMMap(vm);
    this.registerAll(options?.registeredObjects ?? defaultRegisteredObjects);
  }

  dispose() {
    this._map.dispose();
    this._registeredMap.dispose();
    this._symbolHandle.dispose();
  }

  evalCode<T = any>(code: string): T | undefined {
    let handle = this.vm.evalCode(code);
    return this._unwrapResultAndUnmarshal(handle);
  }

  executePendingJobs(maxJobsToExecute?: number): number {
    const result = this.vm.executePendingJobs(maxJobsToExecute);
    if ("value" in result) {
      return result.value;
    }
    throw result.error.consume(err => this._unmarshal(err));
  }

  expose<T extends { [k: string]: any }>(obj: T, sync?: boolean): T {
    const newobject = Object.entries(obj).map(([key, value]) => {
      const value2 = sync ? this._wrap(value) : value;
      const handle = this._marshal(value2);
      if (sync) {
        walkObject(value2, v => {
          this._sync.add(this._unwrap(v));
        });
      }
      this.vm.setProp(this.vm.global, key, handle);
      return [key, value2] as const;
    });
    return Object.fromEntries(newobject) as T;
  }

  startSync(target: any) {
    if (!isObject(target)) return;
    this._sync.add(this._unwrap(target));
  }

  endSync(target: any) {
    this._sync.delete(this._unwrap(target));
  }

  register(target: any, handleOrCode: QuickJSHandle | string) {
    if (this._registeredMap.has(target)) return;
    const handle =
      typeof handleOrCode === "string"
        ? this._unwrapResult(this.vm.evalCode(handleOrCode))
        : handleOrCode;
    if (typeof handleOrCode === "string") {
      this._registeredMapDispose.add(target);
    }
    this._registeredMap.set(target, handle);
  }

  registerAll(map: Iterable<[any, QuickJSHandle | string]>) {
    for (const [k, v] of map) {
      this.register(k, v);
    }
  }

  unregister(target: any, dispose?: boolean) {
    this._registeredMap.delete(
      target,
      this._registeredMapDispose.has(target) || dispose
    );
    this._registeredMapDispose.delete(target);
  }

  unregisterAll(targets: Iterable<any>, dispose?: boolean) {
    for (const t of targets) {
      this.unregister(t, dispose);
    }
  }

  _unwrapResult<T>(result: SuccessOrFail<T, QuickJSHandle>): T {
    if ("value" in result) {
      return result.value;
    }
    throw result.error.consume(err => this._unmarshal(err));
  }

  _unwrapResultAndUnmarshal(
    result: VmCallResult<QuickJSHandle> | undefined
  ): any {
    if (!result) return;
    return this._unwrapResult(result).consume(h => this._unmarshal(h));
  }

  _marshal(target: any): QuickJSHandle {
    const registered = this._registeredMap.get(target);
    if (registered) {
      return registered;
    }

    const map = new VMMap(this.vm);
    map.merge(this._map);

    const handle = marshal(this._wrap(target) ?? target, {
      vm: this.vm,
      unmarshal: h => this._unmarshal(h),
      isMarshalable: t =>
        this._options?.isMarshalable?.(this._unwrap(t)) ?? true,
      find: t => this._registeredMap.get(t) ?? map.get(t),
      pre: (t, h) => this._register(t, h, map)?.[1],
      preApply: (target, that, args) => {
        const unwrapped = isObject(that) ? this._unwrap(that) : undefined;
        // override sync mode of this object while calling the function
        if (unwrapped) this._temporalSync.add(unwrapped);
        try {
          return target.apply(that, args);
        } finally {
          // restore sync mode
          if (unwrapped) this._temporalSync.delete(unwrapped);
        }
      },
    });

    this._map.merge(map);
    map.clear();
    map.dispose();
    return handle;
  }

  _unmarshal(handle: QuickJSHandle): any {
    const registered = this._registeredMap.getByHandle(handle);
    if (typeof registered !== "undefined") {
      return registered;
    }

    const [wrappedHandle] = this._wrapHandle(handle);
    return unmarshal(wrappedHandle ?? handle, {
      vm: this.vm,
      marshal: (v: any) => this._marshal(v),
      find: h => this._registeredMap.getByHandle(h) ?? this._map.getByHandle(h),
      pre: (t: any, h: QuickJSHandle) =>
        this._register(t, h, undefined, true)?.[0],
    });
  }

  _register(
    t: any,
    h: QuickJSHandle,
    map: VMMap = this._map,
    sync?: boolean
  ): [Wrapped<any>, Wrapped<QuickJSHandle>] | undefined {
    if (this._registeredMap.has(t) || this._registeredMap.hasHandle(h)) {
      return;
    }

    const wrappedT = this._wrap(t);
    const [wrappedH] = this._wrapHandle(h);
    if (!wrappedT || !wrappedH) return; // t or h is not an object

    const unwrappedT = this._unwrap(t);
    const [unwrappedH, unwrapped] = this._unwrapHandle(h);

    const res = map.set(wrappedT, wrappedH, unwrappedT, unwrappedH);
    if (!res) {
      // already registered
      if (unwrapped) unwrappedH.dispose();
      throw new Error("already registered");
    } else if (sync) {
      this._sync.add(unwrappedT);
    }

    return [wrappedT, wrappedH];
  }

  _syncMode(obj: any) {
    const obj2 = this._unwrap(obj);
    return this._sync.has(obj2) || this._temporalSync.has(obj2)
      ? "both"
      : undefined;
  }

  _wrap<T>(target: T): Wrapped<T> | undefined {
    return wrap(
      this.vm,
      target,
      this._symbol,
      this._symbolHandle,
      t => this._marshal(t),
      t => this._syncMode(t)
    );
  }

  _unwrap<T>(target: T): T {
    return unwrap(target, this._symbol);
  }

  _wrapHandle(
    handle: QuickJSHandle
  ): [Wrapped<QuickJSHandle> | undefined, boolean] {
    return wrapHandle(
      this.vm,
      handle,
      this._symbol,
      this._symbolHandle,
      h => this._unmarshal(h),
      t => this._syncMode(t)
    );
  }

  _unwrapHandle(target: QuickJSHandle): [QuickJSHandle, boolean] {
    return unwrapHandle(this.vm, target, this._symbolHandle);
  }
}
