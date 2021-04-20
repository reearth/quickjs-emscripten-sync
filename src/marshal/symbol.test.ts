import { getQuickJS } from "quickjs-emscripten";
import marshalSymbol from "./symbol";

test("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const pre = jest.fn();
  const sym = Symbol("foobar");

  expect(marshalSymbol(vm, {}, pre)).toBe(undefined);
  expect(pre).toBeCalledTimes(0);

  const handle = marshalSymbol(vm, sym, pre);
  if (!handle) throw new Error("handle is undefined");
  expect(vm.typeof(handle)).toBe("symbol");
  expect(vm.getString(vm.getProp(handle, "description"))).toBe("foobar");
  expect(pre).toReturnTimes(1);
  expect(pre.mock.calls[0][0]).toBe(sym);
  expect(pre.mock.calls[0][1] === handle).toBe(true);

  handle.dispose();
  vm.dispose();
});
