import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { isES2015Class } from "../util";
import marshalProperties from "./properties";

export default function marshalFunction(
  vm: QuickJSVm,
  target: unknown,
  marshaler: (target: any) => QuickJSHandle,
  unmarshaler: (handle: QuickJSHandle) => any,
  proxyTarget?: QuickJSHandle
): QuickJSHandle | undefined {
  if (typeof target !== "function") return;

  const handle2 = vm.newFunction(target.name, function(...argHandles) {
    const that = unmarshaler(this);
    const args = argHandles.map(a => unmarshaler(a));

    if (isES2015Class(target)) {
      // Class constructors cannot be invoked without new expression, and new.target is not changed
      const result = new target(...args);
      Object.entries(result).forEach(([key, value]) => {
        that[key] = value;
      });
      return this;
    }

    const result = target.apply(that, args);
    return marshaler(result);
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

  marshalProperties(vm, target, handle, marshaler);

  return handle;
}
