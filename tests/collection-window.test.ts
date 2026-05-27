import { describe, expect, test } from "bun:test";

import { parseCollectionWindow } from "../src/collect/window";

describe("collection windows", () => {
  test("accepts an absolute timestamp", () => {
    expect(
      parseCollectionWindow("2026-05-01T10:02:00.000Z"),
    ).toMatchObject({
      since: new Date("2026-05-01T10:02:00.000Z"),
    });
  });

  test("accepts a relative backfill window", () => {
    expect(
      parseCollectionWindow("2h", new Date("2026-05-01T10:02:00.000Z")),
    ).toMatchObject({
      since: new Date("2026-05-01T08:02:00.000Z"),
    });
  });
});
