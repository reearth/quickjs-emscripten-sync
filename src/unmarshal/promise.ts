import type { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

import { newDeferred } from "../util";
import { call, instanceOf } from "../vmutil";

export default function unmarshalPromise<T = unknown>(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  /** marshal returns handle and boolean indicates that the handle should be disposed after use */
  marshal: (value: unknown) => [QuickJSHandle, boolean],
  preUnmarshal: <T>(target: T, handle: QuickJSHandle) => T | undefined
): Promise<T> | undefined {
  if (!isPromiseHandle(handle)) return;

  const deferred = newDeferred<T>();
  const [resHandle, resShouldBeDisposed] = marshal(deferred.resolve);
  const [rejHandle, rejShouldBeDisposed] = marshal(deferred.reject);
  call(
    vm,
    "(p, res, rej) => { p.then(res, rej); }",
    undefined,
    handle,
    resHandle,
    rejHandle
  );
  if (resShouldBeDisposed) resHandle.dispose();
  if (rejShouldBeDisposed) rejHandle.dispose();

  return preUnmarshal(deferred.promise, handle) ?? deferred.promise;
}

function isPromiseHandle(handle: QuickJSHandle): boolean {
  if (!handle.owner) return false;
  return handle.owner
    .unwrapResult(handle.owner.evalCode("Promise"))
    .consume((promise) => {
      if (!handle.owner) return false;
      return instanceOf(handle.owner, handle, promise);
    });
}
