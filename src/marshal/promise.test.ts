import {
  getQuickJS,
  type Disposable,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
} from "quickjs-emscripten";
import { expect, test, vi } from "vitest";
import { newDeferred } from "../util";

import { fn, json } from "../vmutil";
import marshalPromise from "./promise";

const testPromise = (reject: boolean) => async () => {
  const vm = (await getQuickJS()).createVm();

  const disposables: Disposable[] = [];
  const marshal = vi.fn((v) => {
    const handle = json(vm, v);
    disposables.push(handle);
    return handle;
  });
  const preMarshal = vi.fn(
    (_: any, a: QuickJSDeferredPromise): QuickJSHandle => {
      disposables.push(a);
      return a.handle;
    }
  );

  const mockNotify = vi.fn();
  const notify = vm.newFunction("notify", (handle1, handle2) => {
    const arg1 = vm.dump(handle1);
    const arg2 = vm.dump(handle2);
    mockNotify(arg1, arg2);
  });
  disposables.push(notify);

  const notifier = fn(
    vm,
    `(notify, promise) => { promise.then(d => notify("resolved", d), d => notify("rejected", d)); }`
  );
  disposables.push(notifier);

  const deferred = newDeferred();
  if (reject) {
    deferred.promise.catch(() => {});
  }
  const handle = marshalPromise(vm, deferred.promise, marshal, preMarshal);
  if (!handle) throw new Error("handle is undefined");

  expect(marshal).toBeCalledTimes(0);
  expect(preMarshal).toBeCalledTimes(1);
  expect(preMarshal.mock.calls[0][0]).toBe(deferred.promise);
  expect(preMarshal.mock.calls[0][1].handle).toBe(handle);

  notifier(undefined, notify, handle);

  expect(mockNotify).toBeCalledTimes(0);
  expect(deferred.resolve).not.toBeUndefined();
  expect(vm.hasPendingJob()).toBe(false);

  if (reject) {
    deferred.reject("hoge");
  } else {
    deferred.resolve("hoge");
  }

  expect(vm.hasPendingJob()).toBe(false);
  if (reject) {
    await expect(deferred.promise).rejects.toBe("hoge");
  } else {
    await expect(deferred.promise).resolves.toBe("hoge");
  }
  expect(vm.hasPendingJob()).toBe(true);
  const executed = vm.unwrapResult(vm.executePendingJobs());
  expect(executed).toBe(1);
  expect(mockNotify).toBeCalledTimes(1);
  expect(mockNotify).toBeCalledWith(reject ? "rejected" : "resolved", "hoge");
  expect(marshal).toBeCalledTimes(1);
  expect(marshal.mock.calls).toEqual([["hoge"]]);

  disposables.forEach((h) => h.dispose());
  vm.dispose();
};

test("resolve", testPromise(false));
test("reject", testPromise(true));
