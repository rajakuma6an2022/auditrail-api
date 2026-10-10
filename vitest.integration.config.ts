import { defineConfig } from "vitest/config";

const url = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests-integration/**/*.test.ts"],
    globalSetup: ["./tests-integration/global-setup.ts"],
    fileParallelism: false, // all files share one database
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: url,
      DIRECT_URL: url,
      JWT_SECRET: "integration-secret-integration-secret-123456",
      CORS_ORIGIN: "http://localhost:3000",
      APP_URL: "http://localhost:3000",
      RESEND_API_KEY: "",
    },
  },
});
