import { getQuickJS } from "quickjs-emscripten";
import { test } from "vitest";

import { Arena } from ".";

test(
  "repeated function",
  async () => {
    const rt = (await getQuickJS()).newRuntime();
    const ctx = rt.newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    arena.expose({
      hoge: () => {},
    });
    // should have an object as an arg
    const fn = arena.evalCode(`() => { hoge([]); }`);
    // error happens from 3926 times
    for (let i = 0; i < 3926; i++) {
      fn();
    }

    arena.dispose();
    ctx.dispose();
    rt.dispose();
  },
  1000 * 60,
);
