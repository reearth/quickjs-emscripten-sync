import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import {
  call,
  consumeAll,
  eq,
  instanceOf,
  isHandleObject,
  json,
  mayConsume,
  mayConsumeAll,
} from "./vmutil";

test("call", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  expect(
    vm.getNumber(
      call(vm, "(a, b) => a + b", undefined, vm.newNumber(1), vm.newNumber(2))
    )
  ).toBe(3);

  const obj = vm.newObject();
  vm.setProp(obj, "a", vm.newNumber(2));
  expect(
    vm.getNumber(call(vm, "(function() { return this.a + 1; })", obj))
  ).toBe(3);

  obj.dispose();
  vm.dispose();
});

test("eq", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const math1 = vm.unwrapResult(vm.evalCode("Math"));
  const math2 = vm.unwrapResult(vm.evalCode("Math"));
  const obj = vm.newObject();
  expect(math1 === math2).toBe(false);
  expect(eq(vm, math1, math2)).toBe(true);
  expect(eq(vm, math1, obj)).toBe(false);

  math1.dispose();
  math2.dispose();
  obj.dispose();
  vm.dispose();
});

test("instanceOf", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const pr = vm.unwrapResult(vm.evalCode("Promise"));
  const func = vm.unwrapResult(vm.evalCode("(function() {})"));
  const p = vm.unwrapResult(vm.evalCode("Promise.resolve()"));
  expect(instanceOf(vm, p, pr)).toBe(true);
  expect(instanceOf(vm, p, func)).toBe(false);

  p.dispose();
  pr.dispose();
  func.dispose();
  vm.dispose();
});

test("isHandleObject", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const obj = vm.newObject();
  expect(isHandleObject(vm, obj)).toBe(true);
  const func = vm.newFunction("", () => {});
  expect(isHandleObject(vm, func)).toBe(true);
  const array = vm.newArray();
  expect(isHandleObject(vm, array)).toBe(true);
  const num = vm.newNumber(NaN);
  expect(isHandleObject(vm, num)).toBe(false);

  obj.dispose();
  func.dispose();
  array.dispose();
  vm.dispose();
});

test("json", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const handle = json(vm, {
    hoge: { foo: ["bar"] },
  });
  expect(
    vm.dump(call(vm, `a => a.hoge.foo[0] === "bar"`, undefined, handle))
  ).toBe(true);
  expect(vm.typeof(json(vm, undefined))).toBe("undefined");

  handle.dispose();
  vm.dispose();
});

test("consumeAll", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const o = {};

  const handles = [vm.newObject(), vm.newObject()];
  expect(
    consumeAll(
      handles,
      jest.fn(() => o)
    )
  ).toBe(o);
  expect(handles.every((h) => !h.alive)).toBe(true);

  const handles2 = [vm.newObject(), vm.newObject()];
  expect(() =>
    consumeAll(handles2, () => {
      throw new Error("qes error");
    })
  ).toThrow("qes error");
  expect(handles2.every((h) => !h.alive)).toBe(true);

  vm.dispose();
});

test("mayConsume", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const o = {};

  const handle = vm.newArray();
  expect(
    mayConsume(
      [handle, false],
      jest.fn<any, [QuickJSHandle]>(() => o)
    )
  ).toBe(o);
  expect(handle.alive).toBe(true);

  mayConsume([handle, true], () => {});
  expect(handle.alive).toBe(false);

  const handle2 = vm.newArray();
  expect(() =>
    mayConsume([handle2, true], () => {
      throw new Error("qes error");
    })
  ).toThrow("qes error");
  expect(handle.alive).toBe(false);

  vm.dispose();
});

test("mayConsumeAll", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const o = {};

  const handles: [QuickJSHandle, boolean][] = [
    [vm.newObject(), false],
    [vm.newObject(), true],
  ];
  expect(
    mayConsumeAll(
      handles,
      jest.fn<any, QuickJSHandle[]>(() => o)
    )
  ).toBe(o);
  expect(handles[0][0].alive).toBe(true);
  expect(handles[1][0].alive).toBe(false);

  const handles2: [QuickJSHandle, boolean][] = [
    [vm.newObject(), false],
    [vm.newObject(), true],
  ];
  expect(() =>
    mayConsumeAll(handles2, (..._args) => {
      throw new Error("qes error");
    })
  ).toThrow("qes error");
  expect(handles2[0][0].alive).toBe(true);
  expect(handles2[1][0].alive).toBe(false);

  handles[0][0].dispose();
  handles2[0][0].dispose();
  vm.dispose();
});
