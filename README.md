# quickjs-emscripten-sync

We can build a plugin system that works safely in the web browser!

This library wraps [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) and provides a way to sync object state between the browser and sandboxed QuickJS.

- Exchange and sync values between browser and QuickJS seamlessly
  - Primitives (number, boolean, string, symbol)
  - Arrays
  - Functions
  - Classes and instances
  - Objects with prototypes and any property descriptors
- Expose objects as a global object in QuickJS
- Marshaling limitation for specific objects
- Register a pair of objects that will be considered the same between the browser and QuickJS

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

// We can pass objects to the VM and run code safely without any pain
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

[Example code](src/index.test.ts) is available as the unit test code.

## Operating environment

- Web browsers that support WebAssembly
- Node.js

If you want to run quickjs-emscripten and quickjs-emscripten-sync in a browser, they have to be bundled with a bundler tool such as webpack, because quickjs-emscripten is now written in CommonJS format and browsers cannot load it directly.

## Usage

```js
import { getQuickJS } from "quickjs-emscripten";
import Arena from "quickjs-emscripten-sync";

(async function() {
  const quickjs = await getQuickJS();
  const vm = quickjs.createVm();

  // init Arena
  const arena = new Arena(vm);

  // expose objects as global objects in QuickJS VM
  arena.expose({
    console: {
      log: console.log
    }
  });
  arena.evalCode(`console.log("hello, world");`); // run console.log
  arena.evalCode(`1 + 1`); // 2

  // expose objects but also enable sync
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

## Marshaling limitations

Objects are automatically converted when they cross between browser and QuickJS VM. The conversion of a browser object to a VM handle is called marshaling, and the conversion of a VM handle to a browser object is called unmarshaling.

And for marshalling, it is possible to control whether the conversion is performed or not.

For example, exposing the browser's global object to QuickJS is very heavy and dangerous. This exposure can be limited and controlled with the `isMarshalable` option. If `false` is returned, just `undefined` is passed to QuickJS.

```js
import Arena, { complexity } from "quickjs-emscripten-sync";

const arena = new Arena(vm, {
  isMarshalable: (target: any) => {
    // prevent passing globalThis to QuickJS
    if (target === window) return false;
    // complexity is a helper function to detect whether the object is heavy
    if (complexity(target, 30) >= 30) return false;
    return true; // other objects are OK
  }
});

arena.evalCode(`a => a === undefined`)({});       // false
arena.evalCode(`a => a === undefined`)(window); // true
arena.evalCode(`a => a === undefined`)(document); // true
```

The `complexity` function is useful to detect whether the object is too heavy to be passed to QuickJS.

## Security warning

QuickJS has an environment isolated from the browser, so any code can be executed safely, but there are edge cases where some exposed objects by quickjs-emscripten-sync may break security.

quickjs-emscripten-sync cannot prevent such dangerous case, so **PLEASE be very careful and deliberate about what you expose to QuickJS!**

### Case 1: Prototype pollution in browser

```js
import { set } from "lodash-es";

arena.expose({
  danger: (keys, value) => {
    // This function may cause prototype pollution in the browser by QuickJS
    set({}, keys, value)
  }
});

arena.evalCode(`danger("__proto__.a", () => { /* injected */ })`);
```

### Case 2: Unintended HTTP request

It is very dangerous to expose or use directly or indirectly the `window` object, `localStorage`, `fetch`, `XMLHttpRequest` ...

This is because it enables the execution of unintended code such as XSS attacks, such as reading local storage, sending unintended HTTP requests, and manipulating DOM objects.

```js
arena.expose({
  // This function may cause unintended HTTP requests
  danger: (url, body) => {
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }
});

