import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export type Functions<T extends string> = {
  [K in T]: (
    thisArg: QuickJSHandle | undefined,
    ...args: QuickJSHandle[]
  ) => QuickJSHandle;
};

export default function functions<T extends string>(
  vm: QuickJSVm,
  funcs: { [K in T]: string }
): [Functions<T>, () => void] {
  const handles: QuickJSHandle[] = [];
  const funcs2 = Object.entries<string>(funcs)
    .map(([k, v]) => {
      const handle = vm.unwrapResult(vm.evalCode(v));
      handles.push(handle);
      return [
        k,
        (thisArg: QuickJSHandle | undefined, ...args: QuickJSHandle[]) =>
          vm.unwrapResult(
            vm.callFunction(
              handle,
              typeof thisArg === "undefined" ? vm.undefined : thisArg,
              ...args
            )
          ),
      ] as const;
    })
    .reduce((a, b) => ({ ...a, [b[0]]: b[1] }), {} as Functions<T>);

  return [
    funcs2,
    () => {
      handles.forEach(v => v.dispose());
      handles.length = 0;
    },
  ];
}
