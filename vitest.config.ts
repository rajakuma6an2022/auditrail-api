import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
      JWT_SECRET: "test-secret-test-secret-test-secret-123456",
      CORS_ORIGIN: "http://localhost:3000",
    },
  },
});