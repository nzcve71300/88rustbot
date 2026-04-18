import type { HostnameSegment } from "@/lib/servers";
import { cn } from "@/lib/utils";

export type ServerHostnameProps = {
  segments: HostnameSegment[];
  hostnamePlain: string;
  nickname: string;
  /** Optional typography wrapper (e.g. detail header). */
  className?: string;
};

/**
 * Renders Rust `server.hostname` with per-segment colors when available, otherwise plain text.
 */
export function ServerHostname({
  segments,
  hostnamePlain,
  nickname,
  className,
}: ServerHostnameProps) {
  const plain = hostnamePlain || nickname;

  if (segments.length > 0) {
    const spans = segments.map((seg, i) => {
      const c = seg.color;
      return (
        <span
          key={i}
          style={
            c
              ? {
                  color: c,
                  WebkitTextFillColor: c,
                }
              : undefined
          }
        >
          {seg.text}
        </span>
      );
    });

    // Single inline wrapper: parent supplies `truncate`. Avoid `h3`/`button` around this tree
    // so mobile WebKit doesn’t flatten to one text color. `forcedColorAdjust` helps link rows + a11y modes.
    return (
      <span
        className={cn("inline min-w-0 align-baseline", className)}
        style={{ forcedColorAdjust: "none" }}
      >
        {spans}
      </span>
    );
  }

  return <span className={cn("text-foreground", className)}>{plain}</span>;
}
