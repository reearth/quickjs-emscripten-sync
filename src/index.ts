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
import {
  call,
  eq,
  isHandleObject,
  json,
  consumeAll,
  mayConsume,
} from "./vmutil";
import { defaultRegisteredObjects } from "./default";

export {
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
  json,
  consumeAll,
};

export type Options = {
  /** A callback that returns a boolean value that determines whether an object is marshalled or not. If false, no marshaling will be done and undefined will be passed to the QuickJS VM, otherwise marshaling will be done. By default, all objects will be marshalled. */
  isMarshalable?: boolean | "json" | ((target: any) => boolean | "json");
  /** You can pre-register a pair of objects that will be considered the same between the host and the QuickJS VM. This will be used automatically during the conversion. By default, it will be registered automatically with `defaultRegisteredObjects`.
   *
   * Instead of a string, you can also pass a QuickJSHandle directly. In that case, however, you have to dispose of them manually when destroying the VM.
   */
  registeredObjects?: Iterable<[any, QuickJSHandle | string]>;
};

/**
 * The Arena class manages all generated handles at once by quickjs-emscripten and automatically converts objects between the host and the QuickJS VM.
 */
export class Arena {
  vm: QuickJSVm;
  _map: VMMap;
  _registeredMap: VMMap;
  _registeredMapDispose: Set<any> = new Set();
  _sync: Set<any> = new Set();
  _temporalSync: Set<any> = new Set();
  _symbol = Symbol();
  _symbolHandle: QuickJSHandle;
  _options?: Options;

  /** Constructs a new Arena instance. It requires a quickjs-emscripten VM initialized with `quickjs.createVM()`. */
  constructor(vm: QuickJSVm, options?: Options) {
    this.vm = vm;
    this._options = options;
    this._symbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
    this._map = new VMMap(vm);
    this._registeredMap = new VMMap(vm);
    this.registerAll(options?.registeredObjects ?? defaultRegisteredObjects);
  }

  /**
   * Dispose of the arena and managed handles. This method won't dispose the VM itself, so the VM has to be disposed of manually.
   */
  dispose() {
    this._map.dispose();
    this._registeredMap.dispose();
    this._symbolHandle.dispose();
  }

  /**
   * Evaluate JS code in the VM and get the result as an object on the host side. It also converts and re-throws error objects when an error is thrown during evaluation.
   */
  evalCode<T = any>(code: string): T {
    const handle = this.vm.evalCode(code);
    return this._unwrapResultAndUnmarshal(handle);
  }

  /**
   * Almost same as `vm.executePendingJobs()`, but it converts and re-throws error objects when an error is thrown during evaluation.
   */
  executePendingJobs(maxJobsToExecute?: number): number {
    const result = this.vm.executePendingJobs(maxJobsToExecute);
    if ("value" in result) {
      return result.value;
    }
    throw result.error.consume(this._unmarshal);
  }

  /**
   * Expose objects as global objects in the VM.
   *
   * By default, exposed objects are not synchronized between the host and the VM.
   * If you want to sync an objects, first wrap the object with sync method, and then expose the wrapped object.
   */
  expose(obj: { [k: string]: any }) {
    for (const [key, value] of Object.entries(obj)) {
      mayConsume(this._marshal(value), (handle) => {
      this.vm.setProp(this.vm.global, key, handle);
      });
    }
  }

  /**
   * Enables sync for the object between the host and the VM and returns objects wrapped with proxies.
   *
   * The return value is necessary in order to reflect changes to the object from the host to the VM. Please note that setting a value in the field or deleting a field in the original object will not synchronize it.
   */
  sync<T>(target: T): T {
    const wrapped = this._wrap(target);
    if (typeof wrapped === "undefined") return target;
    walkObject(wrapped, (v) => {
      this._sync.add(this._unwrap(v));
    });
    return wrapped;
  }

  /**
   * Register a pair of objects that will be considered the same between the host and the QuickJS VM.
   *
   * Instead of a string, you can also pass a QuickJSHandle directly. In that case, however, when  you have to dispose them manually when destroying the VM.
   */
  register(target: any, handleOrCode: QuickJSHandle | string) {
    if (this._registeredMap.has(target)) return;
    const handle =
      typeof handleOrCode === "string"
        ? this._unwrapResult(this.vm.evalCode(handleOrCode))
        : handleOrCode;
    if (eq(this.vm, handle, this.vm.undefined)) return;
    if (typeof handleOrCode === "string") {
      this._registeredMapDispose.add(target);
    }
    this._registeredMap.set(target, handle);
  }

