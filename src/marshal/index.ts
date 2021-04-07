import { QuickJSHandle, QuickJSVm } from "quickjs-emscripten";
import { mergeMap } from "../util";
import marshalArray from "./array";
import marshalFunction from "./function";
import marshalObject from "./object";
import marshalPrimitive from "./primitive";

export type Options = {
  blacklist?: Set<any>;
  blacklistClass?: any[];
};

export class Marshaler {
  vm: QuickJSVm;
  unmarshaler: (handle: QuickJSHandle) => unknown;
  proxyKeySymbol?: QuickJSHandle;
  options: Options | undefined;

  constructor(
    vm: QuickJSVm,
    unmarshaler: (handle: QuickJSHandle) => unknown,
    proxyKeySymbol: QuickJSHandle,
    options?: Options
  ) {
    this.vm = vm;
    this.unmarshaler = unmarshaler;
    this.proxyKeySymbol = proxyKeySymbol;
    this.options = options;
  }

  marshal(target: unknown, map?: Iterable<readonly [unknown, QuickJSHandle]>) {
    return marshal(
      this.vm,
      target,
      map ? new Map(map) : undefined,
      this.unmarshaler,
      this.proxyKeySymbol,
      this.options
    );
  }
}

export function marshal(
  vm: QuickJSVm,
  target: unknown,
  map: Map<unknown, QuickJSHandle> = new Map(),
  unmarshaler: (handle: QuickJSHandle) => unknown,
  proxyKeySymbol?: QuickJSHandle,
  options?: Options
): [QuickJSHandle, QuickJSHandle[], Map<unknown, QuickJSHandle> | undefined] {
  {
    const primitive = marshalPrimitive(vm, target);
    if (primitive) {
      return [primitive, [], undefined];
    }
  }

  {
    const handle = map.get(target);
    if (handle) return [handle, [], undefined];
  }

  if (options?.blacklist?.has(target)) {
    return [vm.undefined, [], undefined];
  }

  if (options?.blacklistClass?.some(c => target instanceof c)) {
    return [vm.undefined, [], undefined];
  }

  const disposables: QuickJSHandle[] = [];
  const marshaler = (target: unknown) => {
    const [handle, disposables2, map2] = marshal(
      vm,
      target,
      map,
      unmarshaler,
      proxyKeySymbol,
      options
    );
    disposables.push(...disposables2);
    mergeMap(map, map2);
    return handle;
  };
  const preMarshaler = (t: unknown, h: QuickJSHandle) => {
    map.set(t, h);
  };

  const handle =
    marshalArray(vm, target, marshaler, preMarshaler) ??
    marshalFunction(
      vm,
      target,
      marshaler,
      unmarshaler,
      preMarshaler,
      proxyKeySymbol
    ) ??
    marshalObject(vm, target, marshaler, preMarshaler);
  if (handle) {
    map.set(target, handle);
    disposables.push(handle);
    return [handle, disposables, map];
  }

  return [vm.undefined, [], undefined];
}
