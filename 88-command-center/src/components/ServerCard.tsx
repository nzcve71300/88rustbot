import { useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import type { RealServer } from "@/lib/servers";

interface ServerCardProps {
  server: RealServer;
  index: number;
}

const ServerCard = ({ server, index }: ServerCardProps) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/servers/${server.slug}`)}
      className="group relative w-full rounded-lg border-l-4 border-l-primary border border-border bg-card px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:glow-yellow-hover animate-fade-up flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6 sm:px-6"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex w-full min-w-0 items-start justify-between gap-3 sm:w-auto sm:flex-1 sm:items-center">
        {/* Name */}
        <h3 className="min-w-0 flex-1 truncate text-lg font-rajdhani font-bold text-foreground transition-colors group-hover:text-primary sm:min-w-[140px] sm:shrink-0 sm:flex-none">
          {server.hostnamePlain || server.nickname}
        </h3>

        {/* Pop + Status (mobile) */}
        <div className="flex items-center gap-3 shrink-0 sm:hidden">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">
              <span className="text-foreground font-semibold">{server.players ?? "—"}</span>/{server.maxPlayers ?? "—"}
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${server.ok ? "bg-connected" : "bg-disconnected"}`} />
            <span className="text-muted-foreground">{server.ok ? "Online" : "Offline"}</span>
          </span>
        </div>
      </div>

      {/* Tags */}
      <div className="flex w-full flex-wrap gap-1.5 sm:flex-1">
        <span className="rounded-sm bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {server.nickname}
        </span>
        {server.map ? (
          <span className="rounded-sm bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {server.map}
          </span>
        ) : null}
      </div>

      {/* Pop (desktop) */}
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
        <Users className="h-3.5 w-3.5" />
        <span>
          <span className="text-foreground font-semibold">{server.players ?? "—"}</span>
          /{server.maxPlayers ?? "—"}
        </span>
      </div>

      {/* Status (desktop) */}
      <span className="hidden sm:flex items-center gap-1.5 text-xs shrink-0">
        <span className={`h-2 w-2 rounded-full ${server.ok ? "bg-connected" : "bg-disconnected"}`} />
        <span className="text-muted-foreground">{server.ok ? "Online" : "Offline"}</span>
      </span>
    </button>
  );
};

export default ServerCard;
