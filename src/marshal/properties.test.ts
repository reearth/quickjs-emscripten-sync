import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import marshalProperties from "./properties";

it("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const descTester = vm.unwrapResult(
    vm.evalCode(`(obj, expected) => {
      const descs = Object.getOwnPropertyDescriptors(obj);
      for (const [k, v] of Object.entries(expected)) {
        const d = descs[k];
        if (v.valueType && typeof d.value !== v.valueType) throw new Error(k + " value invalid");
        if (v.getType && typeof d.get !== v.getType) throw new Error(k + " get invalid");
        if (v.setType && typeof d.set !== v.setType) throw new Error(k + " set invalid");
        if (typeof v.enumerable === "boolean" && d.enumerable !== v.enumerable) throw new Error(k + " enumerable invalid: " + d.enumerable);
        if (typeof v.configurable === "boolean" && d.configurable !== v.configurable) throw new Error(k + " configurable invalid: " + d.configurable);
        if (typeof v.writable === "boolean" && d.writable !== v.writable) throw new Error(k + " writable invalid: " + d.writable);
      }
    }`)
  );

  const disposables: QuickJSHandle[] = [];
  const marshal = jest.fn(() => {
    const fn = vm.newFunction("", () => {});
    disposables.push(fn);
    return fn;
  });

  const handle = vm.newObject();
  const obj = {};
  const bar = () => {};
  const fooGet = () => {};
  const fooSet = () => {};
  Object.defineProperties(obj, {
    bar: {
      value: bar,
      enumerable: true,
      configurable: true,
      writable: true,
    },
    foo: {
      get: fooGet,
      set: fooSet,
      enumerable: false,
      configurable: true,
    },
  });

  marshalProperties(vm, obj, handle, marshal);
  expect(marshal.mock.calls).toEqual([[bar], [fooGet], [fooSet]]);

  const expected = vm.unwrapResult(
    vm.evalCode(`({
      bar: { valueType: "function", getType: "undefined", setType: "undefined", enumerable: true, configurable: true, writable: true },
      foo: { valueType: "undefined", getType: "function", setType: "function", enumerable: false, configurable: true }
    })`)
  );
  vm.unwrapResult(vm.callFunction(descTester, vm.undefined, handle, expected));

  expected.dispose();
  disposables.forEach(d => d.dispose());
  handle.dispose();
  descTester.dispose();
  vm.dispose();
});

it("empty", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = jest.fn();
  const handle = vm.newObject();
  const obj = {};

  marshalProperties(vm, obj, handle, marshal);
  expect(marshal).toHaveBeenCalledTimes(0);

  handle.dispose();
  vm.dispose();
});
