import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ApexOptions } from "apexcharts";
import Chart from "react-apexcharts";
import { adminFetch } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricsPayload = {
  ok?: boolean;
  points?: Array<{
    tMs: number;
    label: string;
    entityCount: number;
    framerate: number;
    memoryMb: number;
    players: number;
  }>;
  latest?: {
    entityCount: number;
    framerate: number;
    memoryMb: number;
    players: number;
  } | null;
  yAxis?: {
    entity: { min: number; max: number };
    framerate: { min: number; max: number };
    memory: { min: number; max: number };
    players: { min: number; max: number };
  };
};

const CHART_COLORS = {
  entity: "#3b82f6",
  framerate: "#a855f7",
  memory: "#22c55e",
  players: "#f97316",
} as const;

function StatPill({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-center min-w-[7rem]",
        className
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      <p className="text-lg font-rajdhani font-bold tabular-nums text-foreground leading-tight">{value}</p>
    </div>
  );
}

function MetricsChartCard({
  title,
  description,
  color,
  labels,
  data,
  yMin,
  yMax,
  fixedScale,
  statLabel,
  statValue,
}: {
  title: string;
  description: string;
  color: string;
  labels: string[];
  data: number[];
  yMin: number;
  yMax: number;
  fixedScale?: boolean;
  statLabel: string;
  statValue: string;
}) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "area",
        toolbar: { show: false },
        zoom: { enabled: false },
        background: "transparent",
        fontFamily: "inherit",
        animations: { enabled: true },
      },
      colors: [color],
      stroke: { width: 2, curve: "smooth" },
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.35,
          opacityTo: 0.03,
          stops: [0, 90, 100],
        },
      },
      dataLabels: { enabled: false },
      markers: {
        size: 0,
        hover: { size: 4 },
      },
      xaxis: {
        categories: labels,
        labels: {
          rotate: labels.length > 8 ? -45 : 0,
          rotateAlways: labels.length > 8,
          style: { colors: "hsl(var(--muted-foreground))", fontSize: "11px" },
          maxHeight: 52,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        min: yMin,
        max: yMax,
        ...(fixedScale
          ? { tickAmount: 6, forceNiceScale: false }
          : { tickAmount: 5, forceNiceScale: true }),
        labels: {
          style: { colors: "hsl(var(--muted-foreground))", fontSize: "11px" },
          formatter: (v: number) =>
            fixedScale ? String(Math.round(v)) : Number.isInteger(v) ? String(v) : v.toFixed(1),
        },
      },
      grid: {
        borderColor: "hsl(var(--border) / 0.6)",
        strokeDashArray: 4,
        padding: { left: 4, right: 8 },
      },
      tooltip: {
        theme: "dark",
        x: { show: true },
      },
      theme: { mode: "dark" },
      legend: { show: false },
    }),
    [labels, yMin, yMax, color, fixedScale]
  );

  const series = useMemo(() => [{ name: title, data }], [title, data]);

  const empty = data.length === 0;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-rajdhani text-lg flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              {title}
            </CardTitle>
            <CardDescription className="text-xs mt-1">{description}</CardDescription>
          </div>
          <StatPill label={statLabel} value={statValue} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        {empty ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            <p className="text-center px-4">Waiting for samples…</p>
            <p className="text-xs mt-2 text-center px-4 max-w-sm">
              The bot polls <span className="font-mono">serverinfo</span> every 30s. Each chart keeps at most{" "}
              <strong>16</strong> timestamps — older points are removed as new ones arrive.
            </p>
          </div>
        ) : (
          <div className="min-h-[220px] -mx-1">
            <Chart options={options} series={series} type="area" height={240} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ServerMetricsPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-server-metrics", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/metrics`);
      const j = (await res.json()) as MetricsPayload;
      if (!res.ok || !j.ok) throw new Error("Failed to load metrics");
      return j;
    },
    enabled: Number.isFinite(sid) && sid > 0,
    refetchInterval: 30_000,
    retry: 1,
  });

  const payload = data;
  const points = payload?.points ?? [];
  const latest = payload?.latest ?? null;
  const ya = payload?.yAxis;

  const labels = points.map((p) => p.label);
  const entities = points.map((p) => p.entityCount);
  const fps = points.map((p) => p.framerate);
  const mem = points.map((p) => p.memoryMb);
  const pl = points.map((p) => p.players);

  const fmt = (n: number | undefined | null, suffix = "") =>
    n == null || Number.isNaN(n) ? "—" : `${Math.round(n * 100) / 100}${suffix}`;

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  return (
    <div className="max-w-6xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">Server Metrics</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Last <strong>16</strong> samples from RCON <span className="font-mono">serverinfo</span> (polled every 30s). Older
          timestamps are dropped automatically. Low / high scales adapt to your data; player count uses 0–100.
        </p>
      </div>

      {isLoading && !payload ? (
        <p className="text-sm text-muted-foreground">Loading metrics…</p>
      ) : null}

      {isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load metrics."}
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <MetricsChartCard
          title="Entity count"
          description="From serverinfo EntityCount — vertical scale adapts to lows and highs in this window."
          color={CHART_COLORS.entity}
          labels={labels}
          data={entities}
          yMin={ya?.entity.min ?? 0}
          yMax={ya?.entity.max ?? 1}
          statLabel="Entities"
          statValue={fmt(latest?.entityCount)}
        />
        <MetricsChartCard
          title="Frame rate"
          description="From serverinfo Framerate — scale adapts as FPS moves."
          color={CHART_COLORS.framerate}
          labels={labels}
          data={fps}
          yMin={ya?.framerate.min ?? 0}
          yMax={ya?.framerate.max ?? 1}
          statLabel="FPS"
          statValue={fmt(latest?.framerate)}
        />
        <MetricsChartCard
          title="Memory"
          description="From serverinfo Memory (MB) — scale adapts to observed range."
          color={CHART_COLORS.memory}
          labels={labels}
          data={mem}
          yMin={ya?.memory.min ?? 0}
          yMax={ya?.memory.max ?? 1}
          statLabel="MB"
          statValue={fmt(latest?.memoryMb)}
        />
        <MetricsChartCard
          title="Player count"
          description="From serverinfo Players — axis fixed 0–100 in steps of 20."
          color={CHART_COLORS.players}
          labels={labels}
          data={pl}
          yMin={0}
          yMax={100}
          fixedScale
          statLabel="Players"
          statValue={fmt(latest?.players)}
        />
      </div>
    </div>
  );
}
