"use client";

import type { ClipboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { File as FileIcon, X } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import {
  ContentEditor,
  type ContentEditorRef,
  type MentionItem,
  useFileDropZone,
  FileDropOverlay,
} from "../../editor";
import { FileUploadButton } from "@multica/ui/components/common/file-upload-button";
import { SubmitButton } from "@multica/ui/components/common/submit-button";
import { useChatStore, DRAFT_NEW_SESSION } from "@multica/core/chat";
import { createLogger } from "@multica/core/logger";
import { enterKey, formatShortcut, modKey } from "@multica/core/platform";
import type { UploadResult } from "@multica/core/hooks/use-file-upload";
import { useT } from "../../i18n";

const logger = createLogger("chat.ui");

export interface ChatInputAdornmentHelpers {
  insertMention: (item: MentionItem) => void;
}

interface ChatInputProps {
  onSend: (content: string, attachmentIds?: string[]) => void;
  /** Receives a File and returns the attachment row (with id + CDN link).
   *  The wrapper owner (ChatWindow) lazy-creates a chat_session if needed
   *  and forwards `chatSessionId` to the upload — chat-input only cares
   *  about the upload result so it can map URL → id for back-fill on send.
   *  When unset, paste/drag/button still type into the editor but no upload
   *  fires (the editor's file-upload extension is a no-op without a handler). */
  onUploadFile?: (file: File) => Promise<UploadResult | null>;
  onStop?: () => void;
  isRunning?: boolean;
  disabled?: boolean;
  /** True when the user has no agent available — disables the editor and
   *  surfaces a distinct placeholder. Kept separate from `disabled` so
   *  archived-session copy stays untouched. */
  noAgent?: boolean;
  /** Name of the currently selected agent, used in the placeholder. */
  agentName?: string;
  /** Rendered at the bottom-left of the input bar — typically the agent picker. */
  leftAdornment?: ReactNode;
  /** Rendered at the bottom-left with access to editor commands. */
  renderLeftAdornment?: (helpers: ChatInputAdornmentHelpers) => ReactNode;
  /** Rendered just before the submit button — used for context-anchor action. */
  rightAdornment?: ReactNode;
  /** Rendered above the input card with access to editor commands. */
  renderAccessoryTray?: (helpers: ChatInputAdornmentHelpers) => ReactNode;
  /** Rendered inside the rounded container, above the editor — attached
   *  context cards, drafts, etc. */
  topSlot?: ReactNode;
  /** Optional scoped mention list for @ completion. */
  mentionItems?: MentionItem[];
  /** Optional project scope for @ issue search inside the chat composer. */
  mentionIssueProjectId?: string | null;
}

export function ChatInput({
  onSend,
  onUploadFile,
  onStop,
  isRunning,
  disabled,
  noAgent,
  agentName,
  leftAdornment,
  renderLeftAdornment,
  rightAdornment,
  renderAccessoryTray,
  topSlot,
  mentionItems,
  mentionIssueProjectId,
}: ChatInputProps) {
  const { t } = useT("chat");
  const editorRef = useRef<ContentEditorRef>(null);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  // Two keys with deliberately different concerns:
  //
  // `draftKey` — zustand storage key. Scopes the in-progress draft per
  // session so different sessions don't bleed text into each other; for
  // brand-new chats it falls back to a per-agent slot so switching agents
  // mid-compose gives each agent its own draft. This is a STORAGE key, not
  // a React identity.
  //
  // `editorKey` — React `key` on the ContentEditor. Used ONLY to force a
  // remount when the user explicitly switches agent (so Tiptap's
  // Placeholder, which only reads on mount, refreshes to "Tell {agent}…").
  // Crucially this does NOT include `activeSessionId`: when the user
  // uploads a file in a brand-new chat, `handleUploadFile` first awaits
  // `ensureSession` which lazily creates the session and flips
  // `activeSessionId` from null → uuid mid-upload. If the editor key
  // depended on session id, that flip would unmount the editor right as
  // the blob preview was inserted, dropping the in-progress upload's
  // image node before file-upload.ts could swap it for the CDN URL — the
  // user would see the image flash on then disappear. Keeping editor
  // identity stable across the lazy-create event is what makes
  // first-upload-creates-session work the same as second-upload.
  const draftKey =
    activeSessionId ?? `${DRAFT_NEW_SESSION}:${selectedAgentId ?? ""}`;
  const editorKey = selectedAgentId ?? "no-agent";
  // Select a primitive — empty-string fallback keeps referential stability.
  const inputDraft = useChatStore((s) => s.inputDrafts[draftKey] ?? "");
  const setInputDraft = useChatStore((s) => s.setInputDraft);
  const clearInputDraft = useChatStore((s) => s.clearInputDraft);
  const [isEmpty, setIsEmpty] = useState(!inputDraft.trim());
  // Number of in-flight uploads. We track this explicitly (rather than
  // peeking at the editor on every render) so the SubmitButton visibly
  // disables the instant an upload starts and re-enables the instant it
  // finishes. handleSend ALSO checks `hasActiveUploads()` for paths that
  // bypass the button (Mod+Enter while paste is mid-stream, drag-drop
  // racing the keyboard) — defense in depth.
  const [pendingUploads, setPendingUploads] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<UploadResult[]>([]);

  useEffect(() => {
    if (!activeSessionId) return;
    setPendingAttachments((current) =>
      current.filter(
        (attachment) =>
          !attachment.chat_session_id ||
          attachment.chat_session_id === activeSessionId,
      ),
    );
  }, [activeSessionId]);

  const uploadFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (!onUploadFile) return;
      if (files.length === 0) return;
      setPendingUploads((n) => n + files.length);
      try {
        const results = await Promise.all(files.map((file) => onUploadFile(file)));
        const attachments = results.filter(Boolean) as UploadResult[];
        if (attachments.length > 0) {
          setPendingAttachments((current) => [...current, ...attachments]);
        }
      } finally {
        setPendingUploads((n) => Math.max(0, n - files.length));
      }
    },
    [onUploadFile],
  );

  // Drop zone wraps the rounded card so a drop anywhere on the input
  // surface routes the file into the attachment tray.
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => void uploadFiles(files),
  });

  const handlePasteCapture = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(event.clipboardData.files ?? []);
      if (files.length === 0 || disabled || noAgent || !onUploadFile) return;
      event.preventDefault();
      void uploadFiles(files);
    },
    [disabled, noAgent, onUploadFile, uploadFiles],
  );

  const removePendingAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }, []);

  const handleSend = () => {
    const editorContent = editorRef.current?.getMarkdown()?.replace(/(\n\s*)+$/, "").trim() ?? "";
    const attachmentMarkdown = pendingAttachments
      .map(formatChatAttachmentMarkdown)
      .filter(Boolean)
      .join("\n");
    const content = [editorContent, attachmentMarkdown].filter(Boolean).join("\n\n").trim();
    if (!content || isRunning || disabled || noAgent) {
      logger.debug("input.send skipped", {
        emptyContent: !content,
        isRunning,
        disabled,
        noAgent,
      });
      return;
    }
    // Block the send while any file is still uploading. If we let it
    // through the attachment id is not yet in uploadMapRef (the upload
    // resolves later) and the attachment would only end up bound to the
    // session, not the message — the agent then can't `multica attachment
    // download <id>` the file. The SubmitButton is also disabled in this
    // state via `uploading`, but Mod+Enter bypasses the button so we
    // still gate here.
    if (editorRef.current?.hasActiveUploads()) {
      logger.debug("input.send skipped: uploads in flight");
      return;
    }
    if (pendingUploads > 0) {
      logger.debug("input.send skipped: tray uploads in flight");
      return;
    }
    const activeIds = pendingAttachments.map((attachment) => attachment.id);
    // Capture draft key BEFORE onSend — creating a new session mutates
    // activeSessionId synchronously, so reading it after onSend would point
    // at the new session and leave the old draft orphaned.
    const keyAtSend = draftKey;
    logger.info("input.send", {
      contentLength: content.length,
      draftKey: keyAtSend,
      attachmentCount: activeIds.length,
    });
    onSend(content, activeIds.length > 0 ? activeIds : undefined);
    editorRef.current?.clearContent();
    // Drop focus so the caret doesn't keep blinking under the StatusPill /
    // streaming reply that's about to take over the user's attention. The
    // input is also `disabled` once isRunning flips, and a focused-but-
    // disabled editor reads as a stale cursor. We deliberately don't auto-
    // refocus on completion — that would interrupt the user if they're
    // selecting text from the assistant reply; one click to refocus is
    // a fair price for not stealing focus mid-action.
    editorRef.current?.blur();
    clearInputDraft(keyAtSend);
    setPendingAttachments([]);
    setIsEmpty(true);
  };

  const placeholder = noAgent
    ? t(($) => $.input.placeholder_no_agent)
    : disabled
      ? t(($) => $.input.placeholder_archived)
      : agentName
        ? t(($) => $.input.placeholder_named, { name: agentName })
        : t(($) => $.input.placeholder_default);

  const uploadEnabled = !!onUploadFile && !disabled && !noAgent;
  const insertMention = useCallback(
    (item: MentionItem) => {
      if (disabled || noAgent) return;
      editorRef.current?.insertMention(item);
    },
    [disabled, noAgent],
  );
  const renderedLeftAdornment = renderLeftAdornment
    ? renderLeftAdornment({ insertMention })
    : leftAdornment;
  const renderedAccessoryTray = renderAccessoryTray
    ? renderAccessoryTray({ insertMention })
    : null;

  return (
    <div
      className={cn(
        "px-5 pb-3 pt-0",
        // Outer wrapper carries the disabled cursor. Inner card sets
        // pointer-events-none, which suppresses hover (and therefore
        // any cursor of its own) — splitting the two layers lets hover
        // bubble back here so the browser actually reads cursor.
        noAgent && "cursor-not-allowed",
      )}
    >
      {renderedAccessoryTray}
      <div
        {...(uploadEnabled ? dropZoneProps : {})}
        onPasteCapture={handlePasteCapture}
        className={cn(
          "relative mx-auto flex min-h-24 max-h-40 w-full max-w-4xl flex-col rounded-lg bg-card pb-9 border-1 border-border transition-colors focus-within:border-brand",
          // Visual + interaction lock when there's no agent. We don't
          // toggle ContentEditor's editable mode (Tiptap can't switch
          // cleanly post-mount, and the prop has been removed); instead
          // we drop pointer events at the wrapper level so clicks miss
          // the editor entirely, and dim the surface so it reads as
          // "disabled" rather than "broken".
          noAgent && "pointer-events-none opacity-60",
        )}
        aria-disabled={noAgent || undefined}
      >
        {topSlot}
        <ChatAttachmentTray
          attachments={pendingAttachments}
          pendingUploads={pendingUploads}
          onRemove={removePendingAttachment}
          uploadingLabel={t(($) => $.input.attachment_uploading)}
          removeLabel={(filename) =>
            t(($) => $.input.remove_attachment, { filename })
          }
        />
        <div className="flex-1 min-h-14 overflow-y-auto px-3 py-2">
          <ContentEditor
            // See the editorKey / draftKey split note above — editorKey
            // intentionally does not depend on activeSessionId.
            key={editorKey}
            ref={editorRef}
            defaultValue={inputDraft}
            placeholder={placeholder}
            onUpdate={(md) => {
              setIsEmpty(!md.trim());
              setInputDraft(draftKey, md);
            }}
            onSubmit={handleSend}
            mentionItems={mentionItems}
            mentionIssueProjectId={mentionIssueProjectId ?? null}
            debounceMs={100}
            // Chat is short-form — the floating formatting toolbar is
            // more distraction than feature here.
            showBubbleMenu={false}
            // Match channels: Enter sends, Shift+Enter inserts a soft break.
            // The submit extension still lets IME composition and code-block
            // newlines pass through instead of turning them into sends.
            submitOnEnter
          />
        </div>
        {renderedLeftAdornment && (
          <div className="absolute bottom-1.5 left-2 right-24 flex min-w-0 items-center gap-1 overflow-hidden">
            {renderedLeftAdornment}
          </div>
        )}
        <div className="absolute bottom-1 right-1.5 flex items-center gap-1">
          {rightAdornment}
          {uploadEnabled && (
            <FileUploadButton
              size="sm"
              onSelect={(file) => void uploadFiles([file])}
              onSelectFiles={(files) => void uploadFiles(files)}
              multiple
            />
          )}
          <SubmitButton
            onClick={handleSend}
            disabled={
              (isEmpty && pendingAttachments.length === 0) ||
              !!disabled ||
              !!noAgent ||
              pendingUploads > 0
            }
            running={isRunning}
            onStop={onStop}
            tooltip={`${t(($) => $.input.send_tooltip)} · ${formatShortcut(modKey, enterKey)}`}
            stopTooltip={t(($) => $.input.stop_tooltip)}
          />
        </div>
        {uploadEnabled && isDragOver && <FileDropOverlay />}
      </div>
    </div>
  );
}

