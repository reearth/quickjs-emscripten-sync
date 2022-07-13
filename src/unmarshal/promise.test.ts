import { Disposable, getQuickJS, type QuickJSHandle } from "quickjs-emscripten";
import { expect, test, vi } from "vitest";

import unmarshalPromise from "./promise";

const testPromise = (reject: boolean) => async () => {
  const vm = (await getQuickJS()).createVm();
  const disposables: Disposable[] = [];
  const marshal = vi.fn((v): [QuickJSHandle, boolean] => {
    const f = vm.newFunction(v.name, (h) => {
      v(vm.dump(h));
    });
    disposables.push(f);
    return [f, false];
  });
  const preUnmarshal = vi.fn((a) => a);

  const deferred = vm.newPromise();
  disposables.push(deferred);
  const promise = unmarshalPromise(vm, deferred.handle, marshal, preUnmarshal);

  expect(marshal).toBeCalledTimes(2);
  expect(preUnmarshal).toBeCalledTimes(1);
  expect(vm.hasPendingJob()).toBe(false);

  if (reject) {
    deferred.reject(vm.newString("hoge"));
  } else {
    deferred.resolve(vm.newString("hoge"));
  }
  expect(vm.hasPendingJob()).toBe(true);
  expect(vm.unwrapResult(vm.executePendingJobs())).toBe(1);
  if (reject) {
    expect(promise).rejects.toThrow("hoge");
  } else {
    expect(promise).resolves.toBe("hoge");
  }

  disposables.forEach((d) => d.dispose());
  vm.dispose();
};

test("resolve", testPromise(false));
test("reject", testPromise(true));
