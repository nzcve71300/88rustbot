import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { fetchMe, logout } from "@/lib/auth";
import { fetchServers, type RealServer } from "@/lib/servers";
import { ServerHostname } from "@/components/ServerHostname";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  fetchPushEligible,
  fetchPushServerScope,
  getExistingPushSubscription,
  markNotifyPromptComplete,
  pushApisSupported,
  savePushServerScope,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
} from "@/lib/pushNotifications";

function discordAvatarUrl(user: { id: string; avatar?: string | null }): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  return "https://cdn.discordapp.com/embed/avatars/0.png";
}

async function syncPushSwitch(setPushOn: (v: boolean) => void): Promise<void> {
  if (!pushApisSupported()) {
    setPushOn(false);
    return;
  }
  const sub = await getExistingPushSubscription();
  setPushOn(Boolean(sub));
}

export function UserMenu() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false, staleTime: 30_000 });
  const { data: eligible } = useQuery({
    queryKey: ["push-eligible"],
    queryFn: fetchPushEligible,
    enabled: Boolean(data?.ok),
    staleTime: 30_000,
    retry: false,
  });

  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [eligibleIds, setEligibleIds] = useState<number[]>([]);
  const [servers, setServers] = useState<RealServer[]>([]);
  const [limitToSelected, setLimitToSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [scopeError, setScopeError] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.ok) return;
    void syncPushSwitch(setPushOn);
  }, [data?.ok]);

  useEffect(() => {
    const onChange = () => {
      void syncPushSwitch(setPushOn);
    };
    window.addEventListener("grindset-push-subscription-changed", onChange);
    return () => window.removeEventListener("grindset-push-subscription-changed", onChange);
  }, []);

  if (!data?.ok) return null;

  const user = data.user;
  const displayName = user.global_name?.trim() ? user.global_name : user.username;
  const canUsePush = pushApisSupported() && Boolean(eligible?.ok && eligible.linked);
  const pushDisabledReason = !pushApisSupported()
    ? "Not available in this browser."
    : !eligible?.linked
      ? "Link once from any server page — one link covers every Rust server in that Discord."
      : null;

  async function onPushSwitch(checked: boolean) {
    if (!canUsePush || pushBusy) return;
    setPushBusy(true);
    try {
      if (checked) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
        const result = await subscribeToPushNotifications();
        if (result.ok) {
          setPushOn(true);
          markNotifyPromptComplete();
          window.dispatchEvent(new Event("grindset-push-subscription-changed"));
        }
      } else {
        await unsubscribeFromPushNotifications();
        setPushOn(false);
        window.dispatchEvent(new Event("grindset-push-subscription-changed"));
      }
    } finally {
      setPushBusy(false);
      void syncPushSwitch(setPushOn);
    }
  }

  async function openScopeDialog() {
    setScopeError(null);
    setScopeOpen(true);
    setScopeLoading(true);
    try {
      const [scopeRes, serversList] = await Promise.all([fetchPushServerScope(), fetchServers()]);
      if (!scopeRes.ok) {
        setScopeError("Could not load notification settings.");
        return;
      }
      setServers(serversList);
      setEligibleIds(scopeRes.eligibleRustServerIds);
      if (scopeRes.restrictToServers) {
        setLimitToSelected(true);
        setSelectedIds(new Set(scopeRes.rustServerIds));
      } else {
        setLimitToSelected(false);
        setSelectedIds(new Set(scopeRes.eligibleRustServerIds));
      }
    } catch {
      setScopeError("Could not load servers.");
    } finally {
      setScopeLoading(false);
    }
  }

  async function saveScope() {
    setScopeError(null);
    if (limitToSelected && selectedIds.size === 0) {
      setScopeError("Pick at least one server, or turn off “Only selected servers”.");
      return;
    }
    setScopeSaving(true);
    try {
      const ids = limitToSelected ? [...selectedIds] : [];
      const result = await savePushServerScope(ids);
      if (!result.ok) {
        setScopeError(result.error ?? "Save failed.");
        return;
      }
      setScopeOpen(false);
      await qc.invalidateQueries({ queryKey: ["push-server-scope"] });
    } finally {
      setScopeSaving(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group flex items-center gap-2 rounded-full border border-border bg-card/40 px-2 py-1.5 transition-colors hover:bg-accent"
          aria-label="Open profile menu"
        >
          <img
            src={discordAvatarUrl(user)}
            alt={displayName}
            className="h-8 w-8 rounded-full border border-border"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <span className="max-w-[140px] truncate text-sm font-rajdhani font-bold text-foreground hidden sm:inline">
            {displayName}
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          <div className="flex items-center gap-3">
            <img
              src={discordAvatarUrl(user)}
              alt={displayName}
              className="h-10 w-10 rounded-full border border-border"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">@{user.username}</div>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="px-2 py-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">Email</div>
          <div className="text-sm text-foreground truncate">{user.email ?? "Not provided by Discord"}</div>
        </div>

        <DropdownMenuSeparator />

        <div className="px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="grindset-push" className="text-sm font-normal leading-tight cursor-pointer">
              Event notifications
            </Label>
            <Switch
              id="grindset-push"
              checked={pushOn}
              disabled={!canUsePush || pushBusy}
              onCheckedChange={(c) => void onPushSwitch(c)}
              aria-label="Toggle event notifications"
            />
          </div>
          {pushDisabledReason ? (
            <p className="text-[11px] text-muted-foreground leading-snug">{pushDisabledReason}</p>
          ) : null}
          {canUsePush && pushOn ? (
            <button
              type="button"
              className="text-xs text-primary hover:underline text-left"
              onClick={() => void openScopeDialog()}
            >
              Which servers?
            </button>
          ) : null}
        </div>

        <DropdownMenuSeparator />
        <div className="p-2">
          <Button
            variant="destructive"
            className="w-full"
            onClick={async () => {
              await logout();
              await qc.invalidateQueries({ queryKey: ["me"] });
              window.location.href = "/login";
            }}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </DropdownMenuContent>

      <Dialog open={scopeOpen} onOpenChange={setScopeOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-rajdhani">Server alerts</DialogTitle>
            <DialogDescription>
              You only link <span className="text-foreground font-medium">once per Discord</span> — that applies to
              every Rust server in that community. Use this to choose which servers you want{" "}
              <span className="text-foreground font-medium">notifications</span> for (optional).
            </DialogDescription>
          </DialogHeader>

          {scopeLoading ? (
            <div className="text-sm text-muted-foreground py-4">Loading…</div>
          ) : eligibleIds.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              No Rust servers found for your account. Link your in-game name once from any server page — it covers
              every Rust server in that Discord.
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="limit-servers" className="text-sm font-normal cursor-pointer leading-tight">
                  Only selected servers
                </Label>
                <Switch
                  id="limit-servers"
                  checked={limitToSelected}
                  onCheckedChange={(v) => {
                    setLimitToSelected(v);
                    if (!v) {
                      setSelectedIds(new Set(eligibleIds));
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {limitToSelected
                  ? "Alerts only for checked servers. Turn this off to get alerts for every Rust server in Discords where you’ve linked (one link covers the whole Discord)."
                  : "You’ll get alerts when events start on any Rust server in a Discord where you’ve linked — one link, all servers there."}
              </p>

              {limitToSelected ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  {eligibleIds.map((id) => {
                    const srv = servers.find((s) => s.id === id);
                    const fullName = srv ? srv.hostnamePlain || srv.nickname : `Server #${id}`;
                    return (
                      <div key={id} className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          id={`srv-${id}`}
                          checked={selectedIds.has(id)}
                          onCheckedChange={(c) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (c === true) next.add(id);
                              else next.delete(id);
                              return next;
                            });
                          }}
                        />
                        <Label
                          htmlFor={`srv-${id}`}
                          title={fullName}
                          className="min-w-0 flex-1 cursor-pointer text-sm font-normal"
                        >
                          {srv ? (
                            <ServerHostname
                              segments={srv.hostnameSegments}
                              hostnamePlain={srv.hostnamePlain}
                              nickname={srv.nickname}
                              truncate
                              className="text-sm font-normal text-foreground"
                            />
                          ) : (
                            `Server #${id}`
                          )}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}

          {scopeError ? <div className="text-sm text-destructive">{scopeError}</div> : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setScopeOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={scopeLoading || scopeSaving || eligibleIds.length === 0} onClick={() => void saveScope()}>
              {scopeSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DropdownMenu>
  );
}