function ChatAttachmentTray({
  attachments,
  pendingUploads,
  onRemove,
  uploadingLabel,
  removeLabel,
}: {
  attachments: UploadResult[];
  pendingUploads: number;
  onRemove: (attachmentId: string) => void;
  uploadingLabel: string;
  removeLabel: (filename: string) => string;
}) {
  if (attachments.length === 0 && pendingUploads === 0) return null;

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto px-3 pt-2">
      {attachments.map((attachment) => {
        const isImage = attachment.content_type.startsWith("image/");
        return (
          <div
            key={attachment.id}
            className="group relative flex size-14 shrink-0 overflow-hidden rounded-lg border bg-muted"
          >
            {isImage ? (
              <img
                src={attachment.url}
                alt={attachment.filename}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 px-1.5 text-center">
                <FileIcon className="size-4 text-muted-foreground" />
                <span className="w-full truncate text-[10px] text-muted-foreground">
                  {attachment.filename}
                </span>
              </div>
            )}
            <button
              type="button"
              aria-label={removeLabel(attachment.filename)}
              onClick={() => onRemove(attachment.id)}
              className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
            >
              <X className="size-2.5" />
            </button>
          </div>
        );
      })}
      {Array.from({ length: pendingUploads }).map((_, index) => (
        <div
          key={`uploading-${index}`}
          className="flex size-14 shrink-0 animate-pulse items-center justify-center rounded-lg border bg-muted text-[10px] text-muted-foreground"
        >
          {uploadingLabel}
        </div>
      ))}
    </div>
  );
}

function formatChatAttachmentMarkdown(attachment: UploadResult) {
  const filename = escapeMarkdownLabel(attachment.filename || "file");
  const url = escapeMarkdownUrl(attachment.url);
  if (!url) return "";
  if (attachment.content_type.startsWith("image/")) {
    return `![${filename}](${url})`;
  }
  return `!file[${filename}](${url})`;
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeMarkdownUrl(value: string) {
  return value.replace(/\s/g, "%20").replace(/\)/g, "%29");
}
