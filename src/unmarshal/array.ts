import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

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
    vm.unwrapResult(
      vm.evalCode(`(a, fn) => a.forEach((v, i) => fn(v, i))`)
    ).consume(forEach => {
      vm.unwrapResult(vm.callFunction(forEach, vm.undefined, handle, fn));
    });
  });

  return array;
}
