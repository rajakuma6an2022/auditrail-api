// Refuses to run against anything that is not an obviously local/throwaway database,
// because these tests TRUNCATE tables.
export default function setup() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Example: postgresql://postgres:postgres@localhost:5433/auditrail_test",
    );
  }
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const dbName = url.pathname.replace("/", "");
  if (!local || !dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against ${url.hostname}/${dbName}. ` +
        "Host must be localhost and the database name must end with _test.",
    );
  }
}
