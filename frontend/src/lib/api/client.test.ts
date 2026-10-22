import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, resolveApiUrl, setSessionExpiredHandler } from "./client";
import { clearTokens, readTokens, writeTokens } from "./tokens";

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const pair = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 900 });

const fetchMock = vi.fn<typeof fetch>();

function calls() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method,
    auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    body: init?.body as string | undefined,
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  clearTokens();
  setSessionExpiredHandler(undefined);
});

describe("api", () => {
  it("sends the access token and parses the JSON answer", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r" });
    fetchMock.mockResolvedValue(json(200, { id: "1" }));

    expect(await api<{ id: string }>("/me")).toEqual({ id: "1" });
    expect(calls()[0]).toMatchObject({ url: "http://localhost:4000/api/v1/me", method: "GET", auth: "Bearer a" });
  });

  it("builds the query string and skips empty values", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await api("/vehicles", { query: { search: "abc", state: undefined, limit: 20, offset: 0, x: "" } });
    expect(calls()[0].url).toBe("http://localhost:4000/api/v1/vehicles?search=abc&limit=20&offset=0");
  });

  it("does not attach the token to anonymous requests", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r" });
    fetchMock.mockResolvedValue(json(200, pair(1)));
    await api("/auth/login", { method: "POST", body: { email: "x", password: "y" }, anonymous: true });
    expect(calls()[0].auth).toBeUndefined();
    expect(calls()[0].body).toBe('{"email":"x","password":"y"}');
  });

  it("returns undefined for an empty answer", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api("/auth/logout", { method: "POST", body: {} })).toBeUndefined();
  });

  it("turns an error answer into ApiError with the code and joined messages", async () => {
    fetchMock.mockResolvedValue(json(403, { statusCode: 403, message: "Email is not verified", code: "EMAIL_NOT_VERIFIED" }));
    await expect(api("/auth/login", { anonymous: true })).rejects.toMatchObject({
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
      message: "Email is not verified",
    });

    fetchMock.mockResolvedValue(json(400, { message: ["a must be x", "b must be y"] }));
    const err = await api("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("a must be x; b must be y");
  });

  it("reports a network failure as status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(api("/me")).rejects.toMatchObject({ status: 0 });
  });

  describe("token refresh", () => {
    it("refreshes once on 401, stores the new pair and repeats the request", async () => {
      writeTokens({ accessToken: "old", refreshToken: "refresh-0" });
      fetchMock
        .mockResolvedValueOnce(json(401, { message: "Unauthorized" }))
        .mockResolvedValueOnce(json(200, pair(1)))
        .mockResolvedValueOnce(json(200, { ok: true }));

      expect(await api("/me")).toEqual({ ok: true });
      expect(calls().map((c) => [c.url.replace("http://localhost:4000/api/v1", ""), c.auth])).toEqual([
        ["/me", "Bearer old"],
        ["/auth/refresh", undefined],
        ["/me", "Bearer access-1"],
      ]);
      expect(calls()[1].body).toBe('{"refreshToken":"refresh-0"}');
      expect(readTokens()).toEqual({ accessToken: "access-1", refreshToken: "refresh-1" });
    });

    it("sends a single refresh request for parallel 401 answers", async () => {
      writeTokens({ accessToken: "old", refreshToken: "refresh-0" });
      fetchMock.mockImplementation(async (url, init) => {
        const u = String(url);
        if (u.endsWith("/auth/refresh")) return json(200, pair(1));
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === "Bearer old" ? json(401, {}) : json(200, { path: u });
      });

      const results = await Promise.all([api("/a"), api("/b"), api("/c")]);
      expect(results).toHaveLength(3);
      expect(calls().filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
    });

    it("uses the pair that another tab has already stored instead of spending the old refresh token", async () => {
      writeTokens({ accessToken: "old", refreshToken: "refresh-0" });
      fetchMock.mockImplementationOnce(async () => {
        writeTokens({ accessToken: "tab-access", refreshToken: "tab-refresh" });
        return json(401, {});
      });
      fetchMock.mockResolvedValueOnce(json(200, { ok: true }));

      expect(await api("/me")).toEqual({ ok: true });
      expect(calls().some((c) => c.url.endsWith("/auth/refresh"))).toBe(false);
      expect(calls()[1].auth).toBe("Bearer tab-access");
    });

    it("ends the session when the refresh token is rejected", async () => {
      writeTokens({ accessToken: "old", refreshToken: "refresh-0" });
      const expired = vi.fn();
      setSessionExpiredHandler(expired);
      fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(401, {}));

      await expect(api("/me")).rejects.toMatchObject({ status: 401 });
      expect(expired).toHaveBeenCalledOnce();
      expect(readTokens()).toBeNull();
    });

    it("keeps the session when the refresh fails because of the network", async () => {
      writeTokens({ accessToken: "old", refreshToken: "refresh-0" });
      const expired = vi.fn();
      setSessionExpiredHandler(expired);
      fetchMock.mockResolvedValueOnce(json(401, {})).mockRejectedValueOnce(new TypeError("offline"));

      await expect(api("/me")).rejects.toMatchObject({ status: 401 });
      expect(expired).not.toHaveBeenCalled();
      expect(readTokens()).toEqual({ accessToken: "old", refreshToken: "refresh-0" });
    });

    it("does not try to refresh without tokens", async () => {
      fetchMock.mockResolvedValue(json(401, {}));
      await expect(api("/me")).rejects.toMatchObject({ status: 401 });
      expect(calls()).toHaveLength(1);
    });
  });
});

describe("resolveApiUrl", () => {
  it("keeps absolute links and resolves relative ones against the API origin", () => {
    expect(resolveApiUrl("https://s3.example.com/f?sig=1")).toBe("https://s3.example.com/f?sig=1");
    expect(resolveApiUrl("/api/v1/files/download?key=1&sig=2")).toBe(
      "http://localhost:4000/api/v1/files/download?key=1&sig=2",
    );
  });
});
