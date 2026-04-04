import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatOutput } from "../src/formatter.js";

const items = ["apple", "banana", "cherry"];

describe("formatOutput — table", () => {
  it("returns one row per item", () => {
    const result = formatOutput(items, "table");
    const lines = result.split("\n");
    assert.equal(lines.length, 3);
  });
});

describe("formatOutput — json", () => {
  it("returns valid JSON array", () => {
    const result = formatOutput(items, "json");
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed, items);
  });
});

describe("formatOutput — unknown format", () => {
  it("throws on unsupported format string", () => {
    assert.throws(
      () => formatOutput(items, "unsupported"),
      /Unknown format/
    );
  });

  it("throws on empty format string", () => {
    assert.throws(
      () => formatOutput(items, ""),
      /Unknown format/
    );
  });
});
