import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function marshalArray(
  vm: QuickJSVm,
  target: unknown,
  marshal: (target: any) => QuickJSHandle,
  preMarshal: (
    target: unknown,
    handle: QuickJSHandle
  ) => QuickJSHandle | undefined
): QuickJSHandle | undefined {
  if (!Array.isArray(target)) return;

  const raw = vm.newArray();
  const handle = preMarshal(target, raw) ?? raw;
  const push = vm.getProp(raw, "push");

  target.forEach(item => {
    const item2 = marshal(item);
    vm.unwrapResult(vm.callFunction(push, raw, item2));
  });

  push.dispose();
  return handle;
}
