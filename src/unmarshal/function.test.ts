import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import unmarshalFunction from "./function";

it("arrow function", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = jest.fn(v => vm.newNumber(v));
  const unmarshal = jest.fn((v: QuickJSHandle) => vm.dump(v));
  const preUnmarshal = jest.fn();

  const handle = vm.unwrapResult(vm.evalCode(`(a, b) => a + b`));
  const func = unmarshalFunction(vm, handle, marshal, unmarshal, preUnmarshal);
  if (!func) throw new Error("func is undefined");

  expect(func(1, 2)).toBe(3);
  expect(marshal).toBeCalledTimes(3);
  expect(marshal).toBeCalledWith(undefined);
  expect(marshal).toBeCalledWith(1);
  expect(marshal).toBeCalledWith(2);
  expect(unmarshal.mock.calls.length).toBe(3); // a + b, func.name, func.length
  expect(unmarshal).toReturnWith(3); // a + b
  expect(unmarshal).toReturnWith(func.name);
  expect(unmarshal).toReturnWith(func.length);
  expect(preUnmarshal).toBeCalledTimes(1);
  expect(preUnmarshal).toBeCalledWith(func, handle);

  handle.dispose();
  expect(() => func(1, 2)).toThrow("Lifetime not alive");

  vm.dispose();
});

it("function", async () => {
  const vm = (await getQuickJS()).createVm();
  const that = { a: 1 };
  const thatHandle = vm.unwrapResult(vm.evalCode(`({ a: 1 })`));
  const marshal = jest.fn(v => (v === that ? thatHandle : vm.newNumber(v)));
  const disposables: QuickJSHandle[] = [];
  const unmarshal = jest.fn((v: QuickJSHandle) => {
    const ty = vm.typeof(v);
    if (ty === "object" || ty === "function") disposables.push(v);
    return vm.dump(v);
  });
  const preUnmarshal = jest.fn();

  const handle = vm.unwrapResult(
    vm.evalCode(`(function (a) { return this.a + a; })`)
  );

  const func = unmarshalFunction(vm, handle, marshal, unmarshal, preUnmarshal);
  if (!func) throw new Error("func is undefined");

  expect(func.call(that, 2)).toBe(3);
  expect(marshal).toBeCalledTimes(2); // this, 2
  expect(marshal).toBeCalledWith(that);
  expect(marshal).toBeCalledWith(2);
  expect(unmarshal.mock.calls.length).toBe(4); // this.a + b, func.prototype, func.name, func.length
  expect(unmarshal).toReturnWith(3); // this.a + b
  expect(unmarshal).toReturnWith(func.prototype);
  expect(unmarshal).toReturnWith(func.name);
  expect(unmarshal).toReturnWith(func.length);
  expect(preUnmarshal).toBeCalledTimes(1);
  expect(preUnmarshal).toBeCalledWith(func, handle);

  disposables.forEach(d => d.dispose());
  thatHandle.dispose();
  handle.dispose();
  vm.dispose();
});

it("constructor", async () => {
  const vm = (await getQuickJS()).createVm();
  const disposables: QuickJSHandle[] = [];
  const marshal = jest.fn((v: unknown) =>
    typeof v === "number" ? vm.newNumber(v) : vm.null
  );
  const unmarshal = jest.fn((v: QuickJSHandle) => {
    const ty = vm.typeof(v);
    if (ty === "object" || ty === "function") disposables.push(v);
    return vm.dump(v);
  });
  const preUnmarshal = jest.fn();

  const handle = vm.unwrapResult(
    vm.evalCode(`(function (b) { this.a = b + 2; })`)
  );

  const Cls = unmarshalFunction(
    vm,
    handle,
    marshal,
    unmarshal,
    preUnmarshal
  ) as any;
  if (!Cls) throw new Error("Cls is undefined");

  const instance = new Cls(100);
  expect(instance instanceof Cls).toBe(true);
  expect(instance.a).toBe(102);
  expect(marshal).toBeCalledTimes(2); // this, 100
  expect(marshal).toBeCalledWith(instance);
  expect(marshal).toBeCalledWith(100);
  expect(unmarshal.mock.calls.length).toBe(4); // instance, Cls.prototype, Cls.name, Cls.length
  expect(unmarshal).toReturnWith(instance);
  expect(unmarshal).toReturnWith(Cls.prototype);
  expect(unmarshal).toReturnWith(Cls.name);
  expect(unmarshal).toReturnWith(Cls.length);
  expect(preUnmarshal).toBeCalledTimes(1);
  expect(preUnmarshal).toBeCalledWith(Cls, handle);

  disposables.forEach(d => d.dispose());
  handle.dispose();
  vm.dispose();
});

it("class", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = jest.fn((v: unknown) =>
    typeof v === "number" ? vm.newNumber(v) : vm.null
  );
  const disposables: QuickJSHandle[] = [];
  const unmarshal = jest.fn((v: QuickJSHandle) => {
    const ty = vm.typeof(v);
    if (ty === "object" || ty === "function") disposables.push(v);
    return vm.dump(v);
  });
  const preUnmarshal = jest.fn();

  const handle = vm.unwrapResult(
    vm.evalCode(`(class A { constructor(a) { this.a = a + 1; } })`)
  );

  const Cls = unmarshalFunction(
    vm,
    handle,
    marshal,
    unmarshal,
    preUnmarshal
  ) as any;
  if (!Cls) throw new Error("Cls is undefined");

  const instance = new Cls(2);
  expect(instance instanceof Cls).toBe(true);
  expect(instance.a).toBe(3);
  expect(marshal).toBeCalledTimes(2); // this, 2
  expect(marshal).toBeCalledWith(instance);
  expect(marshal).toBeCalledWith(2);
  expect(unmarshal.mock.calls.length).toBe(4); // instance, Cls.prototype, Cls.name, Cls.length
  expect(unmarshal).toReturnWith(instance);
  expect(unmarshal).toReturnWith(Cls.prototype);
  expect(unmarshal).toReturnWith(Cls.name);
  expect(unmarshal).toReturnWith(Cls.length);
  expect(preUnmarshal).toBeCalledTimes(1);
  expect(preUnmarshal).toBeCalledWith(Cls, handle);

  disposables.forEach(d => d.dispose());
  handle.dispose();
  vm.dispose();
});

it("undefined", async () => {
  const vm = (await getQuickJS()).createVm();
  const f = jest.fn();

  expect(unmarshalFunction(vm, vm.undefined, f, f, f)).toEqual(undefined);
  expect(unmarshalFunction(vm, vm.true, f, f, f)).toEqual(undefined);
  expect(unmarshalFunction(vm, vm.false, f, f, f)).toEqual(undefined);
  expect(unmarshalFunction(vm, vm.null, f, f, f)).toEqual(undefined);
  expect(unmarshalFunction(vm, vm.newString("hoge"), f, f, f)).toEqual(
    undefined
  );
  expect(unmarshalFunction(vm, vm.newNumber(-10), f, f, f)).toEqual(undefined);

  const obj = vm.newObject();
  expect(unmarshalFunction(vm, obj, f, f, f)).toEqual(undefined);
  const array = vm.newArray();
  expect(unmarshalFunction(vm, array, f, f, f)).toEqual(undefined);

  expect(f).toBeCalledTimes(0);

  obj.dispose();
  array.dispose();
  vm.dispose();
});
