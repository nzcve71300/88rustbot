import { useState } from "react";
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
import { toast } from "sonner";

export function OneV1AdminPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);
  const qc = useQueryClient();

  const { data: meta } = useQuery({
    queryKey: ["admin-meta", sid],
    queryFn: () => fetchAdminServerMeta(sid),
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const { data: matchInfo, refetch: refetchMatch } = useQuery({
    queryKey: ["admin-onev1-match", sid],
    queryFn: async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/onev1/match`);
      const j = (await res.json()) as { ok?: boolean; match?: { id: number; status: string } | null };
      return j.match ?? null;
    },
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const [channelId, setChannelId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [kit, setKit] = useState("");
  const [freq, setFreq] = useState("4444");

  const busy = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    }
  };

  const doSetup = () =>
    busy(async () => {
      const f = Number.parseInt(freq, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/onev1/setup`, {
        method: "POST",
        body: JSON.stringify({
          announcementChannelId: channelId,
          enabled,
          kitName: kit.trim(),
          gateFrequency: f,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Save failed");
      toast.success("1v1 settings saved (nothing posted to Discord).");
      void qc.invalidateQueries({ queryKey: ["admin-onev1-match", sid] });
    });

  const doDelete = () =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/onev1/delete`, { method: "POST", body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Remove failed");
      toast.success("1v1 match cleared.");
      void refetchMatch();
    });

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  const ch = meta?.channels ?? [];

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">1V1 System</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Silent config (no announcement post). Save gate coordinates under Manage Positions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Active match</CardTitle>
          <CardDescription>Cancels a pending or in-progress duel and edits the Discord message if possible.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {matchInfo ? (
            <>
              <p className="text-sm">
                Match <span className="font-mono">#{matchInfo.id}</span> —{" "}
                <span className="text-muted-foreground">{matchInfo.status}</span>
              </p>
              <Button variant="destructive" onClick={() => void doDelete()}>
                Remove 1v1 match
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No pending or active 1v1 on this server.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Configure 1v1</CardTitle>
          <CardDescription>Announcement channel is used for nominations and results when players use 1v1 commands.</CardDescription>
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
          <div className="flex items-center justify-between sm:col-span-2 rounded-md border border-border px-3 py-2">
            <Label htmlFor="onev1-en">Allow player-started 1v1</Label>
            <Switch id="onev1-en" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="space-y-2">
            <Label>Gate frequency (4 digits)</Label>
            <Input
              inputMode="numeric"
              maxLength={4}
              value={freq}
              onChange={(e) => setFreq(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>
          <div className="space-y-2">
            <Label>Kit name</Label>
            <Input value={kit} onChange={(e) => setKit(e.target.value)} placeholder="Shared kit" />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void doSetup()}>Save configuration</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
