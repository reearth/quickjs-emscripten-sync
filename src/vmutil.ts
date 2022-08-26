import type {
  Disposable,
  QuickJSContext,
  QuickJSHandle,
  QuickJSDeferredPromise,
} from "quickjs-emscripten";

export function fn(
  ctx: QuickJSContext,
  code: string,
): ((thisArg: QuickJSHandle | undefined, ...args: QuickJSHandle[]) => QuickJSHandle) & Disposable {
  const handle = ctx.unwrapResult(ctx.evalCode(code));
  const f = (thisArg: QuickJSHandle | undefined, ...args: QuickJSHandle[]): any => {
    return ctx.unwrapResult(ctx.callFunction(handle, thisArg ?? ctx.undefined, ...args));
  };
  f.dispose = () => handle.dispose();
  f.alive = true;
  Object.defineProperty(f, "alive", {
    get: () => handle.alive,
  });
  return f;
}

export function call(
  ctx: QuickJSContext,
  code: string,
  thisArg?: QuickJSHandle,
  ...args: QuickJSHandle[]
): QuickJSHandle {
  const f = fn(ctx, code);
  try {
    return f(thisArg, ...args);
  } finally {
    f.dispose();
  }
}

export function eq(ctx: QuickJSContext, a: QuickJSHandle, b: QuickJSHandle): boolean {
  return ctx.dump(call(ctx, "Object.is", undefined, a, b));
}

export function instanceOf(ctx: QuickJSContext, a: QuickJSHandle, b: QuickJSHandle): boolean {
  return ctx.dump(call(ctx, "(a, b) => a instanceof b", undefined, a, b));
}

export function isHandleObject(ctx: QuickJSContext, h: QuickJSHandle): boolean {
  return ctx.dump(
    call(ctx, `a => typeof a === "object" && a !== null || typeof a === "function"`, undefined, h),
  );
}

export function json(ctx: QuickJSContext, target: any): QuickJSHandle {
  const json = JSON.stringify(target);
  if (!json) return ctx.undefined;
  return call(ctx, `JSON.parse`, undefined, ctx.newString(json));
}

export function consumeAll<T extends QuickJSHandle[], K>(handles: T, cb: (handles: T) => K): K {
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
  fn: (h: QuickJSHandle) => T,
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
  fn: (...args: H) => T,
) {
  try {
    return fn(...(handles.map(h => h[0]) as H));
  } finally {
    for (const [handle, shouldBeDisposed] of handles) {
      if (shouldBeDisposed) {
        handle.dispose();
      }
    }
  }
}

function isQuickJSDeferredPromise(d: Disposable): d is QuickJSDeferredPromise {
  return "handle" in d;
}

export function handleFrom(d: QuickJSDeferredPromise | QuickJSHandle): QuickJSHandle {
  return isQuickJSDeferredPromise(d) ? d.handle : d;
}
