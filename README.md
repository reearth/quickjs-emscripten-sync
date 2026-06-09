# quickjs-emscripten-sync

[![CI](https://github.com/reearth/quickjs-emscripten-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/reearth/quickjs-emscripten-sync/actions/workflows/ci.yml) [![codecov](https://codecov.io/gh/reearth/quickjs-emscripten-sync/branch/main/graph/badge.svg)](https://codecov.io/gh/reearth/quickjs-emscripten-sync)

**Build a secure plugin system for web browsers.**

quickjs-emscripten-sync wraps [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) and keeps object state in sync between the host (browser or Node.js) and a sandboxed QuickJS VM, so you can exchange values across the boundary as if they were plain JavaScript objects.

## Features

- Exchange and synchronize values between the host and QuickJS seamlessly:
  - Primitives (number, boolean, string, symbol, bigint)
  - Arrays, and objects with prototypes and any property descriptors
  - Functions, classes, and instances
  - Promises
  - `Date`
  - `Map` and `Set` (by value)
  - `ArrayBuffer`, typed arrays, and `DataView` (by value)
- Expose host objects as globals inside the VM.
- Fine-grained control over which objects may be marshalled (for security).
- Pass objects opaquely by reference, or register host/VM object pairs to be treated as identical.

## Installation

```
npm install quickjs-emscripten quickjs-emscripten-sync
```

`quickjs-emscripten` is a peer dependency.

## Quick start

```js
import { getQuickJS } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";

class Cls {
  field = 0;

  method() {
    return ++this.field;
  }
}

const ctx = (await getQuickJS()).newContext();
const arena = new Arena(ctx, { isMarshalable: true });

// Pass host objects to the VM and run code against them safely.
const exposed = {
  Cls,
  cls: new Cls(),
  syncedCls: arena.sync(new Cls()),
};
arena.expose(exposed);

arena.evalCode(`cls instanceof Cls`); // true
arena.evalCode(`cls.field`); //          0
arena.evalCode(`cls.method()`); //       1
arena.evalCode(`cls.field`); //          1

// Changes to a synced object are reflected on both sides.
arena.evalCode(`syncedCls.field`); // 0
exposed.syncedCls.method(); //        1
arena.evalCode(`syncedCls.field`); // 1

// Always dispose the arena before disposing the context.
arena.dispose();
ctx.dispose();
```

More runnable examples can be found in the [unit tests](src/index.test.ts).

## Operating environment

- Web browsers that support WebAssembly
- Node.js

To run in a web browser, bundle your code with a tool such as webpack, Vite, or Rollup, since the WebAssembly module cannot be loaded directly via a `<script>` tag.

## How it works

Running untrusted JS in quickjs-emscripten is safe, but it requires you to manage a large number of handles and their lifetimes by hand. Any handle that is not freed before the context is destroyed causes an error.

quickjs-emscripten-sync hides this complexity behind the `Arena` class:

- It tracks every handle generated through the context and frees them for you when the arena is disposed.
- It **marshals** host objects into VM handles and **unmarshals** VM handles back into host objects, recursing through properties and the prototype chain so the conversion is transparent. When a function is called, its arguments and `this` are converted for the side where the function is defined, and the return value is converted back for the caller.
- Most objects are wrapped in proxies during conversion, so that `set`, `delete`, and `defineProperty` operations are synchronized between the host and the VM.

> **Marshal** = converting a host object into a VM handle.
> **Unmarshal** = converting a VM handle back into a host object.

## Controlling what gets marshalled

You can control whether (and how) host objects are marshalled into the VM. This matters for security: exposing the host's global object to the VM, for example, is both heavy and dangerous.

Use the `isMarshalable` option to limit it. When the callback returns `false`, `undefined` is passed to the VM instead of the object.

```js
import { Arena, complexity } from "quickjs-emscripten-sync";

const arena = new Arena(ctx, {
  isMarshalable: (target: any) => {
    // Never pass globalThis to the VM.
    if (target === window) return false;
    // complexity() helps detect objects that are too heavy to pass.
    if (complexity(target, 30) >= 30) return false;
    return true; // anything else is fine
  },
});

arena.evalCode(`a => a === undefined`)({}); //       false
arena.evalCode(`a => a === undefined`)(window); //   true
arena.evalCode(`a => a === undefined`)(document); // true
```

See [`isMarshalable`](#options) for all accepted values.

## Security

⚠️ QuickJS runs in an environment isolated from the browser, so untrusted code can generally be executed safely. However, there are edge cases where objects you expose through quickjs-emscripten-sync can break that isolation.

quickjs-emscripten-sync cannot detect every such case, so **be very careful and deliberate about what you expose to the VM.**

### Case 1: Prototype pollution

```js
import { set } from "lodash-es";

arena.expose({
  danger: (keys, value) => {
    // Calling this from the VM can pollute prototypes in the host.
    set({}, keys, value);
  },
});

arena.evalCode(`danger("__proto__.a", () => { /* injected */ })`);
```

### Case 2: Unintended HTTP requests and DOM access

Exposing `window`, `localStorage`, `fetch`, `XMLHttpRequest`, and similar APIs — directly or indirectly — is very dangerous. It lets sandboxed code read local storage, send arbitrary HTTP requests, manipulate the DOM, and mount XSS-style attacks.

```js
arena.expose({
  // Calling this from the VM can trigger unintended HTTP requests.
  danger: (url, body) => {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
});

arena.evalCode(`danger("/api", { dangerous: true })`);
```

By default, quickjs-emscripten-sync does not block any marshalling. Because the host has many built-in objects, the `isMarshalable` option alone cannot prevent every dangerous case — design your exposed surface carefully.

## API

### `Arena`

`Arena` manages all handles generated by quickjs-emscripten and automatically converts objects between the host and the VM.

#### `new Arena(ctx: QuickJSContext, options?: Options)`

Creates a new arena. `ctx` must be a context created with `quickjs.newContext()`.

> ⚠️ Marshalling is opt-in for security reasons. Enable it deliberately.

##### Options

```ts
type Options = {
  /**
   * Controls whether and how an object is marshalled. By default, objects are
   * marshalled via JSON. See the table below for accepted values.
   */
  isMarshalable?: boolean | "json" | ((target: any) => boolean | "json");

  /**
   * Pre-registered pairs of objects that are treated as identical between the
   * host and the VM, and reused automatically during conversion. Defaults to
   * `defaultRegisteredObjects`.
   *
   * Instead of a code string you may pass a QuickJSHandle directly; in that
   * case you must dispose of it yourself when destroying the VM.
   */
  registeredObjects?: Iterable<[any, QuickJSHandle | string]>;

  /** Custom functions that convert a host object into a QuickJS handle. */
  customMarshaller?: Iterable<(target: unknown, ctx: QuickJSContext) => QuickJSHandle | undefined>;

  /** Custom functions that convert a QuickJS handle into a host object. */
  customUnmarshaller?: Iterable<(target: QuickJSHandle, ctx: QuickJSContext) => any>;

  /**
   * Returns whether an object may be wrapped with a proxy. If it returns
   * `false`, the object cannot be synchronized even when `arena.sync` is used.
   */
  isWrappable?: (target: any) => boolean;

  /**
   * Returns whether a QuickJS handle may be wrapped with a proxy. If it returns
   * `false`, the handle cannot be synchronized even when `arena.sync` is used.
   */
  isHandleWrappable?: (handle: QuickJSHandle, ctx: QuickJSContext) => boolean;

  /** Compatibility shim for quickjs-emscripten prior to v0.15. */
  compat?: boolean;

  /**
   * Enables sync mode globally (default `true`). When `false`, objects are not
   * wrapped with proxies and marshalled handles are disposed right after use:
   * `arena.sync` has no effect, but objects are not retained for the arena's
   * whole lifetime. Useful to avoid memory growth when frequently exchanging
   * short-lived objects.
   */
  syncEnabled?: boolean;

  /**
   * Returns whether an object should be passed to the VM by reference (as an
   * opaque HostRef) instead of being marshalled by value or proxy. See
   * "Passing objects by reference" below.
   */
  marshalByReference?: (target: any) => boolean;
};
```

###### `isMarshalable`

Determines how objects are marshalled from the host into the VM. **Keep this as restrictive as possible — loosening it can reduce your application's security.** See [Security](#security).

| Value | Behaviour |
| --- | --- |
| `"json"` | **Default.** The object is serialized to JSON on the host and parsed in the VM. Functions and classes are lost. Safe. |
| `false` | The object is never marshalled; `undefined` is passed instead. Safe. |
| `(target) => boolean \| "json"` | **Recommended.** Decide per object. Return `true` to fully marshal, `"json"` for JSON, or `false` to skip. |
| `true` | The object is always fully marshalled. **Risky — not recommended.** |

###### `registeredObjects`

Pre-register host/VM object pairs that should be treated as identical during conversion. Defaults to [`defaultRegisteredObjects`](src/default.ts). To extend it:

```js
import { defaultRegisteredObjects } from "quickjs-emscripten-sync";

const arena = new Arena(ctx, {
  registeredObjects: [...defaultRegisteredObjects, [Math, "Math"]],
});
```

Instead of a code string you may pass a QuickJSHandle directly; in that case you must dispose of it yourself when destroying the context.

###### `marshalByReference`

Return `true` for objects you want to pass to the VM as an opaque reference (a [HostRef](https://github.com/justjake/quickjs-emscripten)) instead of marshalling their contents. The VM cannot read or mutate such objects, but it can hold them and pass them back to the host, where they resolve to the **original** object (identity is preserved). This is useful for handing the sandbox a host resource — a class instance, a DOM node, and so on — that it should carry around opaquely rather than copy.

```js
const secret = { token: "..." };
const arena = new Arena(ctx, {
  isMarshalable: true,
  marshalByReference: target => target === secret,
});

arena.expose({
  getSecret: () => secret,
  useSecret: s => s.token, // the host receives the original `secret`
});

arena.evalCode(`useSecret(getSecret())`); // "..."  (the VM never sees the contents)
```

#### `evalCode<T = any>(code: string): T`

Evaluate JS code in the VM and return the result as a host object. Errors thrown during evaluation are converted and re-thrown on the host.

#### `evalModule<T = any>(code: string, filename?: string): T | Promise<T>`

Evaluate ES module code and return the module's exports. Requires quickjs-emscripten >= 0.29.0. Returns a promise if the module uses top-level `await`.

#### `expose(obj: { [k: string]: any })`

Expose host objects as globals in the VM. Exposed objects are not synchronized by default; to sync one, wrap it with `sync` first and expose the wrapped object.

```js
arena.expose({ console: { log: console.log } });
arena.evalCode(`console.log("hello, world")`);
```

#### `sync<T>(target: T): T`

Enable synchronization for an object and return a proxy-wrapped version of it. **Use the returned value** — mutating the original object does not propagate changes. Conversely, `set` and `delete` on the wrapped object (from either side) are synchronized.

```js
const data = arena.sync({ hoge: "foo" });
arena.expose({ data });

arena.evalCode(`data.hoge = "bar"`);
console.log(data.hoge); // "bar"

data.hoge = "changed!";
console.log(arena.evalCode(`data.hoge`)); // "changed!"
```

#### `register(target: any, code: string | QuickJSHandle)`

Register a single host/VM object pair to be treated as identical.

#### `registerAll(map: Iterable<[any, string | QuickJSHandle]>)`

Call `register` for each pair.

#### `unregister(target: any, dispose?: boolean)`

Remove a pair registered via the `registeredObjects` option or `register`.

#### `unregisterAll(targets: Iterable<any>, dispose?: boolean)`

Call `unregister` for each target.

#### `dispose()`

Dispose of the arena and the handles it manages. This does **not** dispose the context itself — dispose that manually, and always after the arena.

`Arena` also implements `Symbol.dispose`, so a `using` declaration disposes it automatically:

```js
{
  using arena = new Arena(ctx, { isMarshalable: true });
  arena.evalCode(`1 + 1`);
} // arena.dispose() runs here
ctx.dispose();
```

#### `executePendingJobs(maxJobsToExecute?: number): number`

Like `ctx.runtime.executePendingJobs()`, but converts and re-throws errors thrown during evaluation.

#### Runtime limits and stats

These forward to the underlying runtime and are useful for sandboxing untrusted code:

- `setMemoryLimit(limitBytes: number): void` — cap runtime memory (`-1` to remove the limit).
- `setMaxStackSize(stackSize: number): void` — cap stack size in bytes (`0` to remove the limit).
- `getMemoryUsage(): object` — detailed memory statistics.
- `dumpMemoryUsage(): string` — a human-readable memory report.

### `AsyncArena`

`AsyncArena` extends `Arena` for use with a [`QuickJSAsyncContext`](https://github.com/justjake/quickjs-emscripten). It adds `evalCodeAsync`, the async counterpart to `evalCode`, so code that relies on asynchronous module loading can be evaluated.

```js
import { newAsyncContext } from "quickjs-emscripten";
import { AsyncArena } from "quickjs-emscripten-sync";

const ctx = await newAsyncContext();
const arena = new AsyncArena(ctx, { isMarshalable: true });

await arena.evalCodeAsync(`1 + 2`); // 3

arena.dispose();
ctx.dispose();
```

#### `evalCodeAsync<T = any>(code: string, filename?: string): Promise<T>`

Evaluate JS code asynchronously and return the result on the host. Like `evalCode`, it converts and re-throws errors thrown during evaluation.

### `defaultRegisteredObjects: [any, string][]`

The default value of the `registeredObjects` option.

### `complexity(target: any, max?: number): number`

Measure the complexity of an object by traversing its fields and prototype chain. Each object and function counts as 1; primitives are not counted. If `max` is given, traversal stops once the count reaches `max` and returns `max` — handy for cheaply detecting objects that are too heavy to marshal.

## Limitations

### Class constructors

When a class is instantiated inside the VM, `this` (and `new.target`) cannot be fully proxied during the constructor call. quickjs-emscripten-sync runs the host constructor and then copies the resulting fields onto the VM-side `this`, so constructors that rely on the live `this` during construction may behave unexpectedly in edge cases.

```js
class Cls {
  constructor() {
    this.hoge = "foo";
  }
}

arena.expose({ Cls });
arena.evalCode(`new Cls()`); // Cls { hoge: "foo" }
```

### Operation synchronization

Only the `set`, `deleteProperty`, and `defineProperty` operations on objects are synchronized. Other operations (for example `Object.setPrototypeOf`) are not propagated to the other side.

### Marshalling by value

`Date`, `Map`, `Set`, `ArrayBuffer`, and typed arrays are marshalled by value (a snapshot copy is created on the other side). They are not proxied, so later mutations are not synchronized, and self-referential `Map`/`Set` are not supported.

### `this` on plain calls

When an exposed host function is called plainly from the VM (`fn()`, not `obj.fn()`), the host function receives `this === undefined`. This differs from plain JavaScript, where a non-strict function called this way would see `this === globalThis`. The VM global object is intentionally **not** marshalled to the host: doing so would eagerly deep-copy the entire global graph on the first call and would leak `globalThis` across the boundary. Method calls are unaffected — `obj.fn()` still receives `obj` as `this`.

```js
arena.expose({ whoAmI() { return this; } });
arena.evalCode(`whoAmI()`); // undefined (not globalThis)
```

## License

[MIT License](LICENSE)
