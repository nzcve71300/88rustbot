import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, fetchAdminServerMeta } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export function MazeAdminPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);
  const qc = useQueryClient();

  const { data: meta } = useQuery({
    queryKey: ["admin-meta", sid],
    queryFn: () => fetchAdminServerMeta(sid),
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const { data: events, refetch: refetchEvents } = useQuery({
    queryKey: ["admin-maze-events", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/maze/events`);
      const j = (await res.json()) as { ok?: boolean; events?: Array<{ id: number; status: string }> };
      return j.events ?? [];
    },
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const [channelId, setChannelId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [spawnPts, setSpawnPts] = useState("5");

  const [respawn, setRespawn] = useState("no");
  const [dur, setDur] = useState("30");
  const [kit, setKit] = useState("");

  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  useEffect(() => {
    if (events?.length && selectedEvent === null) setSelectedEvent(events[0].id);
  }, [events, selectedEvent]);

  const busy = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    }
  };

  const doSetup = () =>
    busy(async () => {
      const sp = Number.parseInt(spawnPts, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/maze/setup`, {
        method: "POST",
        body: JSON.stringify({
          announcementChannelId: channelId,
          spawnPoints: sp,
          announcementRoleId: roleId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Setup failed");
      toast.success("Maze configured — lobby posted.");
      void refetchEvents();
      void qc.invalidateQueries({ queryKey: ["admin-maze-events", sid] });
    });

  const doEnd = () =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/maze/end`, { method: "POST", body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "End failed");
      toast.success("Maze ended / cleared.");
      setSelectedEvent(null);
      void refetchEvents();
    });

  const doStart = () =>
    busy(async () => {
      const d = Number.parseInt(dur, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/maze/start`, {
        method: "POST",
        body: JSON.stringify({
          respawn,
          durationMinutes: d,
          kitName: kit.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Start failed");
      toast.success("Maze event started.");
      void refetchEvents();
    });

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  const ch = meta?.channels ?? [];
  const roles = meta?.roles ?? [];

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">MAZE System</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the maze lobby, save spawn coordinates under Manage Positions, then start the run.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Active maze</CardTitle>
          <CardDescription>End clears the active lobby or running maze (same as /maze-delete).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {events && events.length > 0 ? (
            <>
              <div className="space-y-2">
                <Label>Event</Label>
                <Select
                  value={selectedEvent != null ? String(selectedEvent) : ""}
                  onValueChange={(v) => setSelectedEvent(Number.parseInt(v, 10))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select event" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        #{e.id} — {e.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="destructive" onClick={() => void doEnd()}>
                End maze / delete active
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No active maze lobby or match.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Setup maze</CardTitle>
          <CardDescription>Posts the lobby embed and opens join (spawn slots 1–10).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Announcement channel</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a text channel" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {ch.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    #{c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Spawn points (1–10)</Label>
            <Select value={spawnPts} onValueChange={setSpawnPts}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-52">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Announcement role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Role to mention" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void doSetup()}>Save &amp; post setup</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Start maze</CardTitle>
          <CardDescription>
            Requires lobby + /maze-join players + all maze spawn coordinates saved (Manage Positions).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Respawn mode</Label>
            <Select value={respawn} onValueChange={setRespawn}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes — stay in after death</SelectItem>
                <SelectItem value="no">No — one life</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Duration (minutes, 1–180)</Label>
            <Input value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Kit name</Label>
            <Input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="Exact kit on Rust server" />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void doStart()}>Start maze</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
