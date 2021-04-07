import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import { Marshaler } from ".";

it("primitive, array, object", async () => {
  const { vm, marshaler, dispose } = await setup();

  const target = {
    hoge: "foo",
    foo: 1,
    aaa: [1, true, {}],
    nested: { aa: null, hoge: undefined },
  };
  const [handle, disposables, map] = marshaler.marshal(target);
  if (!map) throw new Error("map is undefined");

  expect(vm.dump(handle)).toEqual(target);
  expect(map.size).toBe(4);
  expect(map.get(target)).toBe(handle);
  expect(map.has(target.aaa)).toBe(true);
  expect(map.has(target.nested)).toBe(true);
  expect(map.has(target.aaa[2])).toBe(true);

  disposables.forEach(d => d.dispose());
  dispose();
});

it("arrow function", async () => {
  const { vm, marshaler, dispose } = await setup();

  const hoge = () => "foo";
  hoge.foo = { bar: 1 };
  const [handle, disposables, map] = marshaler.marshal(hoge);
  if (!map) throw new Error("map is undefined");

  expect(vm.typeof(handle)).toBe("function");
  expect(vm.dump(vm.getProp(handle, "length"))).toBe(0);
  expect(vm.dump(vm.getProp(handle, "name"))).toBe("hoge");
  const foo = vm.getProp(handle, "foo");
  expect(vm.dump(foo)).toEqual({ bar: 1 });
  expect(vm.dump(vm.unwrapResult(vm.callFunction(handle, vm.undefined)))).toBe(
    "foo"
  );
  expect(map.size).toBe(2);
  expect(map.get(hoge)).toBe(handle);
  expect(map.has(hoge.foo)).toBe(true);

  foo.dispose();
  disposables.forEach(d => d.dispose());
  dispose();
});

it("function", async () => {
  const { vm, marshaler, dispose } = await setup();

  const bar = function(a: number, b: { hoge: number }) {
    return a + b.hoge;
  };
  const [handle, disposables, map] = marshaler.marshal(bar);
  if (!map) throw new Error("map is undefined");

  expect(vm.typeof(handle)).toBe("function");
  expect(vm.dump(vm.getProp(handle, "length"))).toBe(2);
  expect(vm.dump(vm.getProp(handle, "name"))).toBe("bar");
  expect(map.size).toBe(2);
  expect(map.get(bar)).toBe(handle);
  expect(map.has(bar.prototype)).toBe(true);

  const b = vm.unwrapResult(vm.evalCode(`({ hoge: 2 })`));
  expect(
    vm.dump(
      vm.unwrapResult(vm.callFunction(handle, vm.undefined, vm.newNumber(1), b))
    )
  ).toBe(3);

  b.dispose();
  disposables.forEach(d => d.dispose());
  dispose();
});

it("class", async () => {
  const { vm, marshaler, instanceOf, dispose } = await setup();

  class A {
    a: number;
    b: string;

    static a = new A("a");

    constructor(b: string) {
      this.a = 100;
      this.b = b + "!";
    }

    hoge() {
      return ++this.a;
    }

    get foo() {
      return this.b;
    }

    set foo(b: string) {
      this.b = b + "!";
    }
  }

  const [handle, disposables, map] = marshaler.marshal(A);
  if (!map) throw new Error("map is undefined");

  expect(map.size).toBe(6);
  expect(map.get(A)).toBe(handle);
  expect(map.has(A.prototype)).toBe(true);
  expect(map.has(A.a)).toBe(true);
  expect(map.has(A.prototype.hoge)).toBe(true);
  expect(
    map.has(Object.getOwnPropertyDescriptor(A.prototype, "foo")!.get)
  ).toBe(true);
  expect(
    map.has(Object.getOwnPropertyDescriptor(A.prototype, "foo")!.set)
  ).toBe(true);

  expect(vm.typeof(handle)).toBe("function");
  expect(vm.dump(vm.getProp(handle, "length"))).toBe(1);
  expect(vm.dump(vm.getProp(handle, "name"))).toBe("A");
  const staticA = vm.getProp(handle, "a");
  disposables.push(staticA);
  expect(instanceOf(staticA, handle)).toBe(true);
  expect(vm.dump(vm.getProp(staticA, "a"))).toBe(100);
  expect(vm.dump(vm.getProp(staticA, "b"))).toBe("a!");

  const newA = vm.unwrapResult(vm.evalCode(`A => new A("foo")`));
  const instance = vm.unwrapResult(vm.callFunction(newA, vm.undefined, handle));
  disposables.push(newA, instance);
  expect(instanceOf(instance, handle)).toBe(true);
  expect(vm.dump(vm.getProp(instance, "a"))).toBe(100);
  expect(vm.dump(vm.getProp(instance, "b"))).toBe("foo!");
  const methodHoge = vm.getProp(instance, "hoge");
  disposables.push(methodHoge);
  expect(vm.dump(vm.unwrapResult(vm.callFunction(methodHoge, instance)))).toBe(
    101
  );
  // ++this.a in hoge method does not work because the method is called in the host side and this arg is not proxied.
  expect(vm.dump(vm.getProp(instance, "a"))).toBe(100);

  const getter = vm.unwrapResult(vm.evalCode(`a => a.foo`));
  const setter = vm.unwrapResult(vm.evalCode(`(a, b) => a.foo = b`));
  disposables.push(getter, setter);
  expect(
    vm.dump(vm.unwrapResult(vm.callFunction(getter, vm.undefined, instance)))
  ).toBe("foo!");
  vm.unwrapResult(
    vm.callFunction(setter, vm.undefined, instance, vm.newString("b"))
  );
  // setter does not work because it is called in the host side and this arg is not proxied.
  expect(vm.dump(vm.getProp(instance, "b"))).toBe("foo!");

  disposables.forEach(d => d.dispose());
  dispose();
});

const setup = async () => {
  const vm = (await getQuickJS()).createVm();
  const unmarshaler = (v: QuickJSHandle) => vm.dump(v);
  const sym = vm.unwrapResult(vm.evalCode("Symbol()"));
  const instanceOf = vm.unwrapResult(vm.evalCode(`(a, b) => a instanceof b`));
  return {
    vm,
    marshaler: new Marshaler(vm, unmarshaler, sym),
    instanceOf: (a: QuickJSHandle, b: QuickJSHandle): boolean =>
      vm.dump(vm.unwrapResult(vm.callFunction(instanceOf, vm.undefined, a, b))),
    dispose: () => {
      instanceOf.dispose();
      sym.dispose();
      vm.dispose();
    },
  };
};
