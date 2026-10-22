import { describe, expect, it } from "vitest";
import { dateFull, dateShort, dateTime, money, ownerKindLabel, ownerKindLong, reqTitle, vehicleTone } from "./format";

describe("dates", () => {
  // без «Z»: время местное, поэтому результат не зависит от часового пояса машины
  const iso = "2026-09-05T08:07:00";
  it("formats the full date, the short date and the message time", () => {
    expect(dateFull(iso)).toBe("05.09.2026");
    expect(dateShort(iso)).toBe("05.09");
    expect(dateTime(iso)).toBe("05.09, 08:07");
  });
});

describe("money", () => {
  it("groups thousands and adds the ruble sign", () => {
    expect(money(1600000).replace(/\s/g, " ")).toBe("1 600 000 ₽");
  });
  it("says so when the budget is missing", () => {
    expect(money(null)).toBe("не указан");
  });
});

describe("reqTitle", () => {
  it("adds the year when it is set", () => {
    expect(reqTitle({ title: "Haval Jolion", yearFrom: 2023 })).toBe("Haval Jolion, 2023");
    expect(reqTitle({ title: "Haval Jolion", yearFrom: null })).toBe("Haval Jolion");
  });
});

describe("vehicleTone", () => {
  it("is success when the car is ready, whatever it still waits for", () => {
    expect(vehicleTone({ currentStep: 13, awaitingAttachment: true })).toBe("success");
  });
  it("warns while the current step waits for an attachment", () => {
    expect(vehicleTone({ currentStep: 9, awaitingAttachment: true })).toBe("warning");
    expect(vehicleTone({ currentStep: 9, awaitingAttachment: false })).toBe("accent");
  });
});

describe("owner labels", () => {
  it("names both kinds of clients", () => {
    expect(ownerKindLabel("COMPANY")).toBe("Компания по привозу");
    expect(ownerKindLabel("PERSON")).toBe("Физ.лицо");
    expect(ownerKindLong("COMPANY")).toBe("Компания по привозу · юр.лицо");
    expect(ownerKindLong("PERSON")).toBe("Физ.лицо");
  });
});
