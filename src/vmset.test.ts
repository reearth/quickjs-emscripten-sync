import { getQuickJS } from "quickjs-emscripten";
import VMSet from "./vmset";

it("init and dispose", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  const set = new VMSet(vm);
  set.dispose();
  vm.dispose(); // test whether no exception occurs
});

it("has and add", async () => {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();
  const obj = vm.newObject();

  const set = new VMSet(vm);
  expect(set.has(obj)).toBe(false);
  set.add(obj);
  expect(set.has(obj)).toBe(true);
  obj.dispose();
  expect(set.has(obj)).toBe(false);

  set.dispose();
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
  const obj = vm.newObject();
  const obj2 = vm.newObject();
  const wrapped = vm.unwrapResult(
    vm.callFunction(wrapper, vm.undefined, obj, sym)
  );

  const set = new VMSet(vm, sym);
  expect(
    vm.dump(
      vm.unwrapResult(
        vm.callFunction(objectis, vm.undefined, sym, set.proxyTarget())
      )
    )
  ).toBe(true);
  expect(set.has(obj)).toBe(false);
  expect(set.has(obj2)).toBe(false);
  set.add(wrapped);
  expect(set.has(wrapped)).toBe(true);
  expect(set.has(obj)).toBe(true);
  expect(set.has(obj2)).toBe(false);

  set.dispose();
  wrapped.dispose();
  obj2.dispose();
  obj.dispose();
  sym.dispose();
  wrapper.dispose();
  objectis.dispose();
  vm.dispose(); // test whether no exception occurs
});
