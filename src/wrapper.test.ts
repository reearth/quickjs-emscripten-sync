import { QuickJSHandle, getQuickJS } from "quickjs-emscripten";
import {
  wrap,
  unwrap,
  isWrapped,
  wrapHandle,
  unwrapHandle,
  isHandleWrapped,
  SyncMode,
} from "./wrapper";
import { call, eq, json } from "./vmutil";

test("wrap, unwrap, isWrapped", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const marshal = jest.fn();
  const syncMode = jest.fn();

  expect(isWrapped(target, proxyKeySymbol)).toBe(false);
  expect(unwrap(target, proxyKeySymbol)).toBe(target);

  const wrapped = wrap(
    vm,
    target,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    marshal,
    syncMode
  );
  if (!wrapped) throw new Error("wrapped is undefined");

  expect(wrapped).toEqual(target);
  expect(isWrapped(wrapped, proxyKeySymbol)).toBe(true);
  expect(unwrap(wrapped, proxyKeySymbol)).toBe(target);

  expect(
    wrap(vm, wrapped, proxyKeySymbol, proxyKeySymbolHandle, marshal, syncMode)
  ).toBe(wrapped);

  proxyKeySymbolHandle.dispose();
  handle.dispose();
  vm.dispose();
});

test("wrap without sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const marshal = jest.fn();
  const syncMode = jest.fn();

  const wrapped = wrap(
    vm,
    target,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    marshal,
    syncMode
  );
  if (!wrapped) throw new Error("wrapped is undefined");

  expect(marshal).toBeCalledTimes(0);
  expect(syncMode).toBeCalledTimes(0);

  wrapped.a = 2;

  expect(target.a).toBe(2);
  expect(vm.dump(vm.getProp(handle, "a"))).toBe(1); // not synced
  expect(marshal).toBeCalledTimes(0);
  expect(syncMode).toBeCalledTimes(1);
  expect(syncMode).toBeCalledWith(wrapped);

  proxyKeySymbolHandle.dispose();
  handle.dispose();
  vm.dispose();
});

test("wrap with both sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 } as { a?: number };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const marshal = jest.fn((t: any): [QuickJSHandle, boolean] => [
    t === wrapped ? handle : json(vm, t),
    false,
  ]);
  const syncMode = jest.fn((): SyncMode => "both");

  const wrapped = wrap(
    vm,
    target,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    marshal,
    syncMode
  );
  if (!wrapped) throw new Error("wrapped is undefined");

  expect(marshal).toBeCalledTimes(0);
  expect(syncMode).toBeCalledTimes(0);

  wrapped.a = 2;

  expect(target.a).toBe(2);
  expect(vm.dump(vm.getProp(handle, "a"))).toBe(2); // synced
  expect(marshal).toBeCalledTimes(3);
  expect(marshal).toBeCalledWith(2);
  expect(marshal).toBeCalledWith("a");
  expect(syncMode).toBeCalledTimes(1);
  expect(syncMode).toBeCalledWith(wrapped);

  delete wrapped.a;
  expect(target.a).toBe(undefined);
  expect(vm.dump(vm.getProp(handle, "a"))).toBe(undefined); // synced

  proxyKeySymbolHandle.dispose();
  handle.dispose();
  vm.dispose();
});

test("wrap with vm sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 } as { a?: number };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const marshal = jest.fn((t: any): [QuickJSHandle, boolean] => [
    t === wrapped ? handle : json(vm, t),
    false,
  ]);
  const syncMode = jest.fn((): SyncMode => "vm");

  const wrapped = wrap(
    vm,
    target,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    marshal,
    syncMode
  );
  if (!wrapped) throw new Error("wrapped is undefined");

  expect(marshal).toBeCalledTimes(0);
  expect(syncMode).toBeCalledTimes(0);

  wrapped.a = 2;

  expect(target.a).toBe(1); // not set
  expect(vm.dump(vm.getProp(handle, "a"))).toBe(2); // synced
  expect(marshal).toBeCalledTimes(3);
  expect(marshal).toBeCalledWith(2);
  expect(marshal).toBeCalledWith("a");
  expect(syncMode).toBeCalledTimes(1);
  expect(syncMode).toBeCalledWith(wrapped);

  delete wrapped.a;
  expect(target.a).toBe(1); // not deleted
  expect(vm.dump(vm.getProp(handle, "a"))).toBe(undefined); // synced

  proxyKeySymbolHandle.dispose();
  handle.dispose();
  vm.dispose();
});

