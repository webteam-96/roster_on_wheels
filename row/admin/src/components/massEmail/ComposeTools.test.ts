import { describe, expect, it } from "vitest";
import { attachmentProblem, MAX_FILE_BYTES } from "./ComposeTools";

describe("attachmentProblem", () => {
  it("accepts a safe file", () => {
    expect(attachmentProblem({ name: "Agenda.PDF", size: 1000 }, [])).toBeNull();
  });
  it("refuses unsafe types and files without an extension", () => {
    expect(attachmentProblem({ name: "setup.exe", size: 10 }, [])).toMatch(/cannot be attached/);
    expect(attachmentProblem({ name: "README", size: 10 }, [])).toMatch(/cannot be attached/);
  });
  it("enforces size, count and total limits", () => {
    expect(attachmentProblem({ name: "a.pdf", size: 0 }, [])).toMatch(/empty/);
    expect(attachmentProblem({ name: "a.pdf", size: MAX_FILE_BYTES + 1 }, [])).toMatch(/5 MB/);
    expect(attachmentProblem({ name: "a.pdf", size: 1 }, Array(5).fill({ size: 1 }))).toMatch(/5 files/);
    expect(attachmentProblem({ name: "a.pdf", size: 4 * 1024 * 1024 }, [{ size: 4 * 1024 * 1024 }, { size: 3 * 1024 * 1024 }])).toMatch(/10 MB/);
  });
});
