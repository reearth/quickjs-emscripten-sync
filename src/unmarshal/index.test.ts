import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import VMMap from "../vmmap";
import unmarshal from ".";

it.only("primitive, array, object", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = jest.fn(() => vm.undefined);
  const map = new VMMap(vm);
  const find = jest.fn(h => map.getByHandle(h));
  const pre = jest.fn((t: any, h: QuickJSHandle) => {
    map.set(t, h);
    return t;
  });

  const handle = vm.unwrapResult(
    vm.evalCode(`({
      hoge: "foo",
      foo: 1,
      aaa: [1, true, {}],
      nested: { aa: null, hoge: undefined },
      bbb: () => "bar"
    })`)
  );
  const target = unmarshal(handle, { vm, pre, find, marshal });

  expect(target).toEqual({
    hoge: "foo",
    foo: 1,
    aaa: [1, true, {}],
    nested: { aa: null, hoge: undefined },
    bbb: expect.any(Function),
  });
  expect(map.size).toBe(5);
  expect(map.getByHandle(handle)).toBe(target);
  vm.getProp(handle, "aaa").consume(h =>
    expect(map.getByHandle(h)).toBe(target.aaa)
  );
  vm.getProp(handle, "aaa")
    .consume(h => vm.getProp(h, 2))
    .consume(h => expect(map.getByHandle(h)).toBe(target.aaa[2]));
  vm.getProp(handle, "nested").consume(h =>
    expect(map.getByHandle(h)).toBe(target.nested)
  );
  vm.getProp(handle, "bbb").consume(h =>
    expect(map.getByHandle(h)).toBe(target.bbb)
  );

  expect(marshal).toBeCalledTimes(0);
  expect(target.bbb()).toBe("bar");
  expect(marshal).toBeCalledTimes(1);
  expect(marshal).toBeCalledWith(target); // thisArg of target.bbb()

  handle.dispose();
  map.dispose();
  vm.dispose();
});

it.only("object with symbol key", async () => {
  const vm = (await getQuickJS()).createVm();
  const map = new VMMap(vm);
  const pre = (t: any, h: QuickJSHandle) => {
    map.set(t, h);
    return t;
  };

  const handle = vm.unwrapResult(
    vm.evalCode(`({
      hoge: "foo",
      [Symbol("a")]: "bar"
    })`)
  );
  const target = unmarshal(handle, {
    vm,
    pre,
    find: () => undefined,
    marshal: () => vm.undefined,
  });

  expect(target.hoge).toBe("foo");
  expect(target[Object.getOwnPropertySymbols(target)[0]]).toBe("bar");

  handle.dispose();
  map.dispose();
  vm.dispose();
});

it("func", async () => {
  const vm = (await getQuickJS()).createVm();
  const jsonParse = vm.unwrapResult(vm.evalCode(`JSON.parse`));
  const disposables: QuickJSHandle[] = [];
  const marshal = jest.fn((t: unknown) => {
    const h =
      t === undefined
        ? vm.undefined
        : vm.unwrapResult(
            vm.callFunction(
              jsonParse,
              vm.undefined,
              vm.newString(JSON.stringify(t))
            )
          );
    const ty = vm.typeof(h);
    if (ty === "object" || ty === "function") disposables.push(h);
    return h;
  });

  const handle = vm.unwrapResult(
    vm.evalCode(`(function(a) { return a.a + "!"; })`)
  );
  const map = new VMMap(vm);
  const find = jest.fn(h => map.getByHandle(h));
  const pre = jest.fn((t: any, h: QuickJSHandle) => {
    map.set(t, h);
    return t;
  });
  const func = unmarshal(handle, { vm, find, pre, marshal });
  const arg = { a: "hoge" };
  expect(func(arg)).toBe("hoge!");
  expect(marshal).toBeCalledTimes(2);
  expect(marshal).toBeCalledWith(undefined); // this
  expect(marshal).toBeCalledWith(arg); // arg
  expect(map.size).toBe(2);
  expect(map.getByHandle(handle)).toBe(func);
  expect(map.has(func.prototype)).toBe(true);

  map.dispose();
  disposables.forEach(d => d.dispose());
  jsonParse.dispose();
  vm.dispose();
});

it("class", async () => {
  const vm = (await getQuickJS()).createVm();
  const jsonParse = vm.unwrapResult(vm.evalCode(`JSON.parse`));
  const disposables: QuickJSHandle[] = [];
  const map = new VMMap(vm);
  const marshal = jest.fn((t: unknown) => {
    const h = vm.unwrapResult(
      vm.callFunction(jsonParse, vm.undefined, vm.newString(JSON.stringify(t)))
    );
    const ty = vm.typeof(h);
    if (ty === "object" || ty === "function") disposables.push(h);
    return h;
  });

  const handle = vm.unwrapResult(
    vm.evalCode(`{
      class Cls {
        static hoge = "foo";

        constructor(a) {
          this.foo = a + 2;
        }
      }
      Cls.foo = new Cls(1);

      Cls
    }`)
  );
  const find = jest.fn(h => map.getByHandle(h));
  const pre = jest.fn((t: any, h: QuickJSHandle) => {
    map.set(t, h);
    return t;
  });
  const Cls = unmarshal(handle, { vm, find, pre, marshal });

  expect(Cls.hoge).toBe("foo");
  expect(Cls.foo instanceof Cls).toBe(true);
  expect(Cls.foo.foo).toBe(3);
  const cls = new Cls(2);
  expect(cls instanceof Cls).toBe(true);
  expect(cls.foo).toBe(4);

  handle.dispose();
  map.dispose();
  disposables.forEach(d => d.dispose());
  jsonParse.dispose();
  vm.dispose();
});
