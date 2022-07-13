import { getQuickJS } from "quickjs-emscripten";
import { expect, test } from "vitest";

import VMMap from "./vmmap";
import { call } from "./vmutil";

test("init and dispose", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const map = new VMMap(vm);
  map.dispose();
  vm.dispose();
});

test("get and set", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();

  const map = new VMMap(vm);
  expect(map.get(target)).toBe(undefined);
  expect(map.set(target, handle)).toBe(true);
  expect(map.get(target)).toBe(handle);
  // a new handle that points to the same value
  const handle2 = call(vm, `a => a`, undefined, handle);
  expect(map.set(target, handle2)).toBe(false);

  handle2.dispose();
  handle.dispose();
  expect(map.get(target)).toBe(undefined);

  map.dispose();
  vm.dispose();
});

test("getByHandle", async () => {
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
  vm.dispose();
});

test("keys", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);
  expect(Array.from(map.keys())).toEqual([]);
  map.set(target, handle);
  expect(Array.from(map.keys())).toEqual([target]);
  handle.dispose();
  expect(Array.from(map.keys())).toEqual([target]);

  handle2.dispose();
  map.dispose();
  vm.dispose();
});

test("delete", async () => {
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
  vm.dispose();
});

test("size", async () => {
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

  map.dispose();
  vm.dispose();
});

test("clear", async () => {
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
  vm.dispose();
});

test("merge", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);
  const map2 = new VMMap(vm);
  map.set(target, handle, target2, handle2);
  expect(map.size).toBe(1);
  expect(map.get(target)).toBe(handle);
  expect(map.get(target2)).toBe(handle);
  expect(map2.size).toBe(0);
  map2.merge(map);
  expect(map2.size).toBe(1);
  expect(map2.get(target)).toBe(handle);
  expect(map2.get(target2)).toBe(handle);

  map.clear();
  map.dispose();
  map2.dispose();
  vm.dispose();
});

test("iterator", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);
  map.set(target, handle, target2, handle2);

  const iter = map[Symbol.iterator]();
  const first = iter.next();
  expect(first.value[0]).toBe(target);
  expect(first.value[1] === handle).toBe(true);
  expect(first.value[2]).toBe(target2);
  expect(first.value[3] === handle2).toBe(true);
  expect(first.done).toBe(false);

  const second = iter.next();
  expect(second.done).toBe(true);

  let i = 0;
  for (const [k, v, k2, v2] of map) {
    expect(k).toBe(target);
    expect(v === handle).toBe(true);
    expect(k2).toBe(target2);
    expect(v2 === handle2).toBe(true);
    i++;
  }
  expect(i).toBe(1);

  map.dispose();
  vm.dispose();
});

test("get and set 2", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();
  const handle3 = call(vm, `a => a`, undefined, handle);

  const map = new VMMap(vm);

  map.set(target, handle, target2, handle2);
  expect(map.get(target)).toBe(handle);
  expect(map.get(target2)).toBe(handle);
  expect(map.getByHandle(handle)).toBe(target);
  expect(map.getByHandle(handle2)).toBe(target);
  expect(map.getByHandle(handle3)).toBe(target);

  handle3.dispose();
  handle2.dispose();
  handle.dispose();

  expect(map.get(target)).toBe(undefined);
  expect(map.get(target2)).toBe(undefined);
  expect(map.getByHandle(handle)).toBe(undefined);
  expect(map.getByHandle(handle2)).toBe(undefined);

  map.dispose();
  vm.dispose();
});

test("delete 2", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);

  map.set(target, handle, target2, handle2);
  expect(map.get(target)).toBe(handle);
  expect(map.get(target2)).toBe(handle);
  expect(map.getByHandle(handle)).toBe(target);
  expect(map.getByHandle(handle2)).toBe(target);

  map.delete(target);

  expect(map.get(target)).toBe(undefined);
  expect(map.get(target2)).toBe(undefined);
  expect(map.getByHandle(handle)).toBe(undefined);
  expect(map.getByHandle(handle2)).toBe(undefined);

  handle.dispose();
  handle2.dispose();
  map.dispose();
  vm.dispose();
});

test("delete 3", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);

  map.set(target, handle, target2, handle2);
  expect(map.get(target)).toBe(handle);
  expect(map.get(target2)).toBe(handle);
  expect(map.getByHandle(handle)).toBe(target);
  expect(map.getByHandle(handle2)).toBe(target);

  map.delete(target2);

  expect(map.get(target)).toBe(undefined);
  expect(map.get(target2)).toBe(undefined);
  expect(map.getByHandle(handle)).toBe(undefined);
  expect(map.getByHandle(handle2)).toBe(undefined);

  handle.dispose();
  handle2.dispose();
  map.dispose();
  vm.dispose();
});

test("delete with dispose", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);
  map.set(target, handle, target2, handle2);
  map.delete(target, true);

  expect(handle.alive).toBe(false);
  expect(handle2.alive).toBe(false);

  map.dispose();
  vm.dispose();
});

test("deleteByHandle", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);
  map.set(target, handle, target2, handle2);

  expect(map.getByHandle(handle)).toBe(target);
  expect(map.getByHandle(handle2)).toBe(target);

  map.deleteByHandle(handle);

  expect(map.getByHandle(handle)).toBe(undefined);
  expect(map.getByHandle(handle2)).toBe(undefined);

  handle.dispose();
  handle2.dispose();
  map.dispose();
  vm.dispose();
});

test("deleteByHandle with dispose", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const target = {};
  const target2 = {};
  const handle = vm.newObject();
  const handle2 = vm.newObject();

  const map = new VMMap(vm);
  map.set(target, handle, target2, handle2);
  map.deleteByHandle(handle, true);

  expect(handle.alive).toBe(false);
  expect(handle2.alive).toBe(false);

  map.dispose();
  vm.dispose();
});
