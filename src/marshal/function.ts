import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { isES2015Class, isObject } from "../util";
import { call } from "../vmutil";
import marshalProperties from "./properties";

export default function marshalFunction(
  vm: QuickJSVm,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => unknown,
  preMarshal: (
    target: unknown,
    handle: QuickJSHandle
  ) => QuickJSHandle | undefined,
  preApply?: (target: Function, thisArg: unknown, args: unknown[]) => any
): QuickJSHandle | undefined {
  if (typeof target !== "function") return;

  const raw = vm
    .newFunction(target.name, function (...argHandles) {
      const that = unmarshal(this);
      const args = argHandles.map((a) => unmarshal(a));

      if (isES2015Class(target) && isObject(that)) {
        // Class constructors cannot be invoked without new expression, and new.target is not changed
        const result = new target(...args);
        Object.entries(result).forEach(([key, value]) => {
          vm.setProp(this, key, marshal(value));
        });
        return this;
      }

      return marshal(
        preApply ? preApply(target, that, args) : target.apply(that, args)
      );
    })
    .consume((handle2) =>
      // fucntions created by vm.newFunction are not callable as a class constrcutor
      call(
        vm,
        `Cls => {
          const fn = function(...args) { return Cls.apply(this, args); };
          fn.name = Cls.name;
          fn.length = Cls.length;
          return fn;
        }`,
        undefined,
        handle2
      )
    );

  const handle = preMarshal(target, raw) ?? raw;
  marshalProperties(vm, target, raw, marshal);

  return handle;
}
