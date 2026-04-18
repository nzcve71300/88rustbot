import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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

export function ClanAdminPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);

  const { data: meta } = useQuery({
    queryKey: ["admin-meta", sid],
    queryFn: () => fetchAdminServerMeta(sid),
    enabled: Number.isFinite(sid) && sid > 0,
  });

  const [enabled, setEnabled] = useState(true);
  const [maxMembers, setMaxMembers] = useState("10");
  const [channelId, setChannelId] = useState("");

  const busy = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    }
  };

  const doSetup = () =>
    busy(async () => {
      const max = Number.parseInt(maxMembers, 10);
      const res = await adminFetch(`/api/admin/server/${sid}/clan/setup`, {
        method: "POST",
        body: JSON.stringify({
          enabled,
          maxMembers: max,
          channelId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Setup failed");
      toast.success("Clan join message posted — settings saved for this Discord.");
    });

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  const ch = meta?.channels ?? [];

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">Clan System</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Clan settings apply to the whole Discord guild. This page confirms you are configuring from a valid Rust server
          context.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Setup clan</CardTitle>
          <CardDescription>Posts the JOIN A CLAN embed with the button row (same as /setup-clan).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between sm:col-span-2 rounded-md border border-border px-3 py-2">
            <Label htmlFor="clan-en">Clan system enabled</Label>
            <Switch id="clan-en" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="space-y-2">
            <Label>Max members per clan (1–20)</Label>
            <Input value={maxMembers} onChange={(e) => setMaxMembers(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Channel for join message</Label>
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
          <div className="sm:col-span-2">
            <Button onClick={() => void doSetup()}>Post &amp; save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
