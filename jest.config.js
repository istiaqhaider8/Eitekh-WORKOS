/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          paths: { "@/*": ["./src/*"] },
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
  // The integration suite needs a running server and its own database, and has
  // its own config (jest.integration.config.js). Keeping it out of `npm test`
  // means the unit suite stays runnable with no infrastructure.
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/integration/"],
  collectCoverageFrom: ["src/lib/**/*.ts", "!src/lib/prisma.ts"],
  forceExit: true,
};

module.exports = config;
