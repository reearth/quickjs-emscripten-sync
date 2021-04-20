import { QuickJSHandle, getQuickJS } from "quickjs-emscripten";
import { wrap, wrapHandle } from "./wrapper2";
import { call, eq, send } from "./vmutil";

test("wrap getter", async () => {
  const vm = (await getQuickJS()).createVm();
  const sym = Symbol();
  const object = vm.unwrapResult(vm.evalCode(`Object.prototype`));
  const handle = vm.unwrapResult(
    vm.evalCode(`({
      a: "foo"
    })`)
  );
  const handles: QuickJSHandle[] = [object, handle];

  const marshal = jest.fn((target: any) => {
    if (target === wrapped) return handle;
    return send(vm, target);
  });
  const unmarshal = jest.fn((h: QuickJSHandle): [any, boolean] => {
    return handle === h
      ? [wrapped, false]
      : eq(vm, object, h)
      ? [Object.prototype, true]
      : [vm.dump(h), true];
  });

  const wrapped = wrap(vm, sym, marshal, unmarshal);
  expect(wrapped[sym]).toBe(true);
  expect(wrapped.a).toBe("foo");
  expect(wrapped.b).toBe(undefined);
  expect("a" in wrapped).toBe(true);
  expect("b" in wrapped).toBe(false);
  expect(Object.getOwnPropertyDescriptor(wrapped, "a")).toEqual({
    value: "foo",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  expect(Object.keys(wrapped)).toEqual(["a"]);
  expect(Object.getPrototypeOf(wrapped)).toBe(Object.prototype);
  expect(wrapped).toBeInstanceOf(Object);

  handles.filter(h => h.alive).forEach(h => h.dispose());
  vm.dispose();
});

test("wrapHandle getter", async () => {
  const vm = (await getQuickJS()).createVm();
  const sym = vm.unwrapResult(vm.evalCode(`Symbol()`));
  const target = { a: "foo" };
  const handles: QuickJSHandle[] = [];

  const marshal = jest.fn((t: any) => {
    if (t === target) return wrapped;
    if (t === Object.prototype) {
      return vm.unwrapResult(vm.evalCode(`Object.prototype`));
    }
    return send(vm, t);
  });
  const unmarshal = jest.fn((h: QuickJSHandle): any => {
    return eq(vm, wrapped, h) ? target : vm.dump(h);
  });

  const wrapped = wrapHandle(vm, sym, marshal, unmarshal);
  handles.push(wrapped);

  expect(vm.dump(vm.getProp(wrapped, sym))).toBe(true);
  expect(vm.dump(vm.getProp(wrapped, "a"))).toBe("foo");
  expect(vm.dump(vm.getProp(wrapped, "b"))).toBe(undefined);
  expect(vm.dump(call(vm, `a => "a" in a`, undefined, wrapped))).toBe(true);
  expect(vm.dump(call(vm, `a => "b" in a`, undefined, wrapped))).toBe(false);
  expect(
    call(
      vm,
      `Object.getOwnPropertyDescriptor`,
      undefined,
      wrapped,
      vm.newString("a")
    ).consume(h => vm.dump(h))
  ).toEqual({
    value: "foo",
    enumerable: true,
    configurable: true,
    writable: true,
  });
  expect(
    call(vm, `Object.keys`, undefined, wrapped).consume(h => vm.dump(h))
  ).toEqual(["a"]);

  call(vm, `Object.getPrototypeOf`, undefined, wrapped).dispose();

  expect(
    vm.dump(
      call(
        vm,
        `a => Object.getPrototypeOf(a) === Object.prototype`,
        undefined,
        wrapped
      )
    )
  ).toBe(true);
  expect(
    vm.dump(call(vm, `a => a instanceof Object`, undefined, wrapped))
  ).toBe(true);

  handles.filter(h => h.alive).forEach(h => h.dispose());
  vm.dispose();
});
