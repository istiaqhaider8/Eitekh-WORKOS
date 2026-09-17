import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// ESLint 9 flat config. `eslint-config-next@15` still ships eslintrc-style
// configs, so FlatCompat bridges them.
//
// This codebase was never linted before (no eslint dependency existed, while CI
// ran `npm run lint` and failed on every push). The rule set below is therefore
// deliberately scoped to bug-class rules that pass today, so CI is green and any
// NEW violation fails the build. Tightening the stylistic rules is a follow-up —
// see PERFORMANCE-PLAN.md.
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "prisma/migrations/**",
      "next-env.d.ts",
      "scripts/**",
      "*.config.mjs",
      "*.config.js",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // The codebase uses `any` extensively in API payload handling; enabling
      // this would report thousands of pre-existing violations and drown out
      // real findings. Revisit alongside a typed-API-response effort.
      "@typescript-eslint/no-explicit-any": "off",

      // Pre-existing patterns, downgraded to warnings so they are visible in
      // output without failing CI. Fix opportunistically, then promote to error.
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      "jsx-a11y/alt-text": "warn",

      // 36 pre-existing hits, all apostrophes/quotes in user-facing copy
      // (e.g. "project's"). React renders these correctly; the rule guards
      // against ambiguity, not a defect. Escaping 36 UI strings would churn
      // customer-visible copy for no functional gain, so this stays a warning.
      "react/no-unescaped-entities": "warn",
    },
  },
];

export default eslintConfig;
