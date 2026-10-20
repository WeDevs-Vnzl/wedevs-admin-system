import { describe, expect, it } from "vitest";
import { applyMarkdownFormat, cursorPosition, countWords } from "./markdown-editor-format";

describe("applyMarkdownFormat", () => {
  it("wraps the selection in inline marks and keeps it selected", () => {
    expect(applyMarkdownFormat("say hello", 4, 9, "bold")).toEqual({
      value: "say **hello**",
      selectionStart: 6,
      selectionEnd: 11,
    });
    expect(applyMarkdownFormat("x", 0, 1, "strike").value).toBe("~~x~~");
    expect(applyMarkdownFormat("x", 0, 1, "code").value).toBe("`x`");
  });

  it("inserts a placeholder when nothing is selected", () => {
    const result = applyMarkdownFormat("", 0, 0, "italic");
    expect(result.value).toBe("*text*");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("text");
  });

  it("prefixes every selected line for headings, lists, tasks and quotes", () => {
    expect(applyMarkdownFormat("one\ntwo", 0, 7, "bulletList").value).toBe("- one\n- two");
    expect(applyMarkdownFormat("one\ntwo", 0, 7, "orderedList").value).toBe("1. one\n2. two");
    expect(applyMarkdownFormat("a\ntitle", 3, 3, "h2").value).toBe("a\n## title");
    expect(applyMarkdownFormat("todo", 0, 0, "taskList").value).toBe("- [ ] todo");
    expect(applyMarkdownFormat("said", 0, 4, "quote").value).toBe("> said");
  });

  it("builds links, code blocks and tables", () => {
    expect(applyMarkdownFormat("site", 0, 4, "link").value).toBe("[site](https://)");
    expect(applyMarkdownFormat("a = 1", 0, 5, "codeBlock").value).toBe("```\na = 1\n```");
    expect(applyMarkdownFormat("", 0, 0, "table").value).toContain("| --- | --- |");
  });
});

describe("cursorPosition and countWords", () => {
  it("reports the 1-based line and column of an offset", () => {
    expect(cursorPosition("ab\ncde", 0)).toEqual({ line: 1, column: 1 });
    expect(cursorPosition("ab\ncde", 5)).toEqual({ line: 2, column: 3 });
  });

  it("counts words ignoring markdown punctuation", () => {
    expect(countWords("# Hello **big** world\n- [ ] task")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});
