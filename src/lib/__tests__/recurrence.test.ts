/**
 * The schedule a recurring task actually keeps.
 *
 * Every one of these failed before `nextRunFrom` existed, because the function
 * it replaces added one day regardless of the cadence it was handed.
 */

import { nextRunFrom } from "../recurrence";

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("nextRunFrom", () => {
  it("DAILY advances one day", () => {
    expect(iso(nextRunFrom("DAILY", at("2026-03-10T09:00:00Z")).at)).toBe("2026-03-11");
  });

  it("WEEKLY advances seven days, not one", () => {
    // The original defect: this returned the 11th.
    expect(iso(nextRunFrom("WEEKLY", at("2026-03-10T09:00:00Z")).at)).toBe("2026-03-17");
  });

  it("MONTHLY advances one month, not one day", () => {
    expect(iso(nextRunFrom("MONTHLY", at("2026-03-10T09:00:00Z")).at)).toBe("2026-04-10");
  });

  it("keeps the time of day", () => {
    const next = nextRunFrom("WEEKLY", at("2026-03-10T14:30:00Z")).at;
    expect(next.getHours()).toBe(at("2026-03-10T14:30:00Z").getHours());
    expect(next.getMinutes()).toBe(30);
  });

  // --- the month-end trap --------------------------------------------------

  it("MONTHLY from 31 January lands in February, not March", () => {
    // Naive setMonth(+1) on a day-31 date overflows: 31 Feb becomes 3 March.
    // A task created on the 31st would drift forward every single month.
    expect(iso(nextRunFrom("MONTHLY", at("2026-01-31T09:00:00Z")).at)).toBe("2026-02-28");
  });

  it("MONTHLY from 31 January in a LEAP year lands on the 29th", () => {
    expect(iso(nextRunFrom("MONTHLY", at("2028-01-31T09:00:00Z")).at)).toBe("2028-02-29");
  });

  it("MONTHLY from 31 March lands on 30 April", () => {
    expect(iso(nextRunFrom("MONTHLY", at("2026-03-31T09:00:00Z")).at)).toBe("2026-04-30");
  });

  it("MONTHLY from 31 December rolls the year", () => {
    expect(iso(nextRunFrom("MONTHLY", at("2026-12-31T09:00:00Z")).at)).toBe("2027-01-31");
  });

  it("WEEKLY crosses a month boundary", () => {
    expect(iso(nextRunFrom("WEEKLY", at("2026-03-28T09:00:00Z")).at)).toBe("2026-04-04");
  });

  // --- unknown values ------------------------------------------------------

  it("accepts the cadence in any case, because it is stored as free text", () => {
    expect(iso(nextRunFrom("weekly", at("2026-03-10T09:00:00Z")).at)).toBe("2026-03-17");
    expect(iso(nextRunFrom("  Monthly  ", at("2026-03-10T09:00:00Z")).at)).toBe("2026-04-10");
    expect(nextRunFrom("WEEKLY", at("2026-03-10T09:00:00Z")).assumedDaily).toBe(false);
  });

  it("falls back to DAILY for anything unrecognised, and SAYS so", () => {
    // Legacy rows may hold something else. Keeping their existing cadence is
    // less disruptive than stopping them; the flag is what makes it visible
    // rather than merely odd.
    for (const odd of ["0 9 * * 1", "", "   ", "HOURLY", null, undefined]) {
      const r = nextRunFrom(odd as any, at("2026-03-10T09:00:00Z"));
      expect(iso(r.at)).toBe("2026-03-11");
      expect(r.assumedDaily).toBe(true);
    }
  });

  it("does not mutate the date it was given", () => {
    const from = at("2026-03-10T09:00:00Z");
    const before = from.getTime();
    nextRunFrom("MONTHLY", from);
    expect(from.getTime()).toBe(before);
  });

  it("always returns a time in the future relative to its input", () => {
    const from = at("2026-03-10T09:00:00Z");
    for (const cadence of ["DAILY", "WEEKLY", "MONTHLY", "nonsense"]) {
      expect(nextRunFrom(cadence, from).at.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});
