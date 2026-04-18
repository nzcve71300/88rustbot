import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { adminFetch } from "@/lib/adminApi";
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

function positionChoices(): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 20; i++) out.push(`KOTH Gate ${i}`);
  for (let i = 1; i <= 10; i++) out.push(`Maze spawn-point ${i}`);
  for (let i = 1; i <= 20; i++) out.push(`Nuketown Gate ${i}`);
  out.push("1v1 Gate 1", "1v1 Gate 2");
  return out;
}

export function PositionsAdminPanel() {
  const { serverId } = useParams();
  const sid = Number.parseInt(serverId ?? "", 10);

  const choices = useMemo(() => positionChoices(), []);
  const [position, setPosition] = useState(choices[0] ?? "KOTH Gate 1");
  const [coordinates, setCoordinates] = useState("");

  const busy = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    }
  };

  const save = () =>
    busy(async () => {
      const res = await adminFetch(`/api/admin/server/${sid}/positions`, {
        method: "POST",
        body: JSON.stringify({ position, coordinates: coordinates.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Save failed");
      toast.success("Coordinates saved.");
      setCoordinates("");
    });

  if (!Number.isFinite(sid) || sid < 1) {
    return <p className="text-destructive text-sm">Invalid server.</p>;
  }

  return (
    <div className="max-w-2xl flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-rajdhani font-bold text-foreground">Manage Positions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Same labels as <code className="text-xs bg-muted px-1 rounded">/manage-positions</code> — world coordinates for
          this Rust server.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-rajdhani text-lg">Save position</CardTitle>
          <CardDescription>Enter three numbers: x y z (spaces or commas).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label>Position</Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[min(60vh,320px)]">
                {choices.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Coordinates</Label>
            <Input
              value={coordinates}
              onChange={(e) => setCoordinates(e.target.value)}
              placeholder="e.g. 154.03,0.90,-765.32"
              autoComplete="off"
            />
          </div>
          <Button onClick={() => void save()}>Save coordinates</Button>
        </CardContent>
      </Card>
    </div>
  );
}
