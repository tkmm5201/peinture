import globals from "globals";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Global ignores
  { ignores: ["dist/**", "node_modules/**", "*.config.*"] },

  // Base JS rules
  eslint.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // React Hooks rules
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Project-specific overrides
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // Allow 'any' usage
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Prefer const
      "prefer-const": "warn",
      // No console.log in production (warn, not error)
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);
