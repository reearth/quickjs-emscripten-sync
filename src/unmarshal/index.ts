import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import unmarshalArray from "./array";
import unmarshalFunction from "./function";
import unmarshalObject from "./object";
import unmarshalPrimitive from "./primitive";

export type Options = {
  vm: QuickJSVm;
  marshal: (target: unknown) => QuickJSHandle;
  find: (handle: QuickJSHandle) => unknown | undefined;
  pre: <T>(target: T, handle: QuickJSHandle) => T | undefined;
};

export function unmarshal(handle: QuickJSHandle, options: Options): any {
  const [result] = unmarshalInner(handle, options);
  return result;
}

function unmarshalInner(
  handle: QuickJSHandle,
  options: Options
): [any, boolean] {
  const { vm, marshal, find, pre } = options;

  {
    const [target, ok] = unmarshalPrimitive(vm, handle);
    if (ok) return [target, false];
  }

  {
    const target = find(handle);
    if (target) {
      return [target, true];
    }
  }

  const unmarshal2 = (h: QuickJSHandle) => unmarshalInner(h, options);

  const result =
    unmarshalArray(vm, handle, unmarshal2, pre) ??
    unmarshalFunction(vm, handle, marshal, unmarshal2, pre) ??
    unmarshalObject(vm, handle, unmarshal2, pre);

  return [result, false];
}

export default unmarshal;
