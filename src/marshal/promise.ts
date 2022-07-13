import type {
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSVm,
} from "quickjs-emscripten";

export default function marshalPromise(
  vm: QuickJSVm,
  target: unknown,
  marshal: (target: unknown) => QuickJSHandle,
  preMarshal: (
    target: unknown,
    handle: QuickJSDeferredPromise
  ) => QuickJSHandle | undefined
) {
  if (!(target instanceof Promise)) return;

  const promise = vm.newPromise();

  target.then(
    (d) => promise.resolve(marshal(d)),
    (d) => promise.reject(marshal(d))
  );

  return preMarshal(target, promise) ?? promise.handle;
}
