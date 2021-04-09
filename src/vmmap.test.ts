import { getQuickJS } from "quickjs-emscripten";
import VMMap from "./vmmap";

it("init and dispose", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const map = new VMMap(vm);
  map.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("get and set", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  expect(map.get(target)).toBe(undefined);
  map.set(target, handle);
  expect(map.get(target)).toBe(handle);
  // a new handle that points to the same value
  const handle2 = vm
    .unwrapResult(vm.evalCode(`a => a`))
    .consume(a => vm.unwrapResult(vm.callFunction(a, vm.undefined, handle)));
  expect(() => map.set(target, handle2)).toThrow(
    "handle already exists that points to the same value"
  );

  handle2.dispose();
  handle.dispose();
  expect(map.get(target)).toBe(undefined);

  map.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("getByHandle", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);
  expect(map.getByHandle(handle)).toBe(undefined);
  map.set(target, handle);
  expect(map.getByHandle(handle)).toBe(target);
  expect(map.getByHandle(handle2)).toBe(undefined);
  handle.dispose();
  expect(map.getByHandle(handle)).toBe(undefined);

  handle2.dispose();
  map.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("delete", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  map.set(target, handle);
  expect(map.get(target)).toBe(handle);
  map.delete({});
  expect(map.get(target)).toBe(handle);
  map.delete(target);
  expect(map.get(target)).toBe(undefined);

  handle.dispose();
  map.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("size and cleanup", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  expect(map.size).toBe(0);
  map.set(target, handle);
  expect(map.size).toBe(1);
  handle.dispose();
  expect(map.size).toBe(1);
  map.cleanup();
  expect(map.size).toBe(0);

  map.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("clear", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  map.set(target, handle);
  expect(map.size).toBe(1);
  expect(map.get(target)).toBe(handle);
  map.clear();
  expect(map.size).toBe(0);
  expect(map.get(target)).toBe(undefined);

  handle.dispose();
  map.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("merge", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  const map2 = new VMMap(vm);
  map.set(target, handle);
  expect(map.size).toBe(1);
  expect(map.get(target)).toBe(handle);
  expect(map2.size).toBe(0);
  map2.merge(map);
  expect(map2.size).toBe(1);
  expect(map2.get(target)).toBe(handle);

  map.clear();
  map.dispose();
  map2.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("entries", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  expect(Array.from(map.entries())).toEqual([]);
  map.set(target, handle);
  expect(Array.from(map.entries())).toEqual([[target, handle]]);

  handle.dispose();
  map.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("symbol", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();
  const objectis = vm.unwrapResult(vm.evalCode("Object.is"));
  const wrapper = vm.unwrapResult(
    vm.evalCode(
      `(v, s) => new Proxy(v, { get: (o, k) => k === s ? o : Reflect.get(o, k) })`
    )
  );

  const sym = vm.unwrapResult(vm.evalCode("Symbol()"));
  const key = {};
  const obj = vm.newObject();
  const obj2 = vm.newObject();
  const wrapped = vm.unwrapResult(
    vm.callFunction(wrapper, vm.undefined, obj, sym)
  );

  const map = new VMMap(vm, sym);
  expect(
    vm.dump(
      vm.unwrapResult(
        vm.callFunction(objectis, vm.undefined, sym, map.proxyTarget())
      )
    )
  ).toBe(true);

  expect(map.get(key)).toBe(undefined);
  expect(map.getByHandle(wrapped)).toBe(undefined);
  expect(map.getByHandle(obj)).toBe(undefined);
  expect(map.getByHandle(obj2)).toBe(undefined);

  map.set(key, wrapped);

  expect(map.get(key)).toBe(wrapped);
  expect(map.getByHandle(wrapped)).toBe(key);
  expect(map.getByHandle(obj)).toBe(key);
  expect(map.getByHandle(obj2)).toBe(undefined);

  expect(wrapped.alive).toBe(true);
  map.dispose();
  expect(wrapped.alive).toBe(false);

  obj2.dispose();
  obj.dispose();
  sym.dispose();
  wrapper.dispose();
  objectis.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("iterator", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  map.set(target, handle);

  const iter = map[Symbol.iterator]();
  const first = iter.next();
  expect(first.value[0]).toBe(target);
  expect(first.value[1] === handle).toBe(true);
  expect(first.done).toBe(false);
  const second = iter.next();
  expect(second.done).toBe(true);

  let i = 0;
  for (const [k, v] of map) {
    expect(k).toBe(target);
    expect(v === handle).toBe(true);
    i++;
  }
  expect(i).toBe(1);

  map.dispose();
  vm.dispose(); // test whether no exception occurs
});
