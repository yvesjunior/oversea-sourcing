import { describe, expect, it } from "vitest";
import { detailParams, eventParams } from "@/lib/event-params";

describe("eventParams", () => {
  it("parses what recordEvent writes", () => {
    // The real shapes: matches.created, research.completed, criteria.extracted.
    expect(eventParams('{"count":5,"analyzed":9}')).toEqual({ count: 5, analyzed: 9 });
    expect(eventParams('{"found":9,"added":9}')).toEqual({ found: 9, added: 9 });
  });

  it("returns an empty object for an event that took no params", () => {
    // Most events are like this — `message` is null and the label is a plain
    // sentence. The renderer must still be able to spread the result.
    expect(eventParams(null)).toEqual({});
    expect(eventParams(undefined)).toEqual({});
    expect(eventParams("")).toEqual({});
  });

  it("never throws on a malformed row", () => {
    // A bad row costs its own numbers, not the whole feed.
    expect(eventParams("not json")).toEqual({});
    expect(eventParams("{oops")).toEqual({});
    // Valid JSON that is not an object has no named values to interpolate.
    expect(eventParams("[1,2]")).toEqual({});
    expect(eventParams("42")).toEqual({});
    expect(eventParams("null")).toEqual({});
  });

  it("drops anything a label could not print", () => {
    // A label interpolates scalars. Letting objects through would invite
    // `{{supplier.name}}`-shaped keys that no translator can see in the file.
    expect(eventParams('{"count":3,"supplier":{"name":"MegaDome"},"tags":["a"]}')).toEqual({
      count: 3,
    });
    expect(eventParams('{"ok":true,"who":"staff","nope":null}')).toEqual({
      ok: true,
      who: "staff",
    });
  });
});

describe("detailParams", () => {
  it("takes contract_event.detail as the object it already is", () => {
    expect(detailParams({ method: "manual_upload", notified: 2 })).toEqual({
      method: "manual_upload",
      notified: 2,
    });
    expect(detailParams(null)).toEqual({});
  });
});
