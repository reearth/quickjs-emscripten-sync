import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import unmarshalProperties from "./properties";

test("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const disposables: QuickJSHandle[] = [];
  const unmarshal = jest.fn((v: QuickJSHandle): [unknown, boolean] => {
    disposables.push(v);
    return [vm.typeof(v) === "function" ? () => {} : vm.dump(v), false];
  });
  const obj = {};

  const handle = vm.unwrapResult(
    vm.evalCode(`{
      const obj = {};
      Object.defineProperties(obj, {
        a: { value: 1, writable: true, configurable: true, enumerable: true },
        b: { value: 2 },
        c: { get: () => {}, set: () => {} },
      });
      obj
    }`)
  );

  unmarshalProperties(vm, handle, obj, unmarshal);

  expect(obj).toEqual({
    a: 1,
  });
  expect(Object.getOwnPropertyDescriptors(obj)).toEqual({
    a: { value: 1, writable: true, configurable: true, enumerable: true },
    b: { value: 2, writable: false, configurable: false, enumerable: false },
    c: {
      get: expect.any(Function),
      set: expect.any(Function),
      configurable: false,
      enumerable: false,
    },
  });
  expect(unmarshal).toBeCalledTimes(7); // a.value, b.value, c.get, c.set
  expect(unmarshal).toReturnWith(["a", false]);
  expect(unmarshal).toReturnWith([1, false]);
  expect(unmarshal).toReturnWith(["b", false]);
  expect(unmarshal).toReturnWith([2, false]);
  expect(unmarshal).toReturnWith(["c", false]);
  expect(unmarshal).toReturnWith([expect.any(Function), false]); // get, set

  disposables.forEach((d) => d.dispose());
  handle.dispose();
  vm.dispose();
});
