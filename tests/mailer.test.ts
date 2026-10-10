import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadMailer(key?: string) {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", key ?? "");
  return import("../src/lib/mailer.js");
}

describe("mailer", () => {
  it("logs the link and does not call the network without an API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendMagicLinkEmail } = await loadMailer();
    await sendMagicLinkEmail("a@b.com", "http://x/auth/verify?token=t");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("posts to Resend with the key, recipient and link", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { sendMagicLinkEmail } = await loadMailer("re_test_123");
    await sendMagicLinkEmail("a@b.com", "http://x/auth/verify?token=t");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_123");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["a@b.com"]);
    expect(body.html).toContain("http://x/auth/verify?token=t");
    expect(body.text).toContain("http://x/auth/verify?token=t");
  });

  it("throws when Resend rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "nope" }));
    const { sendMagicLinkEmail } = await loadMailer("re_test_123");
    await expect(sendMagicLinkEmail("a@b.com", "u")).rejects.toThrow(/403/);
  });
});
