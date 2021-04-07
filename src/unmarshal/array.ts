import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function unmarshalArray(
  vm: QuickJSVm,
  handle: QuickJSHandle,
  unmarshal: (handle: QuickJSHandle) => unknown,
  preUnmarshal: (target: unknown, handle: QuickJSHandle) => void
): any[] | undefined {
  const isArrayFunc = vm.unwrapResult(vm.evalCode(`Array.isArray`));
  const isArray = vm.dump(
    vm.unwrapResult(vm.callFunction(isArrayFunc, vm.undefined, handle))
  );
  isArrayFunc.dispose();

  if (!isArray) return;

  let array: any[] = [];
  preUnmarshal(array, handle);

  vm.newFunction("", (value, index) => {
    const i = vm.getNumber(index);
    const v = unmarshal(value);

    if (v) {
      array[i] = v;
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
