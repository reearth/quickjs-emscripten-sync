import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { isES2015Class, isObject } from "../util";
import marshalProperties from "./properties";

export default function marshalFunction(
  vm: QuickJSVm,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => unknown,
  preMarshal: (target: unknown, handle: QuickJSHandle) => void,
  proxyTarget?: QuickJSHandle
): QuickJSHandle | undefined {
  if (typeof target !== "function") return;

  const handle2 = vm.newFunction(target.name, function(...argHandles) {
    const that = unmarshal(this);
    const args = argHandles.map(a => unmarshal(a));

    if (isES2015Class(target) && isObject(that)) {
      // Class constructors cannot be invoked without new expression, and new.target is not changed
      const result = new target(...args);
      Object.entries(result).forEach(([key, value]) => {
        (that as any)[key] = value;
      });
      return this;
    }

    const result = target.apply(that, args);
    return marshal(result);
  });

  // fucntions created by vm.newFunction are not callable as a class constrcutor
  const createClass = vm.unwrapResult(
    vm.evalCode(`(Cls, proxyTarget) => {
      const fn = function(...args) { return Cls.apply(this, args); };
      fn.name = Cls.name;
      if (typeof proxyTarget === "symbol") {
        fn[proxyTarget] = Cls;
      }
      return fn;
    }`)
  );
  const handle = vm.unwrapResult(
    vm.callFunction(
      createClass,
      vm.undefined,
      handle2,
      proxyTarget ?? vm.undefined
    )
  );
  createClass.dispose();
  handle2.dispose();

  preMarshal(target, handle);
  marshalProperties(vm, target, handle, marshal);

  return handle;
}
