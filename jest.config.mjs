export default {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/\\.claude/"],
  modulePathIgnorePatterns: ["<rootDir>/\\.claude/"],
  haste: {
    retainAllFiles: false,
  },
  globals: {
    __APP_VERSION__: "1.0.0",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          types: ["jest", "node"],
        },
      },
    ],
  },
};
