import { describe, it, expect } from "vitest";
import { resolveErrorMessage } from "../services/errorUtils";

const mockTranslations: Record<string, string> = {
  error_quota_exhausted: "API 配额已用完",
  error_upscale_failed: "放大失败",
  generationFailed: "生成失败",
  error_prompt_optimization_failed: "提示词优化失败",
};

describe("resolveErrorMessage", () => {
  it("should return translated message when error message is a known i18n key", () => {
    const err = new Error("error_quota_exhausted");
    const result = resolveErrorMessage(err, mockTranslations);
    expect(result).toBe("API 配额已用完");
  });

  it("should return fallback translation for unknown i18n-style keys", () => {
    const err = new Error("error_unknown_key");
    const result = resolveErrorMessage(
      err,
      mockTranslations,
      "error_upscale_failed",
    );
    expect(result).toBe("放大失败");
  });

  it("should return raw error message for non-i18n errors", () => {
    const err = new Error("Network timeout after 30s");
    const result = resolveErrorMessage(err, mockTranslations);
    expect(result).toBe("Network timeout after 30s");
  });

  it("should handle string errors", () => {
    const result = resolveErrorMessage(
      "error_quota_exhausted",
      mockTranslations,
    );
    expect(result).toBe("API 配额已用完");
  });

  it("should return generationFailed for unknown errors without fallback", () => {
    const err = new Error("error_some_unknown_key");
    const result = resolveErrorMessage(err, mockTranslations);
    expect(result).toBe("生成失败");
  });

  it("should handle null/undefined errors gracefully", () => {
    const result = resolveErrorMessage(null, mockTranslations);
    expect(result).toBe("生成失败");
  });

  it("should use specified fallback key when available", () => {
    const result = resolveErrorMessage(undefined, mockTranslations, "error_upscale_failed");
    expect(result).toBe("放大失败");
  });
});