test("wrapHandle, unwrapHandle, isHandleWrapped", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const unmarshal = jest.fn();
  const syncMode = jest.fn();

  expect(isHandleWrapped(vm, handle, proxyKeySymbolHandle)).toBe(false);
  expect(unwrapHandle(vm, handle, proxyKeySymbolHandle)).toEqual([
    handle,
    false,
  ]);

  const [wrapped, w] = wrapHandle(
    vm,
    handle,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    unmarshal,
    syncMode
  );
  if (!wrapped || !w) throw new Error("wrapped is undefined");

  expect(vm.dump(wrapped)).toEqual(target); // vm.dump does not support proxies
  expect(vm.dump(vm.getProp(wrapped, "a"))).toBe(1);
  expect(isHandleWrapped(vm, wrapped, proxyKeySymbolHandle)).toBe(true);

  const [handle2, unwrapped2] = unwrapHandle(vm, wrapped, proxyKeySymbolHandle);
  expect(unwrapped2).toBe(true);
  handle2.consume((h) => {
    expect(eq(vm, handle, h)).toBe(true);
  });

  const [wrapped2] = wrapHandle(
    vm,
    wrapped,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    unmarshal,
    syncMode
  );
  expect(wrapped2 === wrapped).toBe(true);

  wrapped.dispose();
  handle.dispose();
  proxyKeySymbolHandle.dispose();
  vm.dispose();
});

test("wrapHandle without sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const unmarshal = jest.fn((h: QuickJSHandle) =>
    wrapped && eq(vm, h, wrapped) ? target : vm.dump(h)
  );
  const syncMode = jest.fn();

  const [wrapped, w] = wrapHandle(
    vm,
    handle,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    unmarshal,
    syncMode
  );
  if (!wrapped || !w) throw new Error("wrapped is undefined");

  expect(unmarshal).toBeCalledTimes(0);
  expect(syncMode).toBeCalledTimes(0);

  call(vm, `a => a.a = 2`, undefined, wrapped);

  expect(vm.dump(vm.getProp(handle, "a"))).toBe(2);
  expect(target.a).toBe(1); // not synced
  expect(unmarshal).toBeCalledTimes(1);
  expect(unmarshal).toReturnWith(target);
  expect(syncMode).toBeCalledTimes(1);
  expect(syncMode).toBeCalledWith(target);

  wrapped.dispose();
  handle.dispose();
  proxyKeySymbolHandle.dispose();
  vm.dispose();
});

test("wrapHandle with both sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const unmarshal = jest.fn((h: QuickJSHandle) => {
    return wrapped && eq(vm, h, wrapped) ? target : vm.dump(h);
  });
  const syncMode = jest.fn((): SyncMode => "both");

  const [wrapped, w] = wrapHandle(
    vm,
    handle,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    unmarshal,
    syncMode
  );
  if (!wrapped || !w) throw new Error("wrapped is undefined");

  expect(unmarshal).toBeCalledTimes(0);
  expect(syncMode).toBeCalledTimes(0);

  call(vm, `a => a.a = 2`, undefined, wrapped);

  expect(vm.dump(vm.getProp(handle, "a"))).toBe(2);
  expect(target.a).toBe(2); // synced
  expect(unmarshal).toBeCalledTimes(4);
  expect(unmarshal).toReturnWith(target); // twice
  expect(unmarshal).toReturnWith("a");
  expect(unmarshal).toReturnWith(2);
  expect(syncMode).toBeCalledTimes(1);
  expect(syncMode).toBeCalledWith(target);

  call(vm, `a => { delete a.a; }`, undefined, wrapped);
  expect(vm.dump(vm.getProp(handle, "a"))).toBe(undefined);
  expect(target.a).toBe(undefined); // synced

  // changing __proto__ will be blocked
  call(vm, `a => { a.__proto__ = null; }`, undefined, wrapped);
  expect(vm.dump(call(vm, `Object.getPrototypeOf`, undefined, handle))).toBe(
    null
  );
  expect(Object.getPrototypeOf(target)).toBe(Object.prototype); // not changed

  wrapped.dispose();
  handle.dispose();
  proxyKeySymbolHandle.dispose();
  vm.dispose();
});

