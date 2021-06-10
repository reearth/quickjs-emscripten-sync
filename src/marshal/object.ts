import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { call } from "../vmutil";
import marshalProperties from "./properties";

export default function marshalObject(
  vm: QuickJSVm,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  preMarshal: (
    target: unknown,
    handle: QuickJSHandle
  ) => QuickJSHandle | undefined
): QuickJSHandle | undefined {
  if (typeof target !== "object" || target === null) return;

  const raw = Array.isArray(target) ? vm.newArray() : vm.newObject();
  const handle = preMarshal(target, raw) ?? raw;

  // prototype
  const prototype = Object.getPrototypeOf(target);
  const prototypeHandle =
    prototype && prototype !== Object.prototype && prototype !== Array.prototype
      ? marshal(prototype)
      : undefined;
  if (prototypeHandle) {
    call(
      vm,
      "Object.setPrototypeOf",
      undefined,
      handle,
      prototypeHandle
    ).dispose();
  }

  marshalProperties(vm, target, raw, marshal);

  return handle;
}
