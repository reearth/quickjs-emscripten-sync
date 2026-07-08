import type {
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSContext,
  QuickJSAsyncContext,
  SuccessOrFail,
  VmCallResult,
  Intrinsics,
} from "quickjs-emscripten";

import { wrapContext, QuickJSContextEx } from "./contextex";
import { defaultRegisteredObjects } from "./default";
import marshal from "./marshal";
import unmarshal from "./unmarshal";
import unmarshalHostRef from "./unmarshal/hostref";
import unmarshalPrimitive from "./unmarshal/primitive";
import { complexity, isES2015Class, isObject, walkObject } from "./util";
import VMMap from "./vmmap";
import {
  call,
  isHandleObject,
  json,
  consume,
  consumeAll,
  mayConsume,
  handleFrom,
  enableFnCache,
  disposeFnCache,
} from "./vmutil";
import { wrap, createWrapHandle, unwrap, unwrapHandle, Wrapped, WrapHandle } from "./wrapper";

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
  isHandleObject,
  json,
  consumeAll,
};

export type { Intrinsics };

export type Options = {
  /** A callback that returns a boolean value that determines whether an object is marshalled or not. If false, no marshaling will be done and undefined will be passed to the QuickJS VM, otherwise marshaling will be done. By default, all objects will be marshalled. */
  isMarshalable?: boolean | "json" | ((target: any) => boolean | "json");
  /** Pre-registered pairs of objects that will be considered the same between the host and the QuickJS VM. This will be used automatically during the conversion. By default, it will be registered automatically with `defaultRegisteredObjects`.
   *
   * Instead of a string, you can also pass a QuickJSHandle directly. In that case, however, you have to dispose of them manually when destroying the VM.
   */
  registeredObjects?: Iterable<[any, QuickJSHandle | string]>;
  /** Register functions to convert an object to a QuickJS handle. */
  customMarshaller?: Iterable<(target: unknown, ctx: QuickJSContext) => QuickJSHandle | undefined>;
  /** Register functions to convert a QuickJS handle to an object. */
  customUnmarshaller?: Iterable<(target: QuickJSHandle, ctx: QuickJSContext) => any>;
  /** A callback that returns a boolean value that determines whether an object is wrappable by proxies. If returns false, note that the object cannot be synchronized between the host and the QuickJS even if arena.sync is used. */
  isWrappable?: (target: any) => boolean;
  /** A callback that returns a boolean value that determines whether an QuickJS handle is wrappable by proxies. If returns false, note that the handle cannot be synchronized between the host and the QuickJS even if arena.sync is used. */
  isHandleWrappable?: (handle: QuickJSHandle, ctx: QuickJSContext) => boolean;
  /** Compatibility with quickjs-emscripten prior to v0.15. Inject code for compatibility into context at Arena class initialization time. */
  compat?: boolean;
  /** Experimental: use QuickJSContextEx, which wraps existing QuickJSContext. */
  experimentalContextEx?: boolean;
  /** Globally enable sync mode (default `true`). When `false`, objects are not wrapped with proxies and marshalled handles are disposed after use, so `arena.sync` has no effect but objects are not retained for their whole lifetime. Useful to avoid memory growth when frequently exchanging short-lived objects. */
  syncEnabled?: boolean;
  /** A callback that returns whether an object should be passed to the VM by reference (as an opaque HostRef) instead of being marshalled by value/proxy. The guest cannot read such objects, but can hold them and pass them back to the host, where they resolve to the original object. */
  marshalByReference?: (target: any) => boolean;
};

/**
 * The Arena class manages all generated handles at once by quickjs-emscripten and automatically converts objects between the host and the QuickJS VM.
 */
export class Arena {
  context: QuickJSContextEx;
  _map: VMMap;
  _registeredMap: VMMap;
  _registeredMapDispose = new Set<any>();
  // Handles with no owner: "json" copies and BigInt values. Unlike
  // proxy-marshalled objects they are not identity-tracked in `_map`. A nested
  // one is disposed by its parent consumer via `_disposeTransient` as soon as
  // the value has been copied; this set is the fallback that frees any that
  // were never nested (e.g. a top-level value before its caller consumes it) on
  // dispose. Top-level handles are removed in `_marshal` since their caller
  // disposes them via `mayConsume`.
  _transientHandles = new Set<QuickJSHandle>();
  _sync = new Set<any>();
  _temporalSync = new Set<any>();
  _symbol = Symbol();
  _symbolHandle: QuickJSHandle;
  _wrapHandleImpl: WrapHandle;
  _options?: Options;

