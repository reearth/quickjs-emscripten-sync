export function isES2015Class(cls: any) {
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
    for (const [k, v] of m.entries()) {
      m1.set(k, v);
    }
  }
}
