import { describe, expect, it } from "vitest";
import type { Schemas } from "./api/client";
import { messageAttachments, stepAttachments, storedAttachments } from "./attachments";

const file = (kind: Schemas["StepAttachmentDto"]["kind"], n: number): Schemas["StepAttachmentDto"] => ({
  id: String(n),
  kind,
  mime: "x/y",
  size: 1,
  createdAt: "2026-09-26T10:00:00.000Z",
  url: `/api/v1/files/download?key=${n}`,
});

describe("storedAttachments", () => {
  it("names a single file by its kind and keeps the link", () => {
    expect(storedAttachments([file("VIDEO", 1)])).toEqual([{ kind: "video", label: "Видео", href: "/api/v1/files/download?key=1" }]);
  });

  it("numbers several files of the same kind separately for every kind", () => {
    const labels = storedAttachments([file("PHOTO", 1), file("FILE", 2), file("PHOTO", 3), file("PHOTO", 4)]).map((a) => a.label);
    expect(labels).toEqual(["Фото 1", "Файл", "Фото 2", "Фото 3"]);
  });
});

describe("stepAttachments", () => {
  const step = (over: Partial<Schemas["VehicleStepDto"]>): Schemas["VehicleStepDto"] => ({
    step: 10,
    title: "Декларация подана",
    state: "CURRENT",
    completedAt: null,
    expectedAttachment: "DECLARATION_NUMBER",
    declarationNumber: null,
    attachments: [],
    ...over,
  });

  it("is empty while nothing is attached", () => {
    expect(stepAttachments(step({}))).toEqual([]);
  });

  it("puts the declaration number first, without a link", () => {
    const [first, second] = stepAttachments(step({ declarationNumber: "10702070/181024/5012345", attachments: [file("FILE", 1)] }));
    expect(first).toEqual({ kind: "number", label: "№ 10702070/181024/5012345" });
    expect(second.kind).toBe("file");
  });
});

describe("messageAttachments", () => {
  const message = (over: Partial<Schemas["MessageViewDto"]>): Schemas["MessageViewDto"] => ({
    id: "m",
    requestId: "r",
    type: "TEXT",
    text: null,
    links: [],
    durationSec: null,
    attachments: [],
    author: null,
    isMine: false,
    createdAt: "2026-09-26T10:00:00.000Z",
    ...over,
  });

  it("lists files first, then links with their addresses", () => {
    const list = messageAttachments(message({ attachments: [file("PHOTO", 1)], links: ["https://a.example/1", "https://a.example/2"] }));
    expect(list.map((a) => a.label)).toEqual(["Фото", "Ссылка на объявление 1", "Ссылка на объявление 2"]);
    expect(list[1].href).toBe("https://a.example/1");
  });

  it("marks a voice message as audio", () => {
    expect(messageAttachments(message({ type: "VOICE", attachments: [file("AUDIO", 1)] }))[0]).toMatchObject({ kind: "audio", label: "Голосовое" });
  });
});
