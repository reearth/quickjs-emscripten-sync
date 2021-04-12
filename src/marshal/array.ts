import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function marshalArray(
  vm: QuickJSVm,
  target: unknown,
  marshal: (target: any) => QuickJSHandle,
  preMarshal: (target: unknown, handle: QuickJSHandle) => QuickJSHandle
): QuickJSHandle | undefined {
  if (!Array.isArray(target)) return;

  const handle = preMarshal(target, vm.newArray());
  const push = vm.getProp(handle, "push");

  target.forEach(item => {
    const item2 = marshal(item);
    vm.unwrapResult(vm.callFunction(push, handle, item2));
  });

  push.dispose();
  return handle;
}