  /** Constructs a new Arena instance. It requires a quickjs-emscripten context initialized with `quickjs.newContext()`. */
  constructor(ctx: QuickJSContext, options?: Options) {
    if (options?.compat && !("runtime" in ctx)) {
      (ctx as any).runtime = {
        hasPendingJob: () => (ctx as any).hasPendingJob(),
        executePendingJobs: (maxJobsToExecute?: number | undefined) =>
          (ctx as any).executePendingJobs(maxJobsToExecute),
      };
    }

    this.context = options?.experimentalContextEx ? wrapContext(ctx) : ctx;
    enableFnCache(this.context);
    this._options = options;
    this._symbolHandle = ctx.unwrapResult(ctx.evalCode(`Symbol()`));
    // One proxyFuncs handle shared by every wrapped handle for the Arena's
    // lifetime, instead of allocating a fresh VM function per wrap.
    this._wrapHandleImpl = createWrapHandle(
      this.context,
      this._symbol,
      this._symbolHandle,
      this._unmarshal,
      this._syncMode,
      this._options?.isHandleWrappable,
      this._options?.syncEnabled ?? true,
    );
    this._map = new VMMap(ctx);
    this._registeredMap = new VMMap(ctx);
    this.registerAll(options?.registeredObjects ?? defaultRegisteredObjects);
  }

  /**
   * Dispose of the arena and managed handles. This method won't dispose the VM itself, so the VM has to be disposed of manually.
   */
  dispose() {
    for (const h of this._transientHandles) {
      if (h.alive) h.dispose();
    }
    this._transientHandles.clear();
    this._map.dispose();
    this._registeredMap.dispose();
    this._wrapHandleImpl.dispose();
    this._symbolHandle.dispose();
    disposeFnCache(this.context);
    this.context.disposeEx?.();
  }

  /** Allows `using arena = new Arena(...)` to dispose the arena automatically. */
  [Symbol.dispose]() {
    this.dispose();
  }

  /**
   * Evaluate JS code in the VM and get the result as an object on the host side. It also converts and re-throws error objects when an error is thrown during evaluation.
   */
  evalCode<T = any>(code: string): T {
    const handle = this.context.evalCode(code);
    return this._unwrapResultAndUnmarshal(handle);
  }

  /**
   * Evaluate ES module code in the VM and get the module's exports.
   *
   * Requires quickjs-emscripten >= 0.29.0 for export access.
   *
   * @param code - The ES module code to evaluate
   * @param filename - Optional filename for debugging purposes (default: "module.js")
   * @returns The module's exports object, or a Promise resolving to exports if using top-level await
   *
   * @example
   * ```js
   * // Simple module with exports
   * const exports = arena.evalModule(`
   *   export const value = 42;
   *   export function greet(name) {
   *     return "Hello, " + name;
   *   }
   * `);
   * console.log(exports.value); // 42
   * console.log(exports.greet("World")); // "Hello, World"
   *
   * // Module with default export
   * const mod = arena.evalModule('export default function(x) { return x * 2; }');
   * console.log(mod.default(21)); // 42
   *
   * // Module with top-level await
   * const promise = arena.evalModule('export const data = await Promise.resolve(123);');
   * arena.executePendingJobs();
   * const exports = await promise;
   * console.log(exports.data); // 123
   * ```
   */
  evalModule<T = any>(code: string, filename = "module.js"): T | Promise<T> {
    const handle = this.context.evalCode(code, filename, { type: "module" });
    return this._unwrapResultAndUnmarshal(handle);
  }

  /**
   * Almost same as `vm.executePendingJobs()`, but it converts and re-throws error objects when an error is thrown during evaluation.
   */
  executePendingJobs(maxJobsToExecute?: number): number {
    const result = this.context.runtime.executePendingJobs(maxJobsToExecute);
    if ("value" in result) {
      return result.value;
    }
    throw this._unwrapIfNotSynced(consume(result.error, this._unmarshal));
  }

