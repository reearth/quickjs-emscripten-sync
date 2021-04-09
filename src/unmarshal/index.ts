import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalArray from "./array";
import unmarshalFunction from "./function";
import unmarshalObject from "./object";
import unmarshalPrimitive from "./primitive";
import VMMap from "../vmmap";

export function unmarshal(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  map: VMMap,
  marshal: (target: unknown) => QuickJSHandle
): any {
  if (vm !== map.vm) {
    throw new Error("vm and map.vm do not match");
  }

  {
    const [target, ok] = unmarshalPrimitive(vm, handle);
    if (ok) return target;
  }

  {
    const target = map.getByHandle(handle);
    if (target) {
      return target;
    }
  }

  const unmarshal2 = (h: QuickJSHandle) => unmarshal(vm, h, map, marshal);
  const preUnmarshal = (target: unknown, h: QuickJSHandle) => {
    map.set(target, h);
  };

  return (
    unmarshalArray(vm, handle, unmarshal2, preUnmarshal) ??
    unmarshalFunction(vm, handle, marshal, unmarshal2, preUnmarshal) ??
    unmarshalObject(vm, handle, unmarshal2, preUnmarshal)
  );
}
