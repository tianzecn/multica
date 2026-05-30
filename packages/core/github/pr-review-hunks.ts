export interface ProjectPullRequestReviewHunk {
  id: string;
  header: string;
  patch: string;
  startLine: number | null;
}

const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@.*$/;

export function parsePullRequestReviewHunks(patch: string): ProjectPullRequestReviewHunk[] {
  const normalizedPatch = patch.trimEnd();
  if (!normalizedPatch) return [];

  const lines = normalizedPatch.split(/\r?\n/);
  const hunks: ProjectPullRequestReviewHunk[] = [];
  const prelude: string[] = [];
  let currentHeader = "";
  let currentStartLine: number | null = null;
  let currentLines: string[] = [];

  const flushCurrentHunk = () => {
    if (currentLines.length === 0) return;
    const hunkIndex = hunks.length;
    const hunkPatch =
      hunkIndex === 0 && prelude.length > 0
        ? [...prelude, ...currentLines].join("\n")
        : currentLines.join("\n");
    hunks.push({
      id: `${hunkIndex}:${currentHeader}`,
      header: currentHeader,
      patch: hunkPatch,
      startLine: currentStartLine,
    });
    currentHeader = "";
    currentStartLine = null;
    currentLines = [];
  };

  for (const line of lines) {
    const headerMatch = HUNK_HEADER_PATTERN.exec(line);
    if (headerMatch) {
      flushCurrentHunk();
      currentHeader = line;
      currentStartLine = Number.parseInt(headerMatch[1] ?? "", 10);
      currentLines = [line];
      continue;
    }

    if (currentLines.length > 0) {
      currentLines.push(line);
    } else {
      prelude.push(line);
    }
  }

  flushCurrentHunk();

  if (hunks.length > 0) return hunks;

  return [
    {
      id: "0:file",
      header: "File patch",
      patch: normalizedPatch,
      startLine: null,
    },
  ];
}

export function makePullRequestReviewHunkId(
  filename: string,
  hunk: ProjectPullRequestReviewHunk,
): string {
  return `${filename}\u0000${hunk.id}`;
}
