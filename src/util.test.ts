import { isES2015Class, mergeMap } from "./util";

describe("isES2015Class", () => {
  it("works", () => {
    expect(isES2015Class(class {})).toBe(true);
    expect(isES2015Class(class A {})).toBe(true);
    expect(isES2015Class(function() {})).toBe(false);
    expect(isES2015Class(function A() {})).toBe(false);
    expect(isES2015Class(() => {})).toBe(false);
    expect(isES2015Class({})).toBe(false);
    expect(isES2015Class(1)).toBe(false);
    expect(isES2015Class(true)).toBe(false);
  });
});

describe("mergeMap", () => {
  it("works", () => {
    const map1 = new Map([["a", "A"]]);
    const map2 = new Map([
      ["b", "B"],
      ["c", "C"],
    ]);
    const map3 = new Map([["d", "D"]]);

    mergeMap(map1, map2, map3);

    expect(Array.from(map1.entries())).toEqual([
      ["a", "A"],
      ["b", "B"],
      ["c", "C"],
      ["d", "D"],
    ]);
  });
});
