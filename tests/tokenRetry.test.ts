import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWithTokenRetry } from "../services/tokenRetry";

// Mock the appStore
const mockState = {
  tokens: {
    huggingface: ["hf_token1", "hf_token2"],
    gitee: ["gitee_token1"],
    modelscope: [],
    a4f: ["a4f_token1"],
  },
  tokenStatus: {
    huggingface: { date: "", exhausted: {} },
    gitee: { date: "", exhausted: {} },
    modelscope: { date: "", exhausted: {} },
    a4f: { date: "", exhausted: {} },
  },
  resetDailyStatus: vi.fn(),
  markTokenExhausted: vi.fn((providerId: string, token: string) => {
    mockState.tokenStatus[
      providerId as keyof typeof mockState.tokenStatus
    ].exhausted[token] = true;
  }),
};

vi.mock("../store/configStore", () => ({
  useConfigStore: {
    getState: () => mockState,
  },
}));

describe("tokenRetry", () => {
  beforeEach(() => {
    // Reset exhausted status
    Object.keys(mockState.tokenStatus).forEach((key) => {
      mockState.tokenStatus[
        key as keyof typeof mockState.tokenStatus
      ].exhausted = {};
    });
    vi.clearAllMocks();
  });

  describe("HuggingFace (optional tokens)", () => {
    it("should run with null token when no tokens configured", async () => {
      const originalTokens = mockState.tokens.huggingface;
      mockState.tokens.huggingface = [];

      const operation = vi.fn().mockResolvedValue("result");
      const result = await runWithTokenRetry("huggingface", operation);

      expect(result).toBe("result");
      expect(operation).toHaveBeenCalledWith(null);

      mockState.tokens.huggingface = originalTokens;
    });

    it("should use first available token", async () => {
      const operation = vi.fn().mockResolvedValue("result");
      await runWithTokenRetry("huggingface", operation);

      expect(operation).toHaveBeenCalledWith("hf_token1");
    });

    it("should rotate tokens on quota error", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("429"))
        .mockResolvedValue("success");

      const result = await runWithTokenRetry("huggingface", operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
      expect(operation).toHaveBeenNthCalledWith(1, "hf_token1");
      expect(operation).toHaveBeenNthCalledWith(2, "hf_token2");
      expect(mockState.markTokenExhausted).toHaveBeenCalledWith(
        "huggingface",
        "hf_token1",
      );
    });

    it("should throw exhausted error when all tokens are exhausted", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("429"))
        .mockRejectedValueOnce(new Error("429"));

      await expect(runWithTokenRetry("huggingface", operation)).rejects.toThrow(
        "error_quota_exhausted",
      );
    });

    it("should not retry on AbortError", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";

      const operation = vi.fn().mockRejectedValue(abortError);

      await expect(runWithTokenRetry("huggingface", operation)).rejects.toThrow(
        "Aborted",
      );
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should not retry on non-quota errors", async () => {
      const operation = vi.fn().mockRejectedValue(new Error("Network failed"));

      await expect(runWithTokenRetry("huggingface", operation)).rejects.toThrow(
        "Network failed",
      );
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe("Gitee (required tokens)", () => {
    it("should throw required error when no tokens configured", async () => {
      const originalTokens = mockState.tokens.gitee;
      mockState.tokens.gitee = [];

      const operation = vi.fn();

      await expect(runWithTokenRetry("gitee", operation)).rejects.toThrow(
        "error_gitee_token_required",
      );

      expect(operation).not.toHaveBeenCalled();
      mockState.tokens.gitee = originalTokens;
    });
  });

  describe("ModelScope (required tokens)", () => {
    it("should throw required error when no tokens configured", async () => {
      const operation = vi.fn();

      await expect(runWithTokenRetry("modelscope", operation)).rejects.toThrow(
        "error_ms_token_required",
      );

      expect(operation).not.toHaveBeenCalled();
    });
  });
});
