import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function marshalArray(
  vm: QuickJSVm,
  target: any,
  marshaler: (target: any) => QuickJSHandle
): QuickJSHandle | undefined {
  if (!Array.isArray(target)) return;

  const handle = vm.newArray();
  const push = vm.getProp(handle, "push");

  target.forEach(item => {
    const item2 = marshaler(item);
    vm.unwrapResult(vm.callFunction(push, handle, item2));
  });

  push.dispose();
  return handle;
}
