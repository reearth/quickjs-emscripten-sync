# quickjs-emscripten-sync

We can build the plugin system that works safety in the web browsers!

This library wraps [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) and provides a way to sync object state between browser and sandboxed QuickJS.

- Exchange and sync values between browser and QuickJS seemlessly
  - Primitive (number, boolean, string, symbol)
  - Array
  - Function
  - Class and instance
  - Object with prototype and any property descriptors
- Expose objects as a global object in QuickJS
- Marshaling limitation for specific objects
- Register a pair of objects that will be considered the same between browser and QuickJS

```
npm install quickjs-emscripten quickjs-emscripten-sync
```

```js
import { getQuickJS } from "quickjs-emscripten";
import Arena from "quickjs-emscripten-sync";

class Cls {
  field = 0;

  method() {
    return ++this.field;
  }
}

const vm = (await getQuickJS()).createVm();
const arena = new Arena(vm);

// We can pass objects to VM and run codes safety without any pain
arena.expose({
  Cls,
  cls: new Cls()
});

arena.evalCode(`cls instanceof Cls`)); // returns true
arena.evalCode(`cls.field`));          // returns 0
arena.evalCode(`cls.method()`));       // returns 1
arena.evalCode(`cls.field`));          // returns 1

arena.dispose();
vm.dispose();
```

[Example code](index.test.ts) is available as the unit test code.

## Operating environment

- Web browsers that supports WebAssembly
- Node.js

If you want to run quickjs-emscripten and quickjs-emscripten-sync in browsers, they have to be bundled with bundler tools such as webpack, because quickjs-emscripten is now written as CommonJS format and browsers cannot load it directly.

## Usage

```js
import { getQuickJS } from "quickjs-emscripten";
import Arena from "quickjs-emscripten-sync";

(async function() {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  // init Arena
  const arena = new Arena(vm);

  // expose objects to global object in QuickJS VM
  arena.expose({
    console: {
      log: console.log
    }
  });
  arena.evalCode(`console.log("hello, world");`); // run console.log
  arena.evalCode(`1 + 1`); // 2

  // expose objects but also enables sync
  const data = { hoge: "foo" };
  const exposed = arena.expose({ data }, true);

  arena.evalCode(`data.hoge = "bar"`);
  // eval code and operations to exposed objects are automatically synced
  console.log(data.hoge); // "bar"
  exposed.hoge = "changed!";
  console.log(arena.evalCode(`data.hoge`)); // "changed!"

  // Don't forget calling arena.dispose() before disposing QuickJS VM!
  arena.dispose();
  vm.dispose();
})();
```

## Marshaling limitation

Objects are automatically converted when they cross between browser and QuickJS VM. The conversion of a browser object to a VM handle is called marshaling, and the conversion of a VM handle to a browser object is called unmarshaling.

And for marshalling, it is possible to control whether the conversion is performed or not.

For example, exposing browser's global object to QuickJS is very heavy and dangerous. So, exposing large and dangerous objects can be limited with `isMarshalable` options. If `false` is returned, just `undefined` is passed to QuickJS.

```js
import Arena, { complexity } from "quickjs-emscripten-sync";

const arena = new Arena(vm, {
  isMarshalable: (target: any) => {
    // prevent passing globalThis to QuickJS
    if (target === window) return false;
    // complexity is helper function to deletect whether the object is heavy
    if (complexity(target, 30) >= 30) return false;
    return true; // other objects are OK
  }
});

arena.evalCode(`a => a === undefined`)({});       // false
arena.evalCode(`a => a === undefined`)(document); // true
arena.evalCode(`a => a === undefined`)(document); // true
```

`complexity` function is useful to detect whether the object is heavy to be passed to QuickJS.

## Security warning

QuickJS has an environment isolated from the browser, so any code can be executed safely, but there are edge cases where some exposed objects by quicjs-emscripten-sync may break security.

quicjs-emscripten-sync cannot prevent such dangerous case, so **PLEASE be very careful about what you expose to QuickJS!**

### Case 1: prototype pollution in browser

```js
arena.expose({
  // This function may cause prototype pollution in browser by QuickJS
  danger: (key, value) => {
    Object[key] = value;
  }
});

arena.evalCode(`danger("__proto__", { foo: () => {} })`);
```

### Case 2: unintended HTTP request

It is very dangerous to expose or use directly or indirectly `window` object, `localStorage`, `fetch`, `XMLHttpRequest` ...

This is because it enables the execution of unintended code such as XSS attacks, such as reading local storage, sending unintended HTTP requests, and manipulating DOM objects.

```js
arena.expose({
  // This function may cause unintended HTTP request
  danger: (url, body) => {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', },  body: JSON.stringify(body) });
  }
});

arena.evalCode(`danger("/api", { dangerous: true })`);
```

