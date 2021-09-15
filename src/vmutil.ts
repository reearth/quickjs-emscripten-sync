import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export function call(
  vm: QuickJSVm,
  code: string,
  thisArg?: QuickJSHandle,
  ...args: QuickJSHandle[]
): QuickJSHandle {
  return vm.unwrapResult(vm.evalCode(code)).consume((f) => {
    if (typeof thisArg === "undefined" && args.length === 0) return f;
    return vm.unwrapResult(
      vm.callFunction(f, thisArg ?? vm.undefined, ...args)
    );
  });
}

export function eq(vm: QuickJSVm, a: QuickJSHandle, b: QuickJSHandle): boolean {
  return vm.dump(call(vm, "Object.is", undefined, a, b));
}

export function instanceOf(
  vm: QuickJSVm,
  a: QuickJSHandle,
  b: QuickJSHandle
): boolean {
  return vm.dump(call(vm, "(a, b) => a instanceof b", undefined, a, b));
}

export function isHandleObject(vm: QuickJSVm, a: QuickJSHandle): boolean {
  return vm.dump(
    call(
      vm,
      `a => typeof a === "object" && a !== null || typeof a === "function"`,
      undefined,
      a
    )
  );
}

export function json(vm: QuickJSVm, target: any): QuickJSHandle {
  const json = JSON.stringify(target);
  if (!json) return vm.undefined;
  return call(vm, `JSON.parse`, undefined, vm.newString(json));
}

export function consumeAll<T extends QuickJSHandle[], K>(
  handles: T,
  cb: (handles: T) => K
): K {
  try {
    return cb(handles);
  } finally {
    for (const h of handles) {
      if (h.alive) h.dispose();
    }
  }
}

export function mayConsume<T>(
  [handle, shouldBeDisposed]: [QuickJSHandle, boolean],
  fn: (h: QuickJSHandle) => T
) {
  try {
    return fn(handle);
  } finally {
    if (shouldBeDisposed) {
      handle.dispose();
    }
  }
}

export function mayConsumeAll<T, H extends QuickJSHandle[]>(
  handles: { [P in keyof H]: [QuickJSHandle, boolean] },
  fn: (...args: H) => T
) {
  try {
    return fn(...(handles.map((h) => h[0]) as H));
  } finally {
    for (const [handle, shouldBeDisposed] of handles) {
      if (shouldBeDisposed) {
        handle.dispose();
      }
    }
  }
}
