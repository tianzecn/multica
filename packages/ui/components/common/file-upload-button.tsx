"use client";

import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@multica/ui/lib/utils";

interface FileUploadButtonProps {
  /** Called with the selected File — caller handles upload. */
  onSelect: (file: File) => void;
  /** Called with every selected file when multi-select is enabled. */
  onSelectFiles?: (files: File[]) => void;
  /** Allows Shift/Command multi-select in the native file picker. */
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}

function FileUploadButton({
  onSelect,
  onSelectFiles,
  multiple = false,
  disabled,
  className,
  size = "default",
}: FileUploadButtonProps) {
  const { t } = useTranslation("ui");
  const inputRef = useRef<HTMLInputElement>(null);
  const attachLabel = t(($) => $.attach_file);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    if (multiple && onSelectFiles) {
      onSelectFiles(files);
      return;
    }
    files.forEach(onSelect);
  };

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const btnSize = size === "sm" ? "h-6 w-6" : "h-7 w-7";

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label={attachLabel}
        title={attachLabel}
        className={cn(
          "inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none",
          btnSize,
          className,
        )}
      >
        <Paperclip className={iconSize} />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
}

export { FileUploadButton, type FileUploadButtonProps };
