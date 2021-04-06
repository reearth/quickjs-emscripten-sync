import { getQuickJS } from "quickjs-emscripten";
import marshalObject from "./object";

it("empty object", async () => {
  const vm = (await getQuickJS()).createVm();
  const prototypeCheck = vm.unwrapResult(
    vm.evalCode(`o => Object.getPrototypeOf(o) === Object.prototype`)
  );

  const obj = {};
  const marshaler = jest.fn();

  const handle = marshalObject(vm, obj, marshaler);
  if (!handle) throw new Error("handle is undefined");

  expect(vm.typeof(handle)).toBe("object");
  expect(marshaler).toBeCalledTimes(0);
  expect(
    vm.dump(
      vm.unwrapResult(vm.callFunction(prototypeCheck, vm.undefined, handle))
    )
  ).toBe(true);

  handle.dispose();
  prototypeCheck.dispose();
  vm.dispose();
});

it("normal object", async () => {
  const vm = (await getQuickJS()).createVm();
  const prototypeCheck = vm.unwrapResult(
    vm.evalCode(`o => Object.getPrototypeOf(o) === Object.prototype`)
  );
  const entries = vm.unwrapResult(vm.evalCode(`Object.entries`));

  const obj = { a: 100, b: "hoge" };
  const marshaler = jest.fn(v =>
    typeof v === "number"
      ? vm.newNumber(v)
      : typeof v === "string"
      ? vm.newString(v)
      : vm.null
  );

  const handle = marshalObject(vm, obj, marshaler);
  if (!handle) throw new Error("handle is undefined");

  expect(vm.typeof(handle)).toBe("object");
  expect(vm.getNumber(vm.getProp(handle, "a"))).toBe(100);
  expect(vm.getString(vm.getProp(handle, "b"))).toBe("hoge");
  expect(marshaler.mock.calls).toEqual([[100], ["hoge"]]);
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

it("prototype", async () => {
  const vm = (await getQuickJS()).createVm();
  const getPrototypeOf = vm.unwrapResult(vm.evalCode(`Object.getPrototypeOf`));
  const entries = vm.unwrapResult(vm.evalCode(`Object.entries`));
  const eq = vm.unwrapResult(vm.evalCode(`Object.is`));

  const proto = { a: 100 };
  const protoHandle = vm.newObject();
  vm.setProp(protoHandle, "a", vm.newNumber(100));

  const obj = Object.create(proto);
  obj.b = "hoge";
  const handle = marshalObject(vm, obj, v =>
    v === proto ? protoHandle : vm.newString(v)
  );
  if (!handle) throw new Error("handle is undefined");

  expect(vm.typeof(handle)).toBe("object");
  expect(vm.getNumber(vm.getProp(handle, "a"))).toBe(100);
  expect(vm.getString(vm.getProp(handle, "b"))).toBe("hoge");
  const e = vm.unwrapResult(vm.callFunction(entries, vm.undefined, handle));
  expect(vm.dump(e)).toEqual([["b", "hoge"]]);
  const protoHandle2 = vm.unwrapResult(
    vm.callFunction(getPrototypeOf, vm.undefined, handle)
  );
  expect(
    vm.dump(
      vm.unwrapResult(
        vm.callFunction(eq, vm.undefined, protoHandle, protoHandle2)
      )
    )
  ).toBe(true);

  protoHandle2.dispose();
  e.dispose();
  handle.dispose();
  protoHandle.dispose();
  getPrototypeOf.dispose();
  entries.dispose();
  eq.dispose();
  vm.dispose();
});
