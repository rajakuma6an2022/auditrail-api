export default function setup() {
  const raw = process.env.TEST_DATABASE_URL;

  if (!raw) {
    throw new Error("TEST_DATABASE_URL is not set.");
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL is invalid.");
  }

  const dbName = url.pathname.replace(/^\/+/, "");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);

  const localTestDb = local && /_(test|e2e)$/.test(dbName);

  // Exact hostname previously verified for the e2e-test Neon branch.
  const neonTestHost = "ep-silent-flower-b30brrh6-pooler.c-4.ap-southeast-1.aws.neon.tech";

  const explicitlyAllowedNeon =
    process.env.ALLOW_NEON_TEST_DATABASE === "true" && url.protocol === "postgresql:" && url.hostname === neonTestHost;

  if (!localTestDb && !explicitlyAllowedNeon) {
    throw new Error(
      `Refusing integration tests against ${url.hostname}/${dbName}. ` +
        "Use a local _test/_e2e database or explicitly approved e2e-test Neon branch.",
    );
  }
}