  /**
   * Execute `register` methods for each pair.
   */
  registerAll(map: Iterable<[any, QuickJSHandle | string]>) {
    for (const [k, v] of map) {
      this.register(k, v);
    }
  }

  /**
   * Unregister a pair of objects that were registered with `registeredObjects` option and `register` method.
   */
  unregister(target: any, dispose?: boolean) {
    this._registeredMap.delete(
      target,
      this._registeredMapDispose.has(target) || dispose
    );
    this._registeredMapDispose.delete(target);
  }

  /**
   * Execute `unregister` methods for each target.
   */
  unregisterAll(targets: Iterable<any>, dispose?: boolean) {
    for (const t of targets) {
      this.unregister(t, dispose);
    }
  }

  startSync(target: any) {
    if (!isObject(target)) return;
    this._sync.add(this._unwrap(target));
  }

  endSync(target: any) {
    this._sync.delete(this._unwrap(target));
  }

  _unwrapResult<T>(result: SuccessOrFail<T, QuickJSHandle>): T {
    if ("value" in result) {
      return result.value;
    }
    throw result.error.consume(this._unmarshal);
  }

  _unwrapResultAndUnmarshal(
    result: VmCallResult<QuickJSHandle> | undefined
  ): any {
    if (!result) return;
    return this._unwrapResult(result).consume(this._unmarshal);
  }

  _isMarshalable = (t: unknown): boolean | "json" => {
    const im = this._options?.isMarshalable;
    return (typeof im === "function" ? im(this._unwrap(t)) : im) ?? "json";
  };

  _marshalFind = (t: unknown) => {
    const unwrappedT = this._unwrap(t);
    const handle =
      this._registeredMap.get(t) ??
      (unwrappedT !== t ? this._registeredMap.get(unwrappedT) : undefined) ??
      this._map.get(t) ??
      (unwrappedT !== t ? this._map.get(unwrappedT) : undefined);
    return handle;
  };

  _marshalPre = (
    t: unknown,
    h: QuickJSHandle,
    mode: true | "json" | undefined
  ): Wrapped<QuickJSHandle> | undefined => {
    if (mode === "json") return;
    return this._register(t, h, this._map)?.[1];
  };

  _marshalPreApply = (
    target: Function,
    that: unknown,
    args: unknown[]
  ): void => {
    const unwrapped = isObject(that) ? this._unwrap(that) : undefined;
    // override sync mode of this object while calling the function
    if (unwrapped) this._temporalSync.add(unwrapped);
    try {
      return target.apply(that, args);
    } finally {
      // restore sync mode
      if (unwrapped) this._temporalSync.delete(unwrapped);
    }
  };

  _marshal = (target: any): [QuickJSHandle, boolean] => {
    const registered = this._registeredMap.get(target);
    if (registered) {
      return [registered, false];
    }

    const handle = marshal(this._wrap(target) ?? target, {
      vm: this.vm,
      unmarshal: this._unmarshal,
      isMarshalable: this._isMarshalable,
      find: this._marshalFind,
      pre: this._marshalPre,
      preApply: this._marshalPreApply,
    });

    return [handle, !this._map.hasHandle(handle)];
  };

  _preUnmarshal = (t: any, h: QuickJSHandle): Wrapped<any> => {
    return this._register(t, h, undefined, true)?.[0];
  };

  _unmarshalFind = (h: QuickJSHandle): unknown => {
    return this._registeredMap.getByHandle(h) ?? this._map.getByHandle(h);
  };

  _unmarshal = (handle: QuickJSHandle): any => {
    const registered = this._registeredMap.getByHandle(handle);
    if (typeof registered !== "undefined") {
      return registered;
    }

    const [wrappedHandle] = this._wrapHandle(handle);
    return unmarshal(wrappedHandle ?? handle, {
      vm: this.vm,
      marshal: this._marshal,
      find: this._unmarshalFind,
      pre: this._preUnmarshal,
    });
  };

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

  _syncMode = (obj: any): "both" | undefined => {
    const obj2 = this._unwrap(obj);
    return this._sync.has(obj2) || this._temporalSync.has(obj2)
      ? "both"
      : undefined;
  };

  _wrap<T>(target: T): Wrapped<T> | undefined {
    return wrap(
      this.vm,
      target,
      this._symbol,
      this._symbolHandle,
      this._marshal,
      this._syncMode
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
      this._unmarshal,
      this._syncMode
    );
  }

  _unwrapHandle(target: QuickJSHandle): [QuickJSHandle, boolean] {
    return unwrapHandle(this.vm, target, this._symbolHandle);
  }
}
