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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type Config = {
  coordinates: string;
  howOftenHours: number | null;
  inGameMessage: string | null;
  sayEnabled: boolean;
  leaveMessage: string | null;
  lockedCrates: number | null;
  timeDockedMinutes: number | null;
  announcementChannelId: string | null;
  automationStarted: boolean;
  setupComplete: boolean;
};

export function DockedCargoAdminPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);
  const qc = useQueryClient();

  const { data: meta } = useQuery({
    queryKey: ["admin-meta", sid],
    queryFn: () => fetchAdminServerMeta(sid),
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const { data: cfgData, refetch } = useQuery({
    queryKey: ["admin-docked-cargo", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/docked-cargo/config`);
      const j = (await res.json()) as { ok?: boolean; config?: Config | null };
      return j.config ?? null;
    },
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const [coordinates, setCoordinates] = useState("");
  const [howOften, setHowOften] = useState("");
  const [sayEnabled, setSayEnabled] = useState(true);
  const [inGame, setInGame] = useState("");
  const [leave, setLeave] = useState("");
  const [crates, setCrates] = useState("3");
  const [dockMin, setDockMin] = useState("30");
  const [channelId, setChannelId] = useState("");
  const [forceOpen, setForceOpen] = useState(false);

  useEffect(() => {
    if (!cfgData) return;
    setCoordinates(cfgData.coordinates ?? "");
    setHowOften(cfgData.howOftenHours != null ? String(cfgData.howOftenHours) : "");
    setSayEnabled(cfgData.sayEnabled);
    setInGame(cfgData.inGameMessage ?? "");
    setLeave(cfgData.leaveMessage ?? "");
    setCrates(cfgData.lockedCrates != null ? String(cfgData.lockedCrates) : "3");
    setDockMin(cfgData.timeDockedMinutes != null ? String(cfgData.timeDockedMinutes) : "30");
    setChannelId(cfgData.announcementChannelId ?? "");
  }, [cfgData]);

  const busy = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    }
  };

  const save = () =>
    busy(async () => {
      const h = Number.parseFloat(howOften);
      const lc = Number.parseInt(crates, 10);
      const dm = Number.parseInt(dockMin, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/docked-cargo/setup`, {
        method: "POST",
        body: JSON.stringify({
          coordinates,
          howOftenHours: Number.isFinite(h) ? h : undefined,
          sayEnabled,
          inGameMessage: inGame,
          leaveMessage: leave,
          lockedCrates: Number.isFinite(lc) ? lc : undefined,
          timeDockedMinutes: Number.isFinite(dm) ? dm : undefined,
          announcementChannelId: channelId || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Save failed");
      toast.success("Docked Cargo settings saved.");
      void refetch();
      void qc.invalidateQueries({ queryKey: ["admin-docked-cargo", sid] });
    });

  const doStart = (force: boolean) =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/docked-cargo/start`, {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409 && (j as { needsForce?: boolean }).needsForce) {
        setForceOpen(true);
        return;
      }
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Start failed");
      toast.success(force ? "Docked Cargo force-started." : "Docked Cargo automation started.");
      setForceOpen(false);
      void refetch();
    });

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  const ch = meta?.channels ?? [];

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">Docked Cargo</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Match Discord <span className="font-mono">/docked-cargo-setup</span> — coordinates, timers, Rust{" "}
          <span className="font-mono">say</span> messages, and crate count. Start automation once; use force if already
          running.
        </p>
      </div>

      {cfgData?.setupComplete ? (
        <p className="text-xs text-emerald-600/90 font-medium">Setup complete for this server.</p>
      ) : (
        <p className="text-xs text-amber-600/90">Fill all required fields (messages required if say is on).</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Configuration</CardTitle>
          <CardDescription>Coordinates as x,y,z — same as in-game spawn.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Coordinates (x,y,z)</Label>
            <Input value={coordinates} onChange={(e) => setCoordinates(e.target.value)} placeholder="154.03,0.90,-765.32" />
          </div>
          <div className="space-y-2">
            <Label>How often (hours between full cycles)</Label>
            <Input value={howOften} onChange={(e) => setHowOften(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-2">
            <Label>Announcement channel</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger>
                <SelectValue placeholder="Channel" />
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
          <div className="flex items-center justify-between sm:col-span-2 rounded-md border border-border px-3 py-2">
            <Label>In-game say messages</Label>
            <Switch checked={sayEnabled} onCheckedChange={setSayEnabled} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Arrival say message</Label>
            <Textarea value={inGame} onChange={(e) => setInGame(e.target.value)} rows={3} className="font-mono text-sm" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Leave say message</Label>
            <Textarea value={leave} onChange={(e) => setLeave(e.target.value)} rows={3} className="font-mono text-sm" />
          </div>
          <div className="space-y-2">
            <Label>Locked crates (1–5)</Label>
            <Select value={crates} onValueChange={setCrates}>
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
          <div className="space-y-2">
            <Label>Time docked (minutes)</Label>
            <Input value={dockMin} onChange={(e) => setDockMin(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save()}>
              Save settings
            </Button>
            <Button type="button" variant="secondary" onClick={() => void doStart(false)}>
              Start automation
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={forceOpen} onOpenChange={setForceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-rajdhani">Automation already started</AlertDialogTitle>
            <AlertDialogDescription>
              Reset the How Often timer and force a new run now? This matches Discord&apos;s second{" "}
              <span className="font-mono">/docked-cargo-start</span> prompt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doStart(true)}>Force start</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
