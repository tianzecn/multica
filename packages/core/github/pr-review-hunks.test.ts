import { describe, expect, it } from "vitest";
import {
  makePullRequestReviewHunkId,
  parsePullRequestReviewHunks,
} from "./pr-review-hunks";

describe("parsePullRequestReviewHunks", () => {
  it("splits unified patches into stable hunk selections", () => {
    const hunks = parsePullRequestReviewHunks(
      [
        "@@ -1,3 +1,4 @@",
        " unchanged",
        "+added",
        "@@ -20,2 +21,3 @@ function example()",
        "-old",
        "+new",
      ].join("\n"),
    );

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      id: "0:@@ -1,3 +1,4 @@",
      header: "@@ -1,3 +1,4 @@",
      startLine: 1,
    });
    expect(hunks[1]).toMatchObject({
      id: "1:@@ -20,2 +21,3 @@ function example()",
      header: "@@ -20,2 +21,3 @@ function example()",
      startLine: 21,
    });
    expect(hunks[1]?.patch).toContain("+new");
  });

  it("keeps prelude metadata with the first hunk when present", () => {
    const hunks = parsePullRequestReviewHunks(
      [
        "diff --git a/file.ts b/file.ts",
        "index 111..222 100644",
        "@@ -2 +2 @@",
        "-old",
        "+new",
      ].join("\n"),
    );

    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.patch).toContain("diff --git a/file.ts b/file.ts");
    expect(hunks[0]?.patch).toContain("@@ -2 +2 @@");
  });

  it("falls back to a file patch when no hunk header is available", () => {
    const hunks = parsePullRequestReviewHunks("Binary files differ");

    expect(hunks).toEqual([
      {
        id: "0:file",
        header: "File patch",
        patch: "Binary files differ",
        startLine: null,
      },
    ]);
  });

  it("returns no hunks for empty patches", () => {
    expect(parsePullRequestReviewHunks("")).toEqual([]);
    expect(parsePullRequestReviewHunks("   \n")).toEqual([]);
  });

  it("builds filename-scoped hunk ids", () => {
    const [hunk] = parsePullRequestReviewHunks("@@ -1 +1 @@\n+new");

    expect(hunk).toBeDefined();
    expect(makePullRequestReviewHunkId("src/app.ts", hunk!)).toBe(
      "src/app.ts\u00000:@@ -1 +1 @@",
    );
  });
});
