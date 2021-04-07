import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default function marshalProperties(
  vm: QuickJSVm,
  target: object | Function,
  handle: QuickJSHandle,
  marshal: (target: unknown) => QuickJSHandle
): void {
  const descs = vm.newObject();

  Object.entries(Object.getOwnPropertyDescriptors(target)).forEach(
    ([key, desc]) => {
      const valueHandle =
        typeof desc.value === "undefined" ? undefined : marshal(desc.value);
      const getHandle =
        typeof desc.get === "undefined" ? undefined : marshal(desc.get);
      const setHandle =
        typeof desc.set === "undefined" ? undefined : marshal(desc.set);

      vm.newObject().consume(descObj => {
        Object.entries(desc).forEach(([k, v]) => {
          const v2 =
            k === "value"
              ? valueHandle
              : k === "get"
              ? getHandle
              : k === "set"
              ? setHandle
              : v
              ? vm.true
              : vm.false;
          if (v2) {
            vm.setProp(descObj, k, v2);
          }
        });
        vm.setProp(descs, key, descObj);
      });
    }
  );

  vm.unwrapResult(vm.evalCode(`Object.defineProperties`)).consume(
    defineProperties => {
      vm.unwrapResult(
        vm.callFunction(defineProperties, vm.undefined, handle, descs)
      ).dispose();
    }
  );

  descs.dispose();
}
