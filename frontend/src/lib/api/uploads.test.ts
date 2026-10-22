import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { writeTokens } from "./tokens";
import { kindOfFile, uploadFile } from "./uploads";

const fetchMock = vi.fn<typeof fetch>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const presigned = {
  key: "photo/1/abc.png",
  uploadUrl: "/api/v1/files/upload?key=photo%2F1%2Fabc.png&sig=s",
  method: "PUT",
  headers: { "Content-Type": "image/png" },
  expiresIn: 900,
};

const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  writeTokens({ accessToken: "a", refreshToken: "r" });
});

describe("kindOfFile", () => {
  it("tells photos, videos and documents apart by mime type", () => {
    expect(kindOfFile(new File([], "a.jpg", { type: "image/jpeg" }))).toBe("PHOTO");
    expect(kindOfFile(new File([], "a.mp4", { type: "video/mp4" }))).toBe("VIDEO");
    expect(kindOfFile(new File([], "a.pdf", { type: "application/pdf" }))).toBe("FILE");
    expect(kindOfFile(new File([], "a.bin"))).toBe("FILE");
  });
});

describe("uploadFile", () => {
  it("asks for a signed link, puts the file there with the given headers and returns the key", async () => {
    fetchMock.mockResolvedValueOnce(json(200, presigned)).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const file = png();

    expect(await uploadFile(file)).toEqual({ key: "photo/1/abc.png", kind: "PHOTO" });

    const [presign, put] = fetchMock.mock.calls;
    expect(String(presign[0])).toBe("http://localhost:4000/api/v1/uploads/presign");
    expect(JSON.parse(presign[1]?.body as string)).toEqual({ kind: "PHOTO", mime: "image/png", size: 3 });
    // относительная ссылка разрешается относительно адреса API
    expect(String(put[0])).toBe("http://localhost:4000/api/v1/files/upload?key=photo%2F1%2Fabc.png&sig=s");
    expect(put[1]).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/png" }, body: file });
  });

  it("explains unsupported and oversized files in plain words", async () => {
    fetchMock.mockResolvedValueOnce(json(415, { message: "Unsupported" }));
    await expect(uploadFile(png())).rejects.toMatchObject({ status: 415, message: "Файл «a.png»: такой тип не принимается" });

    fetchMock.mockResolvedValueOnce(json(413, { message: "Too large" }));
    await expect(uploadFile(png())).rejects.toMatchObject({ status: 413, message: "Файл «a.png» слишком большой" });
  });

  it("fails when the storage refuses the file or cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce(json(200, presigned)).mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(uploadFile(png())).rejects.toMatchObject({ status: 403 });

    fetchMock.mockResolvedValueOnce(json(200, presigned)).mockRejectedValueOnce(new TypeError("offline"));
    const err = await uploadFile(png()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });
});
