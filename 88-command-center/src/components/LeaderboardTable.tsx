import type { LeaderboardEntry } from "@/data/mockData";

const rankStyles: Record<number, string> = {
  1: "text-gold font-bold",
  2: "text-silver font-semibold",
  3: "text-bronze font-semibold",
};

const LeaderboardTable = ({ entries }: { entries: LeaderboardEntry[] }) => (
  <div className="space-y-1">
    {entries.map((entry) => (
      <div
        key={entry.rank}
        className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
          entry.rank % 2 === 0 ? "bg-muted/30" : ""
        } ${entry.rank <= 3 ? "bg-primary/5" : ""}`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`w-6 text-center font-rajdhani text-base ${
              rankStyles[entry.rank] || "text-muted-foreground"
            }`}
          >
            #{entry.rank}
          </span>
          <span className={entry.rank <= 3 ? "text-foreground font-medium" : "text-muted-foreground"}>
            {entry.playerName}
          </span>
        </div>
        <span className={`font-mono text-sm ${rankStyles[entry.rank] || "text-muted-foreground"}`}>
          {entry.kills}
        </span>
      </div>
    ))}
  </div>
);

export default LeaderboardTable;
