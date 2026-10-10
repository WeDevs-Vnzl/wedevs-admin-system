import { describe, expect, it } from "vitest";

import {
  addDays,
  daysBetween,
  formatDate,
  formatDateTime,
  isBusinessDay,
  parseDateOnly,
  todayInCaracas,
  toDateOnly,
  toZonedDate,
} from "./dates";

describe("todayInCaracas (UTC-4, no DST)", () => {
  it("is still the previous day between 00:00 and 03:59 UTC", () => {
    expect(todayInCaracas(new Date("2026-03-10T00:00:00Z"))).toBe("2026-03-09");
    expect(todayInCaracas(new Date("2026-03-10T03:59:59Z"))).toBe("2026-03-09");
  });

  it("rolls over at 04:00 UTC", () => {
    expect(todayInCaracas(new Date("2026-03-10T04:00:00Z"))).toBe("2026-03-10");
    expect(todayInCaracas(new Date("2026-03-10T23:59:59Z"))).toBe("2026-03-10");
  });

  it("crosses year and month boundaries", () => {
    expect(todayInCaracas(new Date("2027-01-01T02:00:00Z"))).toBe("2026-12-31");
    expect(todayInCaracas(new Date("2026-03-01T03:00:00Z"))).toBe("2026-02-28");
  });

  it("does not depend on the process zone", () => {
    const original = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    try {
      expect(todayInCaracas(new Date("2026-03-10T03:00:00Z"))).toBe("2026-03-09");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("toDateOnly", () => {
  it("defaults to Caracas and accepts another zone", () => {
    const instant = new Date("2026-03-10T02:00:00Z");
    expect(toDateOnly(instant)).toBe("2026-03-09");
    expect(toDateOnly(instant, "UTC")).toBe("2026-03-10");
    expect(toDateOnly(instant, "Asia/Tokyo")).toBe("2026-03-10");
  });
});

describe("parseDateOnly", () => {
  it("returns midnight UTC", () => {
    expect(parseDateOnly("2026-03-10").toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });

  it("accepts a leap day only in leap years", () => {
    expect(parseDateOnly("2028-02-29").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(() => parseDateOnly("2026-02-29")).toThrow(RangeError);
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "2026-3-10", "10/03/2026", "2026-13-01", "2026-00-10", "2026-03-32"]) {
      expect(() => parseDateOnly(bad)).toThrow(RangeError);
    }
  });
});

describe("addDays / daysBetween", () => {
  it("adds across months, years and leap days", () => {
    expect(addDays("2026-03-10", 30)).toBe("2026-04-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-10", -10)).toBe("2026-02-28");
    expect(addDays("2026-03-10", 0)).toBe("2026-03-10");
  });

  it("counts calendar days with sign", () => {
    expect(daysBetween("2026-03-10", "2026-03-10")).toBe(0);
    expect(daysBetween("2026-03-10", "2026-03-15")).toBe(5);
    expect(daysBetween("2026-03-15", "2026-03-10")).toBe(-5);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });
});

describe("isBusinessDay", () => {
  it("is Monday to Friday", () => {
    expect(isBusinessDay("2026-03-09")).toBe(true); // Monday
    expect(isBusinessDay("2026-03-13")).toBe(true); // Friday
    expect(isBusinessDay("2026-03-14")).toBe(false); // Saturday
    expect(isBusinessDay("2026-03-15")).toBe(false); // Sunday
  });
});

describe("formatDate", () => {
  it("formats date-only values without zone shifting", () => {
    expect(formatDate("2026-03-10", "es", "short")).toBe("10/03/2026");
    expect(formatDate("2026-03-10", "en", "short")).toBe("03/10/2026");
    expect(formatDate("2026-03-10", "es", "medium")).toBe("10 mar 2026");
    expect(formatDate("2026-03-10", "en", "medium")).toBe("Mar 10, 2026");
    expect(formatDate("2026-03-10", "es", "long")).toBe("10 de marzo de 2026");
    expect(formatDate("2026-03-10", "en-US", "long")).toBe("March 10, 2026");
    expect(formatDate("2026-03-10", "es", "short", "Pacific/Kiritimati")).toBe("10/03/2026");
  });

  it("defaults the style to medium", () => {
    expect(formatDate("2026-03-10", "en")).toBe("Mar 10, 2026");
  });

  it("shows an instant in Caracas by default and in the given zone otherwise", () => {
    const instant = new Date("2026-03-10T02:30:00Z");
    expect(formatDate(instant, "es", "short")).toBe("09/03/2026");
    expect(formatDate(instant, "es", "short", "UTC")).toBe("10/03/2026");
    expect(formatDate(instant, "en", "long", "Asia/Tokyo")).toBe("March 10, 2026");
  });
});

describe("formatDateTime", () => {
  const instant = new Date("2026-03-10T02:30:15Z");

  it("uses Caracas by default", () => {
    expect(formatDateTime(instant, "es", "short")).toBe("09/03/2026 22:30");
    expect(formatDateTime(instant, "es", "medium")).toBe("9 mar 2026, 22:30");
    expect(formatDateTime(instant, "es", "long")).toBe("9 de marzo de 2026, 22:30:15");
    expect(formatDateTime(instant, "en", "short")).toBe("03/09/2026 10:30 PM");
    expect(formatDateTime(instant, "en", "medium")).toBe("Mar 9, 2026, 10:30 PM");
    expect(formatDateTime(instant, "en", "long")).toBe("March 9, 2026, 10:30:15 PM");
  });

  it("takes the display zone as a parameter", () => {
    expect(formatDateTime(instant, "es", "short", "UTC")).toBe("10/03/2026 02:30");
    expect(formatDateTime(instant, "en", "short", "Europe/Madrid")).toBe("03/10/2026 3:30 AM");
  });

  it("defaults the style to medium", () => {
    expect(formatDateTime(instant, "en")).toBe("Mar 9, 2026, 10:30 PM");
  });
});

describe("toZonedDate", () => {
  it("returns wall-clock fields of the zone", () => {
    const zoned = toZonedDate(new Date("2026-03-10T02:30:00Z"));
    expect(zoned.getHours()).toBe(22);
    expect(zoned.getDate()).toBe(9);
  });
});
