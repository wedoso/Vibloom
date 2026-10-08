import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "outputs/**", "work/**", ".cache/**", "public/live2d/**/live2dcubism*.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["public/live2d/motionsync/motionsync.worker.js"],
    languageOptions: { globals: { ...globals.worker, Live2DCubismMotionSyncCore: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ["**/*.{mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
