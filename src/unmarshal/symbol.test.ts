import { getQuickJS } from "quickjs-emscripten";
import unmarshalSymbol from "./symbol";

test("works", async () => {
  const vm = (await getQuickJS()).createVm();
  const pre = jest.fn();
  const obj = vm.newObject();
  const handle = vm.unwrapResult(vm.evalCode(`Symbol("foobar")`));

  expect(unmarshalSymbol(vm, obj, pre)).toBe(undefined);
  expect(pre).toBeCalledTimes(0);

  const sym = unmarshalSymbol(vm, handle, pre);
  expect(typeof sym).toBe("symbol");
  expect((sym as any).description).toBe("foobar");
  expect(pre).toReturnTimes(1);
  expect(pre.mock.calls[0][0]).toBe(sym);
  expect(pre.mock.calls[0][1] === handle).toBe(true);

  handle.dispose();
  obj.dispose();
  vm.dispose();
});
