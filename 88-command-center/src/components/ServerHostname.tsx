import type { HostnameSegment } from "@/lib/servers";
import { cn } from "@/lib/utils";

export type ServerHostnameProps = {
  segments: HostnameSegment[];
  hostnamePlain: string;
  nickname: string;
  /** Single-line overflow with ellipsis (use on lists and headers). */
  truncate?: boolean;
  className?: string;
};

/**
 * Renders Rust `server.hostname` with per-segment colors when available, otherwise plain text.
 * Use `truncate` anywhere the name must stay on one line (cards, nav, narrow layouts).
 */
export function ServerHostname({
  segments,
  hostnamePlain,
  nickname,
  truncate = false,
  className,
}: ServerHostnameProps) {
  const body =
    segments.length > 0 ? (
      <>
        {segments.map((seg, i) => (
          <span key={i} style={{ color: seg.color ?? undefined }}>
            {seg.text}
          </span>
        ))}
      </>
    ) : (
      <>{hostnamePlain || nickname}</>
    );

  return (
    <span
      className={cn(
        truncate && "block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
        className
      )}
    >
      {body}
    </span>
  );
}