By default, quickjs-emscripten-sync doesn't prevent any marshaling even such case. And there is many built-in objects in browser, so please note that it's hard to prevent all dangerous cases with `isMarshalable` option alone.

## API

### `Arena`

Arena class manages all handles generate once by quickjs-emscripten and automatically converts objects between browser and QuickJS.

#### `new Arena(vm: QuickJSVm, options?: Options)`

Construct a new Arena instance. It requires a quickjs-emscripten's VM initialized with `quickjs.createVM()`.

Options accepts:

```ts
type Options = {
  isMarshalable?: (target: any) => boolean;
  registeredObjects?: Iterable<[any, QuickJSHandle | string]>;
}
```

- **`isMarshalable`**: A callback that returns a boolean value that determines whether an object is marshalled or not. If false, no marshaling will be done and undefined will be passed to the QuickJS VM, otherwise marshaling will be done. By default, all objects will be marshalled.
- **`registeredObjects`**: You can pre-register a pair of objects that will be considered the same between the browser and the QuickJS VM. This will be used automatically during the conversion. By default, it will be registered automatically with [`defaultRegisteredObjects`](default.ts). If you want to add a new pair to this, please do the following:

```js
import { defaultRegisteredObjects } from "quickjs-emscripten-sync";

const arena = new Arena(vm, {
  registeredObjects: [
    ...defaultRegisteredObjects,
    [Math, "Math"]
  ]
});
```

Instead of a string, you can also pass a QuickJSHandle directly. In that case, however, when  you have to dispose them manually when destroying the VM.

#### `dispose()`

Dispose the arena and managed handles. This method won't dispose VMs itself, so VM have to be disposed manually.

#### `evalCode<T = any>(code: string): T | undefined`

Eval JS code in the VM and get the result as an object in browser side. Also it converts and re-throw error objects when an error is thrown during evaluration.

#### `executePendingJobs(): number`

Almost same as `vm.executePendingJobs()`, but it converts and re-throw error objects when an error is thrown during evaluration.

#### `expose<T extends { [k: string]: any }>(obj: T, sync?: boolean): T`

Expose objects as global objects in the VM.

If sync is true, this function returns objects wrapped with proxies. This is necessary in order to reflect changes to the object from the browser side to the VM side. Please note that setting a value in the field or deleting a field in the original object will not synchronize it.

#### `register(target: any, code: string | QuickJSHandle)`

Register a pair of objects that will be considered the same between the browser and the QuickJS VM.

#### `unregisterAll(targets: Iterable<[any, string | QuickJSHandle]>)`

Exec `register` methods for each pairs.

#### `unregister(target: any)`

Unregister a pair of object registered with `registeredObjects` option and `register` method.

#### `unregisterAll(targets: Iterable<any>)`

Exec `unregister` methods for each targets.

### `defaultRegisteredObjects: [any, string][]`

Default value of registeredObjects option.

### `complexity(target: any, max?: number): number`

Measure the complexity of an object as you traverse the field and prototype chain. If max is specified, when the complexity reaches max, the traversal is terminated and it returns the max. In this function, one object and function are counted as a complexity of 1, and primitives are not counted as a complexity.

## Advanced

### How to work

quickjs-emscripten can execute JS code safety, but it requires to deal with a lot of handles and lifetimes. Also, when destroying the VM, any un-destroyed handles will result in an error.

quickjs-emscripten-sync will automatically manage all handles once generated by QuickJS VM in an Arena class. 
And it automatically "marshal" objects as handles and "unmarshal" handles as objects to enable seamless data exchange between browser and QuickJS. It recursively traverses the object properties and prototype chain to transform objects. A function is called after its arguments and this arg are automatically converted for the environment in which the function is defined. The return value will be automatically converted to match the environment of the caller.
Most objects are wrapped by proxies during conversion, allowing"set" and "delete" operations on objects to be synchronized between browser and QuickJS.

### Limitations

#### Class constructor

When initializing a new instance, it is not possible to fully proxy this arg (a.k.a. `new.target`) inside the class constructor. Therefore, after the constructor call, the fields set for this are re-set to this on the VM side. Therefore, there may be some edge cases where the constructor may not work properly.

```js
class Cls {
  constructor() {
    this.hoge = "foo";
  }
}

arena.expose({ Cls });
arena.evalCode(`new Cls()`); // Cls { hoge: "foo" }
```

#### Array conversion

For now, only the elements of the array will be subject to conversion. Any fields or methods attached to the array will be ignored.

#### Operation synchronization

For now, only the `set` and `deleteProperty` operations on objects are subject to synchronization. The result of `Object.defineProperty` on a proxied object will not be synchronized to the other side.

## License

[MIT License](LICENSE)
