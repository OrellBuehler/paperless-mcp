import { describe, it, expect } from "vitest";
import { buildQS, summarizeDocs, ok, err } from "../paperless/format.js";

describe("buildQS", () => {
  it("returns empty string for no params", () => expect(buildQS({})).toBe(""));
  it("builds one param", () => expect(buildQS({ query: "test" })).toBe("?query=test"));
  it("encodes special characters", () => expect(buildQS({ query: "a & b" })).toBe("?query=a+%26+b"));
  it("repeats keys for generic arrays", () =>
    expect(buildQS({ tags__id__all: [1, 2, 3] })).toBe("?tags__id__all=1&tags__id__all=2&tags__id__all=3"));
  it("comma-joins id__in", () => expect(buildQS({ id__in: [1, 2, 3] })).toBe("?id__in=1%2C2%2C3"));
  it("skips undefined and null", () => expect(buildQS({ query: "x", a: undefined, b: null })).toBe("?query=x"));
  it("stringifies numbers and booleans", () => expect(buildQS({ page: 1, db_only: true })).toBe("?page=1&db_only=true"));
  it("treats empty array as absent", () => expect(buildQS({ tags: [] })).toBe(""));
});

describe("summarizeDocs", () => {
  it("strips content from paginated results", () =>
    expect(summarizeDocs({ count: 1, results: [{ id: 1, title: "D", content: "x" }] }))
      .toEqual({ count: 1, results: [{ id: 1, title: "D" }] }));
  it("strips content from a bare array", () =>
    expect(summarizeDocs([{ id: 1, content: "x" }])).toEqual([{ id: 1 }]));
  it("strips content from a single object", () =>
    expect(summarizeDocs({ id: 1, content: "x", title: "t" })).toEqual({ id: 1, title: "t" }));
  it("passes through non-objects", () => expect(summarizeDocs("hi")).toBe("hi"));
});

describe("ok/err", () => {
  it("ok wraps JSON text", () => expect(ok({ a: 1 })).toEqual({ content: [{ type: "text", text: '{"a":1}' }] }));
  it("err marks isError", () =>
    expect(err(new Error("boom"))).toEqual({ content: [{ type: "text", text: "Error: boom" }], isError: true }));
});
