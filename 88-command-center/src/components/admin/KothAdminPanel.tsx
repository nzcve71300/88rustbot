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

  const [channelId, setChannelId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [gates, setGates] = useState("10");
  const [freq, setFreq] = useState("4444");

  const [waves, setWaves] = useState("5");
  const [dur, setDur] = useState("15");
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
      const g = Number.parseInt(gates, 10);
      const f = Number.parseInt(freq, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/koth/setup`, {
        method: "POST",
        body: JSON.stringify({
          announcementChannelId: channelId,
          gates: g,
          gateFrequency: f,
          announcementRoleId: roleId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Setup failed");
      toast.success("KOTH configured — message posted.");
      void refetchEvents();
      void qc.invalidateQueries({ queryKey: ["admin-koth-events", sid] });
    });

  const doEnd = () =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/koth/end`, { method: "POST", body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "End failed");
      toast.success("KOTH ended.");
      setSelectedEvent(null);
      void refetchEvents();
    });

  const doStart = () =>
    busy(async () => {
      const w = Number.parseInt(waves, 10);
      const d = Number.parseInt(dur, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/koth/start`, {
        method: "POST",
        body: JSON.stringify({ waves: w, durationMinutes: d, kitName: kit.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Start failed");
      toast.success("KOTH match started.");
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
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">KOTH System</h2>
        <p className="text-sm text-muted-foreground mt-1">Setup, start, and end King of the Hill for this Rust server.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Active events</CardTitle>
          <CardDescription>Select a KOTH event row, then end it (stops waves and clears config).</CardDescription>
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
                End KOTH / delete active
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
          <CardDescription>Posts the lobby embed and saves config (gates 1–20, frequency 1000–9999).</CardDescription>
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
          <div className="sm:col-span-2">
            <Button onClick={() => void doSetup()}>Save &amp; post setup</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Start KOTH match</CardTitle>
          <CardDescription>Requires setup + lobby + at least one `/koth-join` + Gate 1 position saved.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Waves (1–50)</Label>
            <Input value={waves} onChange={(e) => setWaves(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-2">
            <Label>Minutes per wave (1–120)</Label>
            <Input value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label>Kit name</Label>
            <Input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="Exact kit on Rust server" />
          </div>
          <div className="sm:col-span-3">
            <Button onClick={() => void doStart()}>Start KOTH</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
