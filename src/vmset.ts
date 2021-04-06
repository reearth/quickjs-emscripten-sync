import { QuickJSVm, QuickJSHandle } from "quickjs-emscripten";

export default class VMSet {
  vm: QuickJSVm;
  _setHas: QuickJSHandle;
  _setAdd: QuickJSHandle;
  _proxyTarget: QuickJSHandle;

  constructor(vm: QuickJSVm, symbol?: QuickJSHandle) {
    this.vm = vm;
    const fn = vm.unwrapResult(
      vm.evalCode(`(proxyTarget) => {
        const set = new WeakSet();
        const unwrap = (obj) => typeof proxyTarget === "symbol" && (typeof obj === "object" && obj !== null || typeof obj === "function") ? (obj?.[proxyTarget] ?? obj) : obj;
        return {
          has: key => set.has(unwrap(key)),
          add: (...keys) => { for (const key of keys) { if (typeof key === "object" && key !== null || typeof key === "function") set.add(unwrap(key)); } },
          proxyTarget
        };
      }`)
    );
    const result = this._call(fn, undefined, symbol ?? vm.undefined);
    this._setHas = vm.getProp(result, "has");
    this._setAdd = vm.getProp(result, "add");
    this._proxyTarget = vm.getProp(result, "proxyTarget");
    fn.dispose();
    result.dispose();
  }

  proxyTarget() {
    return this._proxyTarget;
  }

  has(handle: QuickJSHandle) {
    if (!handle.alive) return false;
    return !!this.vm.dump(this._call(this._setHas, undefined, handle));
  }

  add(...handles: QuickJSHandle[]) {
    this._call(this._setAdd, undefined, ...handles.filter(h => h.alive));
  }

  dispose() {
    this._setHas.dispose();
    this._setAdd.dispose();
  }

  _call(
    fn: QuickJSHandle,
    thisArg: QuickJSHandle | undefined,
    ...args: QuickJSHandle[]
  ) {
    return this.vm.unwrapResult(
      this.vm.callFunction(
        fn,
        typeof thisArg === "undefined" ? this.vm.undefined : thisArg,
        ...args
      )
    );
  }
}
