import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { call } from "../vmutil";

export default function unmarshalProperties(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  target: object | Function,
  unmarshal: (handle: QuickJSHandle) => [unknown, boolean]
) {
  vm.newFunction("", (key, value) => {
    const keyName = vm.typeof(key) === "string" ? vm.getString(key) : undefined;
    if (!keyName) return; // symbol not supported

    const desc = ([
      ["value", true],
      ["get", true],
      ["set", true],
      ["configurable", false],
      ["enumerable", false],
      ["writable", false],
    ] as const).reduce<PropertyDescriptor>((desc, [key, unmarshable]) => {
      const h = vm.getProp(value, key);
      const ty = vm.typeof(h);

      if (ty === "undefined") return desc;
      if (!unmarshable && ty === "boolean") {
        desc[key] = vm.dump(vm.getProp(value, key));
        return desc;
      }

      const [v, alreadyExists] = unmarshal(h);
      if (alreadyExists) {
        h.dispose();
      }
      desc[key] = v;

      return desc;
    }, {});

    Object.defineProperty(target, keyName, desc);
  }).consume(fn => {
    call(
      vm,
      `(o, fn) => {
        Object.entries(Object.getOwnPropertyDescriptors(o)).forEach(([k, v]) => fn(k, v));
      }`,
      undefined,
      handle,
      fn
    ).dispose();
  });
}
