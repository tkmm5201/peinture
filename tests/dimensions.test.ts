import { describe, it, expect } from "vitest";
import { getBaseDimensions, getDimensions } from "../services/dimensions";

describe("getBaseDimensions", () => {
  it("should return correct dimensions for 1:1", () => {
    expect(getBaseDimensions("1:1")).toEqual({ width: 1024, height: 1024 });
  });

  it("should return correct dimensions for 16:9", () => {
    expect(getBaseDimensions("16:9")).toEqual({ width: 1024, height: 576 });
  });

  it("should return correct dimensions for 9:16", () => {
    expect(getBaseDimensions("9:16")).toEqual({ width: 576, height: 1024 });
  });

  it("should return correct dimensions for 3:4", () => {
    expect(getBaseDimensions("3:4")).toEqual({ width: 768, height: 1024 });
  });

  it("should return correct dimensions for 4:3", () => {
    expect(getBaseDimensions("4:3")).toEqual({ width: 1024, height: 768 });
  });

  it("should return correct dimensions for 2:3", () => {
    expect(getBaseDimensions("2:3")).toEqual({ width: 640, height: 960 });
  });

  it("should return correct dimensions for 3:2", () => {
    expect(getBaseDimensions("3:2")).toEqual({ width: 960, height: 640 });
  });

  it("should return 1:1 for unknown aspect ratios", () => {
    expect(getBaseDimensions("5:7" as any)).toEqual({
      width: 1024,
      height: 1024,
    });
  });
});

describe("getDimensions", () => {
  it("should return base dimensions when HD is false", () => {
    const result = getDimensions("16:9", false);
    expect(result).toEqual({ width: 1024, height: 576 });
  });

  it("should return 1.5x dimensions when HD is true", () => {
    const result = getDimensions("1:1", true);
    expect(result).toEqual({ width: 2048, height: 2048 });
  });

  it("should apply custom multiplier", () => {
    const result = getDimensions("1:1", true, 2);
    expect(result).toEqual({ width: 2048, height: 2048 });
  });
});