  /**
   * Set the max memory this runtime can allocate.
   * To remove the limit, set to `-1`.
   *
   * This is useful for preventing runaway memory usage in untrusted code.
   *
   * @param limitBytes - Maximum memory in bytes, or -1 to remove limit
   *
   * @example
   * ```js
   * // Limit sandbox to 10MB
   * arena.setMemoryLimit(10 * 1024 * 1024);
   *
   * try {
   *   arena.evalCode(`const huge = new Array(1000000000);`);
   * } catch (e) {
   *   console.log("Memory limit exceeded");
   * }
   * ```
   */
  setMemoryLimit(limitBytes: number): void {
    this.context.runtime.setMemoryLimit(limitBytes);
  }

  /**
   * Set the max stack size for this runtime, in bytes.
   * To remove the limit, set to `0`.
   *
   * This is useful for preventing stack overflow from deeply nested calls or recursion.
   *
   * @param stackSize - Maximum stack size in bytes, or 0 to remove limit
   *
   * @example
   * ```js
   * // Limit stack to 512KB
   * arena.setMaxStackSize(512 * 1024);
   *
   * try {
   *   arena.evalCode(`function recurse() { recurse(); } recurse();`);
   * } catch (e) {
   *   console.log("Stack overflow prevented");
   * }
   * ```
   */
  setMaxStackSize(stackSize: number): void {
    this.context.runtime.setMaxStackSize(stackSize);
  }

  /**
   * Get detailed memory usage statistics for this runtime.
   *
   * @returns An object containing detailed memory allocation information
   *
   * @example
   * ```js
   * const stats = arena.getMemoryUsage();
   * console.log(`Memory used: ${stats.memory_used_size} bytes`);
   * console.log(`Object count: ${stats.obj_count}`);
   * console.log(`Memory limit: ${stats.malloc_limit}`);
   * ```
   */
  getMemoryUsage(): {
    malloc_limit: number;
    memory_used_size: number;
    malloc_count: number;
    memory_used_count: number;
    atom_count: number;
    atom_size: number;
    str_count: number;
    str_size: number;
    obj_count: number;
    obj_size: number;
    prop_count: number;
    prop_size: number;
    shape_count: number;
    shape_size: number;
    js_func_count: number;
    js_func_size: number;
    js_func_code_size: number;
    js_func_pc2line_count: number;
    js_func_pc2line_size: number;
    c_func_count: number;
    array_count: number;
    fast_array_count: number;
    fast_array_elements: number;
    binary_object_count: number;
    binary_object_size: number;
  } {
    const handle = this.context.runtime.computeMemoryUsage();
    try {
      return this.context.dump(handle);
    } finally {
      handle.dispose();
    }
  }

  /**
   * Get a human-readable description of memory usage in this runtime.
   *
   * @returns A formatted string showing memory statistics
   *
   * @example
   * ```js
   * console.log(arena.dumpMemoryUsage());
   * // Output:
   * // QuickJS memory usage:
   * //   malloc_limit: 4294967295
   * //   memory_used_size: 67078
   * //   ...
   * ```
   */
  dumpMemoryUsage(): string {
    return this.context.runtime.dumpMemoryUsage();
  }

