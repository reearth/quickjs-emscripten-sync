import { getQuickJS } from "quickjs-emscripten";
import { call } from "../vmutil";
import marshalObject from "./object";

test("empty object", async () => {
  const vm = (await getQuickJS()).createVm();
  const prototypeCheck = vm.unwrapResult(
    vm.evalCode(`o => Object.getPrototypeOf(o) === Object.prototype`)
  );

  const obj = {};
  const marshal = jest.fn();
  const preMarshal = jest.fn((_, a) => a);

  const handle = marshalObject(vm, obj, marshal, preMarshal);
  if (!handle) throw new Error("handle is undefined");

  expect(vm.typeof(handle)).toBe("object");
  expect(marshal).toBeCalledTimes(0);
  expect(preMarshal).toBeCalledTimes(1);
  expect(preMarshal.mock.calls[0][0]).toBe(obj);
  expect(preMarshal.mock.calls[0][1] === handle).toBe(true); // avoid freeze
  expect(
    vm.dump(
      vm.unwrapResult(vm.callFunction(prototypeCheck, vm.undefined, handle))
    )
  ).toBe(true);

  handle.dispose();
  prototypeCheck.dispose();
  vm.dispose();
});

test("normal object", async () => {
  const vm = (await getQuickJS()).createVm();
  const prototypeCheck = vm.unwrapResult(
    vm.evalCode(`o => Object.getPrototypeOf(o) === Object.prototype`)
  );
  const entries = vm.unwrapResult(vm.evalCode(`Object.entries`));

  const obj = { a: 100, b: "hoge" };
  const marshal = jest.fn((v) =>
    typeof v === "number"
      ? vm.newNumber(v)
      : typeof v === "string"
      ? vm.newString(v)
      : vm.null
  );
  const preMarshal = jest.fn((_, a) => a);

  const handle = marshalObject(vm, obj, marshal, preMarshal);
  if (!handle) throw new Error("handle is undefined");

  expect(vm.typeof(handle)).toBe("object");
  expect(vm.getNumber(vm.getProp(handle, "a"))).toBe(100);
  expect(vm.getString(vm.getProp(handle, "b"))).toBe("hoge");
  expect(marshal.mock.calls).toEqual([["a"], [100], ["b"], ["hoge"]]);
  expect(preMarshal).toBeCalledTimes(1);
  expect(preMarshal.mock.calls[0][0]).toBe(obj);
  expect(preMarshal.mock.calls[0][1] === handle).toBe(true); // avoid freeze
  expect(
    vm.dump(
      vm.unwrapResult(vm.callFunction(prototypeCheck, vm.undefined, handle))
    )
  ).toBe(true);
  const e = vm.unwrapResult(vm.callFunction(entries, vm.undefined, handle));
  expect(vm.dump(e)).toEqual([
    ["a", 100],
    ["b", "hoge"],
  ]);

  e.dispose();
  handle.dispose();
  prototypeCheck.dispose();
  entries.dispose();
  vm.dispose();
});

test("array", async () => {
  const vm = (await getQuickJS()).createVm();
  const isArray = vm.unwrapResult(vm.evalCode(`Array.isArray`));

  const array = [1, "aa"];
  const marshal = jest.fn((v) =>
    typeof v === "number"
      ? vm.newNumber(v)
      : typeof v === "string"
      ? vm.newString(v)
      : vm.null
  );
  const preMarshal = jest.fn((_, a) => a);

  const handle = marshalObject(vm, array, marshal, preMarshal);
  if (!handle) throw new Error("handle is undefined");

  expect(vm.typeof(handle)).toBe("object");
  expect(vm.getNumber(vm.getProp(handle, 0))).toBe(1);
  expect(vm.getString(vm.getProp(handle, 1))).toBe("aa");
  expect(vm.getNumber(vm.getProp(handle, "length"))).toBe(2);
  expect(marshal.mock.calls).toEqual([
    ["0"],
    [1],
    ["1"],
    ["aa"],
    ["length"],
    [2],
  ]);
  expect(preMarshal).toBeCalledTimes(1);
  expect(preMarshal.mock.calls[0][0]).toBe(array);
  expect(preMarshal.mock.calls[0][1] === handle).toBe(true); // avoid freeze
  expect(
    vm.dump(vm.unwrapResult(vm.callFunction(isArray, vm.undefined, handle)))
  ).toBe(true);

  handle.dispose();
  isArray.dispose();
  vm.dispose();
});

test("prototype", async () => {
  const vm = (await getQuickJS()).createVm();

  const proto = { a: 100 };
  const protoHandle = vm.newObject();
  vm.setProp(protoHandle, "a", vm.newNumber(100));
  const preMarshal = jest.fn((_, a) => a);

  const obj = Object.create(proto);
  obj.b = "hoge";
  const handle = marshalObject(
    vm,
    obj,
    (v) =>
      v === proto
        ? protoHandle
        : typeof v === "string"
        ? vm.newString(v)
        : vm.null,
    preMarshal
  );
  if (!handle) throw new Error("handle is undefined");

  expect(preMarshal).toBeCalledTimes(1);
  expect(preMarshal.mock.calls[0][0]).toBe(obj);
  expect(preMarshal.mock.calls[0][1] === handle).toBe(true); // avoid freeze
  expect(vm.typeof(handle)).toBe("object");
  expect(vm.getNumber(vm.getProp(handle, "a"))).toBe(100);
  expect(vm.getString(vm.getProp(handle, "b"))).toBe("hoge");
  const e = call(vm, "Object.entries", undefined, handle);
  expect(vm.dump(e)).toEqual([["b", "hoge"]]);
  const protoHandle2 = call(vm, "Object.getPrototypeOf", vm.undefined, handle);
  expect(
    vm.dump(call(vm, `Object.is`, undefined, protoHandle, protoHandle2))
  ).toBe(true);

  protoHandle2.dispose();
  e.dispose();
  handle.dispose();
  protoHandle.dispose();
  vm.dispose();
});