arena.evalCode(`danger("/api", { dangerous: true })`);
```

By default, quickjs-emscripten-sync doesn't prevent any marshaling, even in such cases. And there are many built-in objects in the browser, so please note that it's hard to prevent all dangerous cases with the `isMarshalable` option alone.

## API

### `Arena`

The Arena class manages all generated handles at once by quickjs-emscripten and automatically converts objects between browser and QuickJS.

#### `new Arena(vm: QuickJSVm, options?: Options)`

Constructs a new Arena instance. It requires a quickjs-emscripten VM initialized with `quickjs.createVM()`.

Options accepted:

```ts
type Options = {
  isMarshalable?: (target: any) => boolean;
  registeredObjects?: Iterable<[any, QuickJSHandle | string]>;
}
```

- **`isMarshalable`**: A callback that returns a boolean value that determines whether an object is marshalled or not. If false, no marshaling will be done and undefined will be passed to the QuickJS VM, otherwise marshaling will be done. By default, all objects will be marshalled.
- **`registeredObjects`**: You can pre-register a pair of objects that will be considered the same between the browser and the QuickJS VM. This will be used automatically during the conversion. By default, it will be registered automatically with [`defaultRegisteredObjects`](src/default.ts). If you want to add a new pair to this, please do the following:

```js
import { defaultRegisteredObjects } from "quickjs-emscripten-sync";

const arena = new Arena(vm, {
  registeredObjects: [
    ...defaultRegisteredObjects,
    [Math, "Math"]
  ]
});
```

Instead of a string, you can also pass a QuickJSHandle directly. In that case, however, you have to dispose of them manually when destroying the VM.

#### `dispose()`

Dispose of the arena and managed handles. This method won't dispose the VM itself, so the VM has to be disposed of manually.

#### `evalCode<T = any>(code: string): T | undefined`

Evaluate JS code in the VM and get the result as an object on the browser side. It also converts and re-throws error objects when an error is thrown during evaluation.

#### `executePendingJobs(): number`

Almost same as `vm.executePendingJobs()`, but it converts and re-throws error objects when an error is thrown during evaluation.

#### `expose<T extends { [k: string]: any }>(obj: T, sync?: boolean): T`

Expose objects as global objects in the VM.

If sync is true, this function returns objects wrapped with proxies. This is necessary in order to reflect changes to the object from the browser side to the VM side. Please note that setting a value in the field or deleting a field in the original object will not synchronize it.

#### `register(target: any, code: string | QuickJSHandle)`

Register a pair of objects that will be considered the same between the browser and the QuickJS VM.

#### `unregisterAll(targets: Iterable<[any, string | QuickJSHandle]>)`

Execute `register` methods for each pair.

#### `unregister(target: any)`

Unregister a pair of objects that were registered with `registeredObjects` option and `register` method.

#### `unregisterAll(targets: Iterable<any>)`

Execute `unregister` methods for each target.

### `defaultRegisteredObjects: [any, string][]`

Default value of registeredObjects option of the Arena class constructor.

### `complexity(target: any, max?: number): number`

Measure the complexity of an object as you traverse the field and prototype chain. If max is specified, when the complexity reaches max, the traversal is terminated and it returns the max. In this function, one object and function are counted as a complexity of 1, and primitives are not counted as a complexity.

## Advanced

### How to work

quickjs-emscripten can execute JS code safely, but it requires to deal with a lot of handles and lifetimes. Also, when destroying the VM, any un-destroyed handle will result in an error.

quickjs-emscripten-sync will automatically manage all handles once generated by QuickJS VM in an Arena class. 
And it will automatically "marshal" objects as handles and "unmarshal" handles as objects to enable seamless data exchange between the browser and QuickJS. It recursively traverses the object properties and prototype chain to transform objects. A function is called after its arguments and this arg are automatically converted for the environment in which the function is defined. The return value will be automatically converted to match the environment of the caller.
Most objects are wrapped by proxies during conversion, allowing "set" and "delete" operations on objects to be synchronized between the browser and QuickJS.

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

#### Operation synchronization

For now, only the `set` and `deleteProperty` operations on objects are subject to synchronization. The result of `Object.defineProperty` on a proxied object will not be synchronized to the other side.

## License

[MIT License](LICENSE)