test("wrapHandle with host sync", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const unmarshal = jest.fn((handle: QuickJSHandle) =>
    wrapped && eq(vm, handle, wrapped) ? target : vm.dump(handle)
  );
  const syncMode = jest.fn((): SyncMode => "host");

  const [wrapped, w] = wrapHandle(
    vm,
    handle,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    unmarshal,
    syncMode
  );
  if (!wrapped || !w) throw new Error("wrapped is undefined");

  expect(unmarshal).toBeCalledTimes(0);
  expect(syncMode).toBeCalledTimes(0);

  call(vm, `a => a.a = 2`, undefined, wrapped);

  expect(vm.dump(vm.getProp(handle, "a"))).toBe(1); // not set
  expect(target.a).toBe(2); // synced
  expect(unmarshal).toBeCalledTimes(4);
  expect(unmarshal).toReturnWith(target); // twice
  expect(unmarshal).toReturnWith("a");
  expect(unmarshal).toReturnWith(2);
  expect(syncMode).toBeCalledTimes(1);
  expect(syncMode).toBeCalledWith(target);

  call(vm, `a => delete a.a`, undefined, handle);
  expect(vm.dump(vm.getProp(handle, "a"))).toBe(undefined);
  expect(target.a).toBe(2); // not synced

  wrapped.dispose();
  handle.dispose();
  proxyKeySymbolHandle.dispose();
  vm.dispose();
});

test("wrap and wrapHandle", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = { a: 1 };
  const handle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const marshal = jest.fn((t: any): [QuickJSHandle, boolean] => [
    wrappedHandle && t === wrapped ? wrappedHandle : json(vm, t),
    false,
  ]);
  const unmarshal = jest.fn((handle: QuickJSHandle) =>
    wrappedHandle && eq(vm, handle, wrappedHandle) ? wrapped : vm.dump(handle)
  );
  const syncMode = jest.fn((): SyncMode => "both");

  const wrapped = wrap(
    vm,
    target,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    marshal,
    syncMode
  );
  if (!wrapped) throw new Error("wrapped is undefined");
  const [wrappedHandle, w] = wrapHandle(
    vm,
    handle,
    proxyKeySymbol,
    proxyKeySymbolHandle,
    unmarshal,
    syncMode
  );
  if (!wrappedHandle || !w) throw new Error("wrappedHandle is undefined");

  call(vm, `a => a.a = 2`, undefined, wrappedHandle);

  expect(vm.dump(vm.getProp(handle, "a"))).toBe(2);
  expect(target.a).toBe(2);
  expect(marshal).toBeCalledTimes(0);
  expect(unmarshal).toBeCalledTimes(4);
  expect(unmarshal).toReturnWith(wrapped); // twice
  expect(unmarshal).toReturnWith("a");
  expect(unmarshal).toReturnWith(2);

  marshal.mockClear();
  unmarshal.mockClear();

  wrapped.a = 3;

  expect(vm.dump(vm.getProp(handle, "a"))).toBe(3);
  expect(target.a).toBe(3);
  expect(marshal).toBeCalledTimes(3);
  expect(marshal).toBeCalledWith(wrapped);
  expect(marshal).toBeCalledWith("a");
  expect(marshal).toBeCalledWith(3);
  expect(unmarshal).toBeCalledTimes(0);

  wrappedHandle.dispose();
  handle.dispose();
  proxyKeySymbolHandle.dispose();
  vm.dispose();
});

test("non object", async () => {
  const vm = (await getQuickJS()).createVm();
  const target = 1;
  const handle = vm.newNumber(1);
  const proxyKeySymbol = Symbol();
  const proxyKeySymbolHandle = vm.unwrapResult(vm.evalCode(`Symbol()`));

  expect(
    wrap(vm, target, proxyKeySymbol, proxyKeySymbolHandle, jest.fn(), jest.fn())
  ).toBe(undefined);

  expect(
    wrapHandle(
      vm,
      handle,
      proxyKeySymbol,
      proxyKeySymbolHandle,
      jest.fn(),
      jest.fn()
    )
  ).toEqual([undefined, false]);

  proxyKeySymbolHandle.dispose();
  vm.dispose();
});
