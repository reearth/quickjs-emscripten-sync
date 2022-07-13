import { Disposable, getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import { expect, test, vi } from "vitest";

import VMMap from "../vmmap";
import unmarshal from ".";
import { json } from "../vmutil";

test("primitive, array, object", async () => {
  const { vm, unmarshal, marshal, map, dispose } = await setup();

  const handle = vm.unwrapResult(
    vm.evalCode(`({
      hoge: "foo",
      foo: 1,
      aaa: [1, true, {}],
      nested: { aa: null, hoge: undefined },
      bbb: () => "bar"
    })`)
  );
  const target = unmarshal(handle);

  expect(target).toEqual({
    hoge: "foo",
    foo: 1,
    aaa: [1, true, {}],
    nested: { aa: null, hoge: undefined },
    bbb: expect.any(Function),
  });
  expect(map.size).toBe(5);
  expect(map.getByHandle(handle)).toBe(target);
  vm.getProp(handle, "aaa").consume((h) =>
    expect(map.getByHandle(h)).toBe(target.aaa)
  );
  vm.getProp(handle, "aaa")
    .consume((h) => vm.getProp(h, 2))
    .consume((h) => expect(map.getByHandle(h)).toBe(target.aaa[2]));
  vm.getProp(handle, "nested").consume((h) =>
    expect(map.getByHandle(h)).toBe(target.nested)
  );
  vm.getProp(handle, "bbb").consume((h) =>
    expect(map.getByHandle(h)).toBe(target.bbb)
  );

  expect(marshal).toBeCalledTimes(0);
  expect(target.bbb()).toBe("bar");
  expect(marshal).toBeCalledTimes(1);
  expect(marshal).toBeCalledWith(target); // thisArg of target.bbb()

  dispose();
});

test("object with symbol key", async () => {
  const { vm, unmarshal, dispose } = await setup();

  const handle = vm.unwrapResult(
    vm.evalCode(`({
      hoge: "foo",
      [Symbol("a")]: "bar"
    })`)
  );
  const target = unmarshal(handle);

  expect(target.hoge).toBe("foo");
  expect(target[Object.getOwnPropertySymbols(target)[0]]).toBe("bar");

  dispose();
});

test("function", async () => {
  const { vm, unmarshal, marshal, map, dispose } = await setup();

  const handle = vm.unwrapResult(
    vm.evalCode(`(function(a) { return a.a + "!"; })`)
  );
  const func = unmarshal(handle);
  const arg = { a: "hoge" };
  expect(func(arg)).toBe("hoge!");
  expect(marshal).toBeCalledTimes(2);
  expect(marshal).toBeCalledWith(undefined); // this
  expect(marshal).toBeCalledWith(arg); // arg
  expect(map.size).toBe(3);
  expect(map.getByHandle(handle)).toBe(func);
  expect(map.has(func)).toBe(true);
  expect(map.has(func.prototype)).toBe(true);
  expect(map.has(arg)).toBe(true);

  dispose();
});

test("promise", async () => {
  const { vm, unmarshal, dispose } = await setup();

  const deferred = vm.newPromise();
  const promise = unmarshal(deferred.handle);
  deferred.resolve(vm.newString("resolved!"));
  vm.executePendingJobs();
  await expect(promise).resolves.toBe("resolved!");

  const deferred2 = vm.newPromise();
  const promise2 = unmarshal(deferred2.handle);
  deferred2.reject(vm.newString("rejected!"));
  vm.executePendingJobs();
  await expect(promise2).rejects.toBe("rejected!");

  deferred.dispose();
  deferred2.dispose();
  dispose();
});

test("class", async () => {
  const { vm, unmarshal, dispose } = await setup();

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
  const Cls = unmarshal(handle);

  expect(Cls.hoge).toBe("foo");
  expect(Cls.foo instanceof Cls).toBe(true);
  expect(Cls.foo.foo).toBe(3);
  const cls = new Cls(2);
  expect(cls instanceof Cls).toBe(true);
  expect(cls.foo).toBe(4);

  handle.dispose();
  dispose();
});

const setup = async () => {
  const vm = (await getQuickJS()).createVm();
  const map = new VMMap(vm);
  const disposables: QuickJSHandle[] = [];
  const marshal = vi.fn((target: unknown): [QuickJSHandle, boolean] => {
    const handle = map.get(target);
    if (handle) return [handle, false];

    const handle2 =
      typeof target === "function"
        ? vm.newFunction(target.name, (...handles) => {
            target(...handles.map((h) => vm.dump(h)));
          })
        : json(vm, target);
    const ty = vm.typeof(handle2);
    if (ty === "object" || ty === "function") map.set(target, handle2);
    return [handle2, false];
  });

  return {
    vm,
    map,
    unmarshal: (handle: QuickJSHandle) =>
      unmarshal(handle, {
        find: (h) => map.getByHandle(h),
        marshal,
        pre: (t, h) => {
          map.set(t, h);
          return t;
        },
        vm,
      }),
    marshal,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      map.dispose();
      vm.dispose();
    },
  };
};