  /**
   * Expose objects as global objects in the VM.
   *
   * By default, exposed objects are not synchronized between the host and the VM.
   * If you want to sync an objects, first wrap the object with sync method, and then expose the wrapped object.
   */
  expose(obj: Record<string, any>) {
    for (const [key, value] of Object.entries(obj)) {
      mayConsume(this._marshal(value), handle => {
        this.context.setProp(this.context.global, key, handle);
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
    walkObject(wrapped, v => {
      const u = this._unwrap(v);
      this._sync.add(u);
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
        ? this._unwrapResult(this.context.evalCode(handleOrCode))
        : handleOrCode;
    if (this.context.sameValue(handle, this.context.undefined)) return;
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
    this._registeredMap.delete(target, this._registeredMapDispose.has(target) || dispose);
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
    const u = this._unwrap(target);
    this._sync.add(u);
  }

  endSync(target: any) {
    this._sync.delete(this._unwrap(target));
  }

  _unwrapResult<T>(result: SuccessOrFail<T, QuickJSHandle>): T {
    if ("value" in result) {
      return result.value;
    }
    throw this._unwrapIfNotSynced(consume(result.error, this._unmarshal));
  }

  _unwrapResultAndUnmarshal(result: VmCallResult<QuickJSHandle> | undefined): any {
    if (!result) return;
    return this._unwrapIfNotSynced(consume(this._unwrapResult(result), this._unmarshal));
  }

  _isMarshalable = (t: unknown): boolean | "json" => {
    const im = this._options?.isMarshalable;
    return (typeof im === "function" ? im(this._unwrap(t)) : im) ?? "json";
  };

  _marshalByReference = (t: unknown): boolean => {
    return !!this._options?.marshalByReference?.(this._unwrap(t));
  };

  // Register an opaque HostRef handle by its host value without wrapping it.
  _registerHostRef = (t: unknown, handle: QuickJSHandle): QuickJSHandle => {
    const u = this._unwrap(t);
    const existing = this._map.get(u);
    if (existing) return existing;
    this._map.set(u, handle);
    return handle;
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
    h: QuickJSHandle | QuickJSDeferredPromise,
    mode: true | "json" | undefined,
  ): Wrapped<QuickJSHandle> | undefined => {
    if (mode === "json") {
      // json handles have no identity to track; register as transient so they
      // are disposed once consumed (or on dispose) instead of leaking.
      this._registerTransient(handleFrom(h));
      return;
    }
    const registered = this._register(t, handleFrom(h), this._map);
    if (registered) return registered[1];
    // `_register` bails for value-only built-ins that `_wrap` excludes (Map,
    // Set, Date, ArrayBuffer, TypedArray): they are marshalled by value with no
    // entry in `_map`, so their handle has no owner. Track it as transient so a
    // nested one is disposed once consumed, like the json path. (Objects already
    // owned by `_registeredMap` are reached via `_marshalFind`, not here.)
    if (!this._registeredMap.has(t)) this._registerTransient(handleFrom(h));
    return;
  };

  _registerTransient = (handle: QuickJSHandle): void => {
    this._transientHandles.add(handle);
  };

  _disposeTransient = (handle: QuickJSHandle): void => {
    if (this._transientHandles.delete(handle) && handle.alive) handle.dispose();
  };

  _marshalPreApply = (target: (...args: any[]) => any, that: unknown, args: unknown[]): void => {
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

    // Pass-by-reference objects must reference the original, not a proxy wrapper.
    const marshalTarget = this._marshalByReference(target)
      ? this._unwrap(target)
      : this._wrap(target) ?? target;

    const handle = marshal(marshalTarget, {
      ctx: this.context,
      unmarshal: this._unmarshal,
      isMarshalable: this._isMarshalable,
      marshalByReference: this._marshalByReference,
      registerHostRef: this._registerHostRef,
      find: this._marshalFind,
      pre: this._marshalPre,
      registerTransient: this._registerTransient,
      disposeTransient: this._disposeTransient,
      preApply: this._marshalPreApply,
      prepareReturn: this._prepareMarshalReturn,
      unwrap: t => this._unwrap(t),
      custom: this._options?.customMarshaller,
    });

    // A top-level transient handle is disposed by the caller via `mayConsume`,
    // so it must not also be retained (and re-disposed) by the transient set.
    this._transientHandles.delete(handle);

    const syncEnabled = this._options?.syncEnabled ?? true;
    // A non-object (primitive) handle is never retained in `_map` (registered
    // primitives already returned above via `_registeredMap`), so skip the
    // `hasHandle` VM roundtrip and mark it disposable directly.
    if (!syncEnabled || !isObject(target)) return [handle, true];
    return [handle, !this._map.hasHandle(handle)];
  };

  _prepareMarshalReturn = (h: QuickJSHandle): QuickJSHandle => {
    // A host function's return value is disposed by the VM once it is consumed.
    // When sync is on, the VMMap retains object handles for identity, so the
    // handle we hand back is the one the map owns: returning it directly would
    // let the VM dispose the map's copy, leaving a stale entry that breaks
    // `x === fn()` identity across calls. Hand the VM a dup instead and keep
    // ours alive. With sync off, handles are not retained, so this is a no-op.
    const syncEnabled = this._options?.syncEnabled ?? true;
    // Only object handles are retained in `_map`; a primitive return can never
    // be in the map, so `isHandleObject` (a cheap typeof) skips the `hasHandle`
    // VM roundtrip for primitive returns from host functions.
    return syncEnabled && h.alive && isHandleObject(this.context, h) && this._map.hasHandle(h)
      ? h.dup()
      : h;
  };

  _preUnmarshal = (t: any, h: QuickJSHandle): Wrapped<any> => {
    return this._register(t, h, undefined, this._options?.syncEnabled ?? true)?.[0];
  };

  _unmarshalFind = (h: QuickJSHandle): unknown => {
    return this._registeredMap.getByHandle(h) ?? this._map.getByHandle(h);
  };

  _unmarshal = (handle: QuickJSHandle): any => {
    // Primitives (undefined/number/string/boolean/bigint/null) are resolved by a
    // cheap host-side `ctx.typeof`, skipping the `_registeredMap` VM lookup,
    // HostRef resolution, and `_wrapHandle`. The VMMap only ever keys objects and
    // symbols, so a primitive handle can never match `getByHandle`; symbols fall
    // through `unmarshalPrimitive` and still reach the lookup below.
    const [primitive, ok] = unmarshalPrimitive(this.context, handle);
    if (ok) return primitive;

    const registered = this._registeredMap.getByHandle(handle);
    if (typeof registered !== "undefined") {
      return registered;
    }

    // Resolve opaque HostRefs before wrapping, since a proxy would hide them.
    if (this._options?.marshalByReference) {
      const ref = unmarshalHostRef(this.context, handle);
      if (ref) return ref.value;
    }

    const [wrappedHandle] = this._wrapHandle(handle);
    return unmarshal(wrappedHandle ?? handle, {
      ctx: this.context,
      marshal: this._marshal,
      find: this._unmarshalFind,
      pre: this._preUnmarshal,
      custom: this._options?.customUnmarshaller,
      hostRef: !!this._options?.marshalByReference,
    });
  };

  _register(
    t: any,
    h: QuickJSHandle,
    map: VMMap = this._map,
    sync?: boolean,
  ): [Wrapped<any>, Wrapped<QuickJSHandle>] | undefined {
    if (this._registeredMap.has(t) || this._registeredMap.hasHandle(h)) {
      return;
    }

    let wrappedT = this._wrap(t);
    const [wrappedH] = this._wrapHandle(h);
    const isPromise = t instanceof Promise;
    if (!wrappedH || (!wrappedT && !isPromise)) return; // t or h is not an object
    if (isPromise) wrappedT = t;

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
    return this._sync.has(obj2) || this._temporalSync.has(obj2) ? "both" : undefined;
  };

  _wrap<T>(target: T): Wrapped<T> | undefined {
    return wrap(
      this.context,
      target,
      this._symbol,
      this._symbolHandle,
      this._marshal,
      this._syncMode,
      this._options?.isWrappable,
      this._options?.syncEnabled ?? true,
    );
  }

  _unwrap<T>(target: T): T {
    return unwrap(target, this._symbol);
  }

  _unwrapIfNotSynced = <T>(target: T): T => {
    const unwrapped = this._unwrap(target);
    return unwrapped instanceof Promise || !this._sync.has(unwrapped) ? unwrapped : target;
  };

  _wrapHandle(handle: QuickJSHandle): [Wrapped<QuickJSHandle> | undefined, boolean] {
    return this._wrapHandleImpl.wrapHandle(handle);
  }

  _unwrapHandle(target: QuickJSHandle): [QuickJSHandle, boolean] {
    return unwrapHandle(this.context, target, this._symbolHandle);
  }
}

/**
 * An Arena backed by a {@link QuickJSAsyncContext}. In addition to everything
 * `Arena` offers, it can evaluate code asynchronously with `evalCodeAsync`,
 * which lets the VM await host promises (e.g. async module loaders or async
 * functions exposed from the host) without manually pumping pending jobs.
 */
export class AsyncArena extends Arena {
  asyncContext: QuickJSAsyncContext;

  constructor(ctx: QuickJSAsyncContext, options?: Options) {
    super(ctx, options);
    this.asyncContext = ctx;
  }

  /**
   * Evaluate JS code asynchronously in the VM and get the result on the host
   * side. Like `evalCode`, it converts and re-throws errors thrown during
   * evaluation. Use this when the code awaits host-provided promises.
   */
  async evalCodeAsync<T = any>(code: string, filename?: string): Promise<T> {
    const result = await this.asyncContext.evalCodeAsync(code, filename);
    return this._unwrapResultAndUnmarshal(result);
  }
}
