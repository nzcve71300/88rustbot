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

export function NuketownAdminPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);
  const qc = useQueryClient();

  const { data: meta } = useQuery({
    queryKey: ["admin-meta", sid],
    queryFn: () => fetchAdminServerMeta(sid),
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const { data: events, refetch: refetchEvents } = useQuery({
    queryKey: ["admin-nuketown-events", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/nuketown/events`);
      const j = (await res.json()) as { ok?: boolean; events?: Array<{ id: number; status: string }> };
      return j.events ?? [];
    },
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const [channelId, setChannelId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [gates, setGates] = useState("8");
  const [freq, setFreq] = useState("4444");
  const [teamLimit, setTeamLimit] = useState("4");
  const [kit, setKit] = useState("");
  const [howOftenHours, setHowOftenHours] = useState("24");
  const [mode, setMode] = useState<"nuketown" | "tournament">("nuketown");
  const [automationNuketown, setAutomationNuketown] = useState(false);
  const [automationTournament, setAutomationTournament] = useState(false);

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
      const g = Number.parseInt(gates, 10);
      const f = Number.parseInt(freq, 10);
      const tl = Number.parseInt(teamLimit, 10);
      const hoh = Number.parseInt(howOftenHours, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/nuketown/setup`, {
        method: "POST",
        body: JSON.stringify({
          mode,
          announcementChannelId: channelId,
          announcementRoleId: roleId,
          gates: g,
          gateFrequency: f,
          teamLimit: tl,
          kitName: kit.trim(),
          howOftenHours: Number.isFinite(hoh) ? hoh : 0,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Setup failed");
      toast.success("Nuketown lobby posted — bracket watch started.");
      void refetchEvents();
      void qc.invalidateQueries({ queryKey: ["admin-nuketown-events", sid] });
    });

  const doToggleAutomation = (which: "nuketown" | "tournament", enabled: boolean) =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/nuketown/automation`, {
        method: "PUT",
        body: JSON.stringify({ enabled, mode: which }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Automation toggle failed");
      if (which === "nuketown") setAutomationNuketown(enabled);
      else setAutomationTournament(enabled);
      toast.success(enabled ? "Automation enabled" : "Automation disabled");
    });

  const doDelete = () =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/nuketown/delete`, { method: "POST", body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Delete failed");
      toast.success("Nuketown event removed.");
      setSelectedEvent(null);
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
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">NUKETOWN System</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Opens a timed lobby, then runs the bracket. Save Nuketown gate coordinates under Manage Positions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Active Nuketown</CardTitle>
          <CardDescription>Force-remove lobby or running event (same idea as /nuketown-delete).</CardDescription>
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
              <Button variant="destructive" onClick={() => void doDelete()}>
                Remove Nuketown event
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No active Nuketown lobby or match.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Setup Nuketown</CardTitle>
          <CardDescription>
            Choose mode, post lobby, and (optionally) enable automation. Tournament requires exactly 4 gates.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v === "tournament" ? "tournament" : "nuketown")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nuketown">Nuketown</SelectItem>
                <SelectItem value="tournament">Nuketown Tournament</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
            <Label>Gates (2–20)</Label>
            <Select value={gates} onValueChange={setGates}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-52">
                {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Gate frequency (4 digits)</Label>
            <Input
              inputMode="numeric"
              maxLength={4}
              placeholder="1000–9999"
              value={freq}
              onChange={(e) => setFreq(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <div className="space-y-2">
            <Label>Team limit (1–5)</Label>
            <Select value={teamLimit} onValueChange={setTeamLimit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Kit name</Label>
            <Input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="Kit given to players" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Automation: how often (hours)</Label>
            <Input
              inputMode="numeric"
              placeholder="0 disables automation scheduling"
              value={howOftenHours}
              onChange={(e) => setHowOftenHours(e.target.value.replace(/\D/g, "").slice(0, 3))}
            />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void doSetup()}>Save &amp; post lobby</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Automation</CardTitle>
          <CardDescription>Toggle automated lobbies for each Nuketown mode.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-rajdhani font-semibold">Nuketown automation</p>
              <p className="text-xs text-muted-foreground">2 clans • Bo3</p>
            </div>
            <Switch checked={automationNuketown} onCheckedChange={(v) => void doToggleAutomation("nuketown", Boolean(v))} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-rajdhani font-semibold">Nuketown Tournament automation</p>
              <p className="text-xs text-muted-foreground">4 clans • 4 gates • Bo3</p>
            </div>
            <Switch checked={automationTournament} onCheckedChange={(v) => void doToggleAutomation("tournament", Boolean(v))} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
