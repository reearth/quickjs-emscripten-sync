import { Disposable, getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import { expect, test, vi } from "vitest";

import VMMap from "../vmmap";
import unmarshal from ".";
import { call, handleFrom, json } from "../vmutil";

test("primitive, array, object", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = vi.fn((): [QuickJSHandle, boolean] => [vm.undefined, false]);
  const map = new VMMap(vm);
  const find = vi.fn((h) => map.getByHandle(h));
  const pre = vi.fn((t: any, h: QuickJSHandle) => {
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

  handle.dispose();
  map.dispose();
  vm.dispose();
});

test("object with symbol key", async () => {
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
    marshal: () => [vm.undefined, false],
  });

  expect(target.hoge).toBe("foo");
  expect(target[Object.getOwnPropertySymbols(target)[0]]).toBe("bar");

  handle.dispose();
  map.dispose();
  vm.dispose();
});

test("function", async () => {
  const vm = (await getQuickJS()).createVm();
  const jsonParse = vm.unwrapResult(vm.evalCode(`JSON.parse`));
  const disposables: QuickJSHandle[] = [];
  const marshal = vi.fn((t: unknown): [QuickJSHandle, boolean] => {
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
    return [h, false];
  });

  const handle = vm.unwrapResult(
    vm.evalCode(`(function(a) { return a.a + "!"; })`)
  );
  const map = new VMMap(vm);
  const find = vi.fn((h) => map.getByHandle(h));
  const pre = vi.fn((t: any, h: QuickJSHandle) => {
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
  disposables.forEach((d) => d.dispose());
  jsonParse.dispose();
  vm.dispose();
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
  const vm = (await getQuickJS()).createVm();
  const jsonParse = vm.unwrapResult(vm.evalCode(`JSON.parse`));
  const disposables: QuickJSHandle[] = [];
  const map = new VMMap(vm);
  const marshal = vi.fn((t: unknown): [QuickJSHandle, boolean] => {
    const h = vm.unwrapResult(
      vm.callFunction(jsonParse, vm.undefined, vm.newString(JSON.stringify(t)))
    );
    const ty = vm.typeof(h);
    if (ty === "object" || ty === "function") disposables.push(h);
    return [h, false];
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
  const find = vi.fn((h) => map.getByHandle(h));
  const pre = vi.fn((t: any, h: QuickJSHandle) => {
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
  disposables.forEach((d) => d.dispose());
  jsonParse.dispose();
  vm.dispose();
});

const setup = async () => {
  const vm = (await getQuickJS()).createVm();
  const map = new VMMap(vm);
  const disposables: QuickJSHandle[] = [];

  return {
    vm,
    map,
    unmarshal: (handle: QuickJSHandle) =>
      unmarshal(handle, {
        find: (h) => map.getByHandle(h),
        marshal: (target) => {
          const handle = map.get(target);
          if (handle) return [handle, false];

          const handle2 =
            typeof target === "function"
              ? vm.newFunction(target.name, (...handles) => {
                  target(...handles.map((h) => vm.dump(h)));
                })
              : json(vm, target);
          map.set(target, handle2);
          return [handle2, false];
        },
        pre: (t, h) => {
          map.set(t, h);
          return t;
        },
        vm,
      }),
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      map.dispose();
      vm.dispose();
    },
  };
};
