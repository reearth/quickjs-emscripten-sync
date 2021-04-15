import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";
import { call } from "../vmutil";

export default function unmarshalArray(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => [unknown, boolean],
  preUnmarshal: <T>(target: T, handle: QuickJSHandle) => T | undefined
): any[] | undefined {
  const isArrayFunc = vm.unwrapResult(vm.evalCode(`Array.isArray`));
  const isArray = vm.dump(
    vm.unwrapResult(vm.callFunction(isArrayFunc, vm.undefined, handle))
  );
  isArrayFunc.dispose();

  if (!isArray) return;

  const raw: any[] = [];
  const array = preUnmarshal(raw, handle) ?? raw;

  vm.newFunction("", (value, index) => {
    const i = vm.getNumber(index);
    const [v] = unmarshal(value);
    if (v) {
      raw[i] = v;
    }
  }).consume(fn => {
    call(vm, `(a, fn) => a.forEach((v, i) => fn(v, i))`, undefined, handle, fn);
  });

  return array;
}
