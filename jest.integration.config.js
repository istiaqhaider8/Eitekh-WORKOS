/**
 * PROD-5 / PROD-6 — integration test configuration.
 *
 * Kept separate from jest.config.js because these tests need a database and a
 * running server, while the unit suite deliberately needs neither. Mixing them
 * would make `npm test` require infrastructure, and a test suite that is
 * awkward to run is a test suite that stops being run.
 *
 * Run with: npm run test:integration
 *
 * @type {import('jest').Config}
 */
const config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          paths: { "@/*": ["./src/*"] },
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // A relative glob, not <rootDir>: on Windows the latter interpolates mixed
  // path separators and matches nothing.
  testMatch: ["**/__tests__/integration/**/*.test.ts"],
  // These talk to a server over HTTP; the default 5s is not enough for the
  // first request after a cold start.
  testTimeout: 30_000,
  // Serial. The suite asserts on rows it created, and the middleware rate
  // limits per user — parallel workers would produce 429s that look like
  // isolation failures.
  maxWorkers: 1,
  forceExit: true,
};

module.exports = config;
