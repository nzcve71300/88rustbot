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

type KothConfigPayload = {
  announcementChannelId: string;
  announcementRoleId: string | null;
  gates: number;
  gateFrequency: number;
  messageId: string | null;
  howOftenHours: number | null;
  waves: number | null;
  durationPerWaveMin: number | null;
  kitName: string | null;
  automationStarted: boolean;
  nextLobbyAtMs: number | null;
  setupComplete: boolean;
};

export function KothAdminPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);
  const qc = useQueryClient();

  const { data: meta } = useQuery({
    queryKey: ["admin-meta", sid],
    queryFn: () => fetchAdminServerMeta(sid),
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const { data: events, refetch: refetchEvents } = useQuery({
    queryKey: ["admin-koth-events", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/koth/events`);
      const j = (await res.json()) as { ok?: boolean; events?: Array<{ id: number; status: string }> };
      return j.events ?? [];
    },
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const { data: kothConfigRes, refetch: refetchKothConfig } = useQuery({
    queryKey: ["admin-koth-config", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/koth/config`);
      const j = (await res.json()) as { ok?: boolean; config?: KothConfigPayload | null };
      return j.config ?? null;
    },
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const [channelId, setChannelId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [gates, setGates] = useState("10");
  const [freq, setFreq] = useState("4444");
  const [howOften, setHowOften] = useState("6");
  const [waves, setWaves] = useState("5");
  const [dur, setDur] = useState("15");
  const [kit, setKit] = useState("");

  useEffect(() => {
    const c = kothConfigRes;
    if (!c) return;
    setChannelId(c.announcementChannelId ?? "");
    setRoleId(c.announcementRoleId ?? "");
    setGates(String(c.gates ?? 10));
    setFreq(String(c.gateFrequency ?? 4444));
    setHowOften(String(c.howOftenHours ?? 6));
    setWaves(String(c.waves ?? 5));
    setDur(String(c.durationPerWaveMin ?? 15));
    setKit(c.kitName ?? "");
  }, [kothConfigRes]);

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
      const h = Number.parseFloat(howOften);
      const w = Number.parseInt(waves, 10);
      const d = Number.parseInt(dur, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/koth/setup`, {
        method: "POST",
        body: JSON.stringify({
          announcementChannelId: channelId,
          gates: g,
          gateFrequency: f,
          announcementRoleId: roleId,
          howOftenHours: h,
          waves: w,
          durationMinutes: d,
          kitName: kit.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Setup failed");
      toast.success("KOTH saved — new lobby message posted.");
      void refetchEvents();
      void refetchKothConfig();
      void qc.invalidateQueries({ queryKey: ["admin-koth-events", sid] });
      void qc.invalidateQueries({ queryKey: ["admin-koth-config", sid] });
    });

  const doEnd = () =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/koth/end`, { method: "POST", body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "End failed");
      toast.success("KOTH ended.");
      setSelectedEvent(null);
      void refetchEvents();
      void refetchKothConfig();
    });

  const doStartAutomation = (force: boolean) =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/koth/start`, {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; needsForce?: boolean };
      if (res.status === 409 && j.needsForce) {
        toast.message("Already running — use “Force start” to reset the schedule.");
        return;
      }
      if (!res.ok) throw new Error(j.error ?? "Start failed");
      toast.success(force ? "Schedule reset — next lobby soon." : "KOTH automation enabled.");
      void refetchEvents();
      void refetchKothConfig();
    });

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  const ch = meta?.channels ?? [];
  const roles = meta?.roles ?? [];
  const autoOn = kothConfigRes?.automationStarted === true;

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">KOTH System</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure announcements and match defaults, then enable <strong>automation</strong> once. Lobbies open on a
          schedule; players have up to <strong>15 minutes</strong> to fill gates (or all gates must fill to start
          early). If fewer than <strong>50%</strong> of gates have clans when time is up, the lobby is cancelled.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Active events</CardTitle>
          <CardDescription>End a running match or open lobby (stops waves; keeps automation config if enabled).</CardDescription>
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
                End KOTH / cancel active
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No active KOTH lobby or match.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Setup KOTH</CardTitle>
          <CardDescription>
            Posts the lobby embed and saves automation fields. Gate world positions are set per gate in{" "}
            <strong>Manage positions</strong> (KOTH Gate 1…n).
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
            <Label>Gates (1–20)</Label>
            <Select value={gates} onValueChange={setGates}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-52">
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
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
            <Label>Waves (1–50)</Label>
            <Input value={waves} onChange={(e) => setWaves(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-2">
            <Label>Minutes per wave (1–120)</Label>
            <Input value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Kit name</Label>
            <Input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="Exact kit on Rust server" />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void doSetup()}>Save &amp; post setup</Button>
            {kothConfigRes?.setupComplete === false ? (
              <p className="text-xs text-amber-500/90 mt-2">Fill all fields so automation can start.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Automation</CardTitle>
          <CardDescription>
            Run once to begin scheduled lobbies (same idea as Docked Cargo start). Use force if you already enabled it
            and want the next lobby immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2 flex-wrap">
          <Button onClick={() => void doStartAutomation(false)} disabled={!kothConfigRes?.setupComplete}>
            {autoOn ? "Already enabled" : "Enable KOTH automation"}
          </Button>
          <Button variant="secondary" onClick={() => void doStartAutomation(true)} disabled={!kothConfigRes?.setupComplete}>
            Force next lobby now
          </Button>
          {autoOn ? (
            <span className="text-xs text-emerald-400/90 self-center">Automation is ON</span>
          ) : (
            <span className="text-xs text-muted-foreground self-center">Automation is OFF</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
