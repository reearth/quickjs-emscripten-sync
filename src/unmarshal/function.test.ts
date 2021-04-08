import { getQuickJS } from "quickjs-emscripten";
import unmarshalFunction from "./function";

it("arrow function", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = jest.fn(v => vm.newNumber(v));
  const unmarshal = jest.fn(v => vm.dump(v));
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
  const unmarshal = jest.fn(v => vm.dump(v));
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
  expect(unmarshal).toReturnWith(func.prototype); // prototype
  expect(preUnmarshal).toBeCalledTimes(1);
  expect(preUnmarshal).toBeCalledWith(func, handle);

  thatHandle.dispose();
  handle.dispose();
  vm.dispose();
});

it("constructor", async () => {
  const vm = (await getQuickJS()).createVm();

  const marshal = jest.fn(v => vm.newNumber(v));
  const unmarshal = jest.fn(v => vm.dump(v));
  const preUnmarshal = jest.fn();

  const handle = vm.unwrapResult(
    vm.evalCode(`(function (a) { this.a = a + 1; })`)
  );

  const Cls = unmarshalFunction(
    vm,
    handle,
    marshal,
    unmarshal,
    preUnmarshal
  ) as any;
  if (!Cls) throw new Error("func is undefined");

  const instance = new Cls(2);
  expect(instance instanceof Cls).toBe(true);
  // marshal doesn't proxy obj so a is not set correctly.
  expect(instance.a).toBe(undefined);
  expect(marshal).toBeCalledTimes(2); // this, 2
  expect(marshal).toBeCalledWith(instance); // this
  expect(marshal).toBeCalledWith(2); // this
  expect(unmarshal.mock.calls.length).toBe(4); // return value of constructor, Cls.prototype, Cls.name, Cls.length
  expect(unmarshal).toReturnWith(undefined); // return value
  expect(unmarshal).toReturnWith(Cls.prototype); // prototype
  expect(preUnmarshal).toBeCalledTimes(1);
  expect(preUnmarshal).toBeCalledWith(Cls, handle);

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
