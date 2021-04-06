import { isES2015Class, mergeMap, isObject } from "./util";

it("isES2015Class", () => {
  expect(isES2015Class(class {})).toBe(true);
  expect(isES2015Class(class A {})).toBe(true);
  expect(isES2015Class(function() {})).toBe(false);
  expect(isES2015Class(function A() {})).toBe(false);
  expect(isES2015Class(() => {})).toBe(false);
  expect(isES2015Class({})).toBe(false);
  expect(isES2015Class(1)).toBe(false);
  expect(isES2015Class(true)).toBe(false);
});

it("mergeMap", () => {
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

it("isObject", () => {
  expect(isObject({})).toBe(true);
  expect(isObject(Object.create(null))).toBe(true);
  expect(isObject(function() {})).toBe(true);
  expect(isObject(function A() {})).toBe(true);
  expect(isObject(() => {})).toBe(true);
  expect(isObject(class {})).toBe(true);
  expect(isObject(class A {})).toBe(true);
  expect(isObject(null)).toBe(false);
  expect(isObject(1)).toBe(false);
  expect(isObject(true)).toBe(false);
});
