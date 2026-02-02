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
    },
  },
];
