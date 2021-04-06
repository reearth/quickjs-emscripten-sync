export function isES2015Class(cls: any): cls is new (...args: any[]) => any {
  return (
    typeof cls === "function" &&
    /^class\s/.test(Function.prototype.toString.call(cls))
  );
}

export function mergeMap<K, V>(
  m1: Map<K, V>,
  ...m2: (Map<K, V> | undefined)[]
) {
  for (const m of m2) {
    if (!m) continue;
    for (const [k, v] of m) {
      m1.set(k, v);
    }
  }
}

export function isObject(value: any): value is object | Function {
  return (
    typeof value === "function" || (typeof value === "object" && value !== null)
  );
}
