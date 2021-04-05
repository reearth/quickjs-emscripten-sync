import { getQuickJS } from "quickjs-emscripten";
declare global {
  interface Window {
    QES_INPUT?: any;
    QES_OUTPUT?: any;
  }
}

async function main() {
  const quickjs = await getQuickJS();
  const result = quickjs.evalCode("1 + 1");
  window.QES_OUTPUT = result;
}

main();
