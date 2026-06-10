import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateTokensTotal,
} from "../../src/utils/tokenCounter.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for empty string (falsy)", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates tokens for a single character", () => {
    // 1 char / 4 = 0.25, ceil = 1
    expect(estimateTokens("a")).toBe(1);
  });

  it("estimates tokens for exactly 4 characters", () => {
    // 4 chars / 4 = 1, ceil = 1
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("estimates tokens for 5 characters (rounds up)", () => {
    // 5 chars / 4 = 1.25, ceil = 2
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("estimates tokens for 8 characters", () => {
    // 8 chars / 4 = 2, ceil = 2
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("estimates tokens for a typical sentence", () => {
    const text = "Hello, world! This is a test sentence.";
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it("handles unicode characters", () => {
    // Unicode chars count as 1 per .length (BMP chars)
    const text = "こんにちは"; // 5 BMP chars
    expect(estimateTokens(text)).toBe(Math.ceil(5 / 4)); // ceil(1.25) = 2
  });

  it("handles surrogate pairs (emoji)", () => {
    // Each emoji is 2 UTF-16 code units
    const text = "😀😃"; // 2 emoji = 4 code units
    expect(estimateTokens(text)).toBe(Math.ceil(4 / 4)); // ceil(1) = 1
  });

  it("returns a number", () => {
    expect(typeof estimateTokens("test")).toBe("number");
  });

  it("never returns negative", () => {
    expect(estimateTokens("a")).toBeGreaterThanOrEqual(0);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("estimateTokensTotal", () => {
  it("returns 0 for empty array", () => {
    expect(estimateTokensTotal([])).toBe(0);
  });

  it("sums tokens across multiple strings", () => {
    const texts = ["abcd", "efgh", "ijkl"];
    // Each is 4 chars = 1 token, total = 3
    expect(estimateTokensTotal(texts)).toBe(3);
  });

  it("sums tokens with rounding per string", () => {
    const texts = ["abc", "def"];
    // "abc" = ceil(3/4) = 1, "def" = ceil(3/4) = 1, total = 2
    expect(estimateTokensTotal(texts)).toBe(2);
  });

  it("handles empty strings in array", () => {
    const texts = ["", "abcd", ""];
    // "" = 0, "abcd" = 1, "" = 0, total = 1
    expect(estimateTokensTotal(texts)).toBe(1);
  });

  it("handles single string", () => {
    const texts = ["hello world"];
    expect(estimateTokensTotal(texts)).toBe(estimateTokens("hello world"));
  });

  it("handles unicode strings", () => {
    const texts = ["café", "日本語"];
    // "café" = 4 chars = 1, "日本語" = 3 chars = ceil(3/4) = 1, total = 2
    expect(estimateTokensTotal(texts)).toBe(2);
  });

  it("returns a number", () => {
    expect(typeof estimateTokensTotal(["test"])).toBe("number");
  });
});
