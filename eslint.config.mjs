import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "main.js",
      "engineWorker.js",
      "dist/**",
      "node_modules/**",
      "state.json",
      "results.json",
      "**/*.svelte",
      "**/*.svelte.ts",
      "vite.config.ts",
      "svelte.config.js",
      // Build/analysis scripts sit outside tsconfig's `include`, so the typed
      // rules can only ever report a parsing error for them.
      "scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "jest.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }
);
