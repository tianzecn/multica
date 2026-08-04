"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { EditorProps } from "@monaco-editor/react";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import { Textarea } from "@multica/ui/components/ui/textarea";
import "@xterm/xterm/css/xterm.css";

type MonacoEditorComponent = ComponentType<EditorProps>;

export function ProjectCodeEditor({
  value,
  path,
  disabled,
  onChange,
}: {
  value: string;
  path: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const Editor = useMonacoEditor();
  const language = useMemo(() => projectLanguageFromPath(path), [path]);

  if (!Editor) {
    return (
      <Textarea
        className="min-h-44 resize-y font-mono text-micro leading-4"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <Editor
        height="18rem"
        path={path || "project-file"}
        language={language}
        value={value}
        theme="vs-dark"
        onChange={(next) => onChange(next ?? "")}
        options={{
          automaticLayout: true,
          fontSize: 12,
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          readOnly: !!disabled,
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  );
}

export function ProjectDiffViewer({
  patch,
  emptyText,
}: {
  patch: string;
  emptyText: string;
}) {
  const Editor = useMonacoEditor();
  const value = patch || emptyText;

  if (!Editor) {
    return (
      <pre className="max-h-52 overflow-auto rounded bg-background/80 p-2 text-micro leading-4 text-muted-foreground">
        {value}
      </pre>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <Editor
        height="13rem"
        language="diff"
        value={value}
        theme="vs-dark"
        options={{
          automaticLayout: true,
          fontSize: 11,
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          readOnly: true,
          scrollBeyondLastLine: false,
          wordWrap: "off",
        }}
      />
    </div>
  );
}

export function ProjectTerminalLog({ log }: { log: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitRef = useRef<XTermFitAddon | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]).then(([xterm, fit]) => {
      if (disposed) return;
      const terminal = new xterm.Terminal({
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        rows: 10,
        theme: {
          background: "#050505",
          foreground: "#f4f4f5",
          cursor: "#f4f4f5",
          selectionBackground: "#3f3f46",
        },
      });
      const fitAddon = new fit.FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      fitAddon.fit();
      terminalRef.current = terminal;
      fitRef.current = fitAddon;
      setReady(true);
    });

    const onResize = () => fitRef.current?.fit();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.clear();
    terminal.write(normalizeTerminalLog(log || "$ "));
    queueMicrotask(() => fitRef.current?.fit());
  }, [log, ready]);

  return (
    <div className="mt-1">
      {!ready ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/90 p-2 font-mono text-micro leading-4 text-white">
          {log || "$ "}
        </pre>
      ) : null}
      <div
        ref={containerRef}
        className={
          ready
            ? "h-48 overflow-hidden rounded bg-black"
            : "h-0 overflow-hidden"
        }
        aria-label="Project terminal output"
      />
    </div>
  );
}

function useMonacoEditor() {
  const [Editor, setEditor] = useState<MonacoEditorComponent | null>(null);

  useEffect(() => {
    let mounted = true;
    void import("@monaco-editor/react").then((mod) => {
      if (mounted) setEditor(() => mod.Editor);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return Editor;
}

function projectLanguageFromPath(path: string) {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "css":
      return "css";
    case "go":
      return "go";
    case "html":
      return "html";
    case "json":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

function normalizeTerminalLog(raw: string) {
  return raw.replace(/\r?\n/g, "\r\n");
}
