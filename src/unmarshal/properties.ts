import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function unmarshalProperties(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  target: object | Function,
  unmarshal: (handle: QuickJSHandle) => unknown
) {
  vm.newFunction("", (key, value) => {
    const keyName = vm.typeof(key) === "string" ? vm.getString(key) : undefined;
    if (!keyName) return; // symbol not supported

    const vh = vm.getProp(value, "value");
    const v = vm.typeof(vh) === "undefined" ? undefined : unmarshal(vh);
    const geth = vm.getProp(value, "get");
    const get =
      vm.typeof(geth) === "undefined"
        ? undefined
        : (unmarshal(geth) as () => any);
    const seth = vm.getProp(value, "set");
    const set =
      vm.typeof(seth) === "undefined"
        ? undefined
        : (unmarshal(seth) as () => any);
    const configurable = vm.dump(vm.getProp(value, "configurable")) as
      | boolean
      | undefined;
    const enumerable = vm.dump(vm.getProp(value, "enumerable")) as
      | boolean
      | undefined;
    const writable = vm.dump(vm.getProp(value, "writable")) as
      | boolean
      | undefined;
    const acessor = typeof get !== "undefined" || typeof set !== "undefined";

    const desc = {
      ...(!acessor && typeof v !== "undefined" ? { value: v } : {}),
      ...(!acessor && typeof writable !== "undefined" ? { writable } : {}),
      ...(acessor && typeof get !== "undefined" ? { get } : {}),
      ...(acessor && typeof set !== "undefined" ? { set } : {}),
      ...(typeof configurable !== "undefined" ? { configurable } : {}),
      ...(typeof enumerable !== "undefined" ? { enumerable } : {}),
    };

    Object.defineProperty(target, keyName, desc);
  }).consume(fn => {
    vm.unwrapResult(
      vm.evalCode(
        `(o, fn) => { Object.entries(Object.getOwnPropertyDescriptors(o)).forEach(([k, v]) => fn(k, v)); }`
      )
    ).consume(getOwnPropertyDescriptors => {
      vm.unwrapResult(
        vm.callFunction(getOwnPropertyDescriptors, vm.undefined, handle, fn)
      ).dispose();
    });
  });
}
