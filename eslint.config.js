import reearthConfig from "eslint-config-reearth";

export default [
  ...reearthConfig("quickjs-emscripten-sync"),
  {
    ignores: ["dist/**"],
  },
  {
    rules: {
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
      // Tests use a test-body factory pattern (e.g. `(reject) => async () => { ... }`),
      // so expect() calls sit outside a directly-recognized test block; and some assertions
      // are intentionally branched (resolve vs reject). Both are deliberate here.
      "vitest/no-standalone-expect": "off",
      "vitest/no-conditional-expect": "off",
    },
  },
];
