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
import { Switch } from "@/components/ui/switch";

type MazeConfigPayload = {
  announcementChannelId: string;
  announcementRoleId: string | null;
  spawnPoints: number;
  messageId: string | null;
  howOftenHours: number | null;
  durationMinutes: number | null;
  kitName: string | null;
  respawnEnabled: boolean;
  automationStarted: boolean;
  nextLobbyAtMs: number | null;
  setupComplete: boolean;
};

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

  const { data: mazeConfigRes, refetch: refetchMazeConfig } = useQuery({
    queryKey: ["admin-maze-config", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/maze/config`);
      const j = (await res.json()) as { ok?: boolean; config?: MazeConfigPayload | null };
      return j.config ?? null;
    },
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const [channelId, setChannelId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [spawnPts, setSpawnPts] = useState("5");
  const [howOften, setHowOften] = useState("6");
  const [dur, setDur] = useState("30");
  const [respawn, setRespawn] = useState("no");
  const [kit, setKit] = useState("");

  useEffect(() => {
    const c = mazeConfigRes;
    if (!c) return;
    setChannelId(c.announcementChannelId ?? "");
    setRoleId(c.announcementRoleId ?? "");
    setSpawnPts(String(c.spawnPoints ?? 5));
    setHowOften(String(c.howOftenHours ?? 6));
    setDur(String(c.durationMinutes ?? 30));
    setRespawn(c.respawnEnabled ? "yes" : "no");
    setKit(c.kitName ?? "");
  }, [mazeConfigRes]);

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
      const h = Number.parseFloat(howOften);
      const d = Number.parseInt(dur, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/maze/setup`, {
        method: "POST",
        body: JSON.stringify({
          announcementChannelId: channelId,
          spawnPoints: sp,
          announcementRoleId: roleId,
          howOftenHours: h,
          durationMinutes: d,
          kitName: kit.trim(),
          respawn,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Setup failed");
      toast.success("Maze saved — new lobby message posted.");
      void refetchEvents();
      void refetchMazeConfig();
      void qc.invalidateQueries({ queryKey: ["admin-maze-events", sid] });
      void qc.invalidateQueries({ queryKey: ["admin-maze-config", sid] });
    });

  const doEnd = () =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/maze/end`, { method: "POST", body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "End failed");
      toast.success("Maze ended / cleared.");
      setSelectedEvent(null);
      void refetchEvents();
      void refetchMazeConfig();
    });

  const doStartAutomation = (force: boolean) =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/maze/start`, {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; needsForce?: boolean };
      if (res.status === 409 && j.needsForce) {
        toast.message("Already running — use “Force start” to reset the schedule.");
        return;
      }
      if (!res.ok) throw new Error(j.error ?? "Start failed");
      toast.success(force ? "Schedule reset — next lobby soon." : "Maze automation enabled.");
      void refetchEvents();
      void refetchMazeConfig();
    });

  const doToggleAutomation = (enabled: boolean) =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/maze/automation`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; needsForce?: boolean };
      if (res.status === 409 && j.needsForce) {
        toast.message("Already running — use “Force next lobby now” to reset the schedule.");
        return;
      }
      if (!res.ok) throw new Error(j.error ?? "Update failed");
      toast.success(enabled ? "Automation enabled." : "Automation disabled.");
      void refetchEvents();
      void refetchMazeConfig();
    });

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  const ch = meta?.channels ?? [];
  const roles = meta?.roles ?? [];
  const autoOn = mazeConfigRes?.automationStarted === true;

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">MAZE System</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure announcements and match defaults (duration, kit, respawn), then enable <strong>automation</strong> once.
          Lobbies open on a schedule; players have up to <strong>15 minutes</strong> to join (or all spawn slots can fill to
          start early).
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
          <CardDescription>
            Posts the lobby embed and saves automation fields. Maze spawn world positions are set in{" "}
            <strong>Manage positions</strong> (maze spawn-point 1…10).
          </CardDescription>
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
          <div className="space-y-2">
            <Label>How often (hours)</Label>
            <Input value={howOften} onChange={(e) => setHowOften(e.target.value)} placeholder="e.g. 6" />
          </div>
          <div className="space-y-2">
            <Label>Duration (minutes, 1–180)</Label>
            <Input value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} />
          </div>
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
          <div className="space-y-2 sm:col-span-2">
            <Label>Kit name</Label>
            <Input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="Exact kit on Rust server" />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void doSetup()}>Save &amp; post setup</Button>
            {mazeConfigRes?.setupComplete === false ? (
              <p className="text-xs text-amber-500/90 mt-2">Fill all fields so automation can start.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Automation</CardTitle>
          <CardDescription>
            Run once to begin scheduled lobbies. Use force if automation is already on and you want the next lobby
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Automation</span>
              <span className="text-xs text-muted-foreground">Toggle scheduled lobbies on/off.</span>
            </div>
            <Switch
              checked={autoOn}
              disabled={!mazeConfigRes?.setupComplete}
              onCheckedChange={(v) => void doToggleAutomation(v)}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
          <Button onClick={() => void doStartAutomation(false)} disabled={!mazeConfigRes?.setupComplete}>
            {autoOn ? "Already enabled" : "Enable Maze automation"}
          </Button>
          <Button variant="secondary" onClick={() => void doStartAutomation(true)} disabled={!mazeConfigRes?.setupComplete}>
            Force next lobby now
          </Button>
          {autoOn ? (
            <span className="text-xs text-emerald-400/90 self-center">Automation is ON</span>
          ) : (
            <span className="text-xs text-muted-foreground self-center">Automation is OFF</span>
          )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
