import { describe, expect, it } from "vitest";
import { fileDownloadPath } from "./file-url";

describe("fileDownloadPath", () => {
  it("builds the authenticated download route path", () => {
    expect(fileDownloadPath("file_123")).toBe("/files/file_123/download");
  });

  it("encodes ids so they cannot escape the path segment", () => {
    expect(fileDownloadPath("a/b?c")).toBe("/files/a%2Fb%3Fc/download");
  });
});
