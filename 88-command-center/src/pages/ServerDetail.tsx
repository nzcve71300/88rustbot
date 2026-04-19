import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo, type ReactNode } from "react";
import { ArrowLeft, Ghost, Users, Map as MapIcon, Timer, Trophy, Activity, User, Swords } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchServers } from "@/lib/servers";
import {
  fetchMyStats,
  fetchServerEvents,
  fetchServerLeaderboard,
  fetchSiteInbox,
  joinEventFromWebsite,
  leaveEventFromWebsite,
  markSiteInboxRead,
  fetchOneV1NominateCandidates,
  postLink,
  postOneV1MatchAction,
  postOneV1Nominate,
} from "@/lib/serverDetailApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import StatCard from "@/components/StatCard";
import { ServerHostname } from "@/components/ServerHostname";
import { Badge } from "@/components/ui/badge";
import { fetchMe } from "@/lib/auth";
import {
  createClanOnWebsite,
  deleteClanOnWebsite,
  fetchClanMe,
  fetchClanStats,
  inviteClanOnWebsite,
  joinClanOnWebsite,
  kickClanMember,
  leaveClanOnWebsite,
  promoteClanMember,
} from "@/lib/clanApi";
import { cn } from "@/lib/utils";

function neonEventStatusClass(label: string): string {
  const s = label.trim().toLowerCase();
  if (s === "loading…") return "text-muted-foreground";
  if (s === "no live event" || s === "not configured" || s === "not set up") {
    return "text-orange-400 font-semibold drop-shadow-[0_0_10px_rgba(251,146,60,0.55)]";
  }
  if (s === "idle") {
    return "text-yellow-300 font-semibold drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]";
  }
  if (
    s === "active" ||
    s === "wave live" ||
    s === "doors closed" ||
    s === "between waves" ||
    s === "live match"
  ) {
    return "text-emerald-400 font-semibold drop-shadow-[0_0_10px_rgba(52,211,153,0.55)]";
  }
  if (s === "pending" || s === "waiting") {
    return "text-amber-300 font-semibold drop-shadow-[0_0_10px_rgba(251,191,36,0.5)]";
  }
  if (s === "canceled" || s === "cancelled") {
    return "text-red-400 font-semibold drop-shadow-[0_0_10px_rgba(248,113,113,0.55)]";
  }
  if (s === "disabled") {
    return "text-red-400/90 font-semibold drop-shadow-[0_0_8px_rgba(248,113,113,0.45)]";
  }
  return "text-cyan-300/90 font-medium drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]";
}

const ServerDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [eventBusy, setEventBusy] = useState<{ koth?: boolean; maze?: boolean; nuketown?: boolean }>({});
  const [eventError, setEventError] = useState<{
    koth?: string | null;
    maze?: string | null;
    nuketown?: string | null;
    onev1?: string | null;
  }>({});
  const [linkError, setLinkError] = useState<string | null>(null);
  const [eventLbOpen, setEventLbOpen] = useState(false);
  const [eventLbTitle, setEventLbTitle] = useState<string>("");
  const [eventLbPayload, setEventLbPayload] = useState<unknown>(null);
  const [clanOpen, setClanOpen] = useState(false);
  const [createClanOpen, setCreateClanOpen] = useState(false);
  const [joinClanOpen, setJoinClanOpen] = useState(false);
  const [clanName, setClanName] = useState("");
  const [clanTag, setClanTag] = useState("");
  const [clanColor, setClanColor] = useState("green");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [clanError, setClanError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [nominateOpen, setNominateOpen] = useState(false);
  const [nominateStep, setNominateStep] = useState<"list" | "confirm">("list");
  const [nominateCandidates, setNominateCandidates] = useState<
    { discordUserId: string; displayName: string; avatarUrl: string }[]
  >([]);
  const [nominatePick, setNominatePick] = useState<{
    discordUserId: string;
    displayName: string;
    avatarUrl: string;
  } | null>(null);
  const [nominateLoading, setNominateLoading] = useState(false);
  const [onev1Busy, setOnev1Busy] = useState(false);

  const { data: servers = [], isLoading: loadingServers } = useQuery({
    queryKey: ["servers"],
    queryFn: fetchServers,
    retry: false,
    staleTime: 10_000,
  });

  const server = slug ? servers.find((s) => s.slug === slug) : undefined;
  const serverId = server ? Number(server.id) : null;

  const { data: events } = useQuery({
    queryKey: ["server-events", serverId],
    queryFn: () => fetchServerEvents(serverId!),
    enabled: serverId != null,
    refetchInterval: 2000,
    staleTime: 0,
    retry: false,
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["server-leaderboard", serverId],
    queryFn: () => fetchServerLeaderboard(serverId!),
    enabled: serverId != null,
    staleTime: 10_000,
    retry: false,
  });

  const { data: myStats, refetch: refetchMyStats } = useQuery({
    queryKey: ["my-stats", serverId],
    queryFn: () => fetchMyStats(serverId!),
    enabled: serverId != null,
    staleTime: 2000,
    retry: false,
  });

  const { data: clanMe, refetch: refetchClanMe } = useQuery({
    queryKey: ["clan-me", serverId],
    queryFn: () => fetchClanMe(serverId!),
    enabled: serverId != null,
    staleTime: 2000,
    retry: false,
  });

  const { data: clanStats, refetch: refetchClanStats } = useQuery({
    queryKey: ["clan-stats", serverId],
    queryFn: () => fetchClanStats(serverId!),
    enabled: serverId != null && clanMe != null && (clanMe as any).inClan === true,
    staleTime: 3000,
    retry: false,
  });

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false, staleTime: 30_000 });
  const myDiscordUserId = me && me.ok ? me.user.id : null;

  const { data: inboxData } = useQuery({
    queryKey: ["site-inbox"],
    queryFn: fetchSiteInbox,
    enabled: Boolean(me && me.ok && serverId),
    refetchInterval: 5000,
    staleTime: 0,
    retry: false,
  });

  const onev1InboxForServer = useMemo(() => {
    const list = inboxData?.messages ?? [];
    if (!serverId) return [];
    return list.filter((m) => {
      if (!m.kind.startsWith("onev1_")) return false;
      const p = m.payload as { rustServerId?: number } | null;
      return p && typeof p.rustServerId === "number" && p.rustServerId === serverId;
    });
  }, [inboxData, serverId]);
  const clanOwnerId =
    clanMe && (clanMe as any).inClan === true ? String((clanMe as any).clan.ownerDiscordUserId ?? "") : "";
  const isClanOwner = Boolean(myDiscordUserId && clanOwnerId && String(myDiscordUserId) === clanOwnerId);
  const isLinked = Boolean(myStats && myStats.ok && "linked" in myStats && myStats.linked);

  const [kothPhaseTick, setKothPhaseTick] = useState(0);
  useEffect(() => {
    const end = events?.koth.phaseEndsAtMs;
    if (end == null || end <= Date.now()) return;
    const id = window.setInterval(() => setKothPhaseTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [events?.koth.phaseEndsAtMs]);

  const [nuketownLobbyTick, setNuketownLobbyTick] = useState(0);
  useEffect(() => {
    const end = (events as any)?.nuketown?.lobbyEndsAtMs as number | null | undefined;
    const status = (events as any)?.nuketown?.status as string | undefined;
    if (status !== "pending" || end == null || end <= Date.now()) return;
    const id = window.setInterval(() => setNuketownLobbyTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [(events as any)?.nuketown?.status, (events as any)?.nuketown?.lobbyEndsAtMs]);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t);
  }, []);

  void kothPhaseTick;
  void nuketownLobbyTick;
  const kothPhaseEnd = events?.koth.phaseEndsAtMs;
  const kothPhaseRemainSec =
    kothPhaseEnd != null && Date.now() < kothPhaseEnd
      ? Math.max(0, Math.ceil((kothPhaseEnd - Date.now()) / 1000))
      : null;
  const kothPhase = events?.koth.phase;
  const kothDoorDelayMs = events?.koth.doorDelayMs ?? 60_000;
  const kothDoorFinalHighlight =
    kothPhase === "door_delay" &&
    kothPhaseRemainSec != null &&
    kothPhaseRemainSec <= 10 &&
    kothDoorDelayMs >= 10_000;

  // Backwards-compatible: older bots may not include `nuketown` in /events yet.
  const nuketown =
    (events as any)?.nuketown ??
    ({
      status: "none",
      lobbyEndsAtMs: null,
      teamLimit: null,
      joined: 0,
      teams: [],
      participants: [],
      bracket: null,
      ended: null,
    } as const);

  const onev1 =
    events?.onev1 ??
    ({
      enabled: false,
      configured: false,
      status: "none" as const,
      match: null,
      ended: null,
    } as const);

  const kothStatusLabel = useMemo(() => {
    if (!events) return "Loading…";
    if (events.koth.status === "active" && kothPhase === "door_delay") return "Doors closed";
    if (events.koth.status === "active" && kothPhase === "wave_active") return "Wave live";
    if (events.koth.status === "active" && kothPhase === "between_waves") return "Between waves";
    if (events.koth.status === "active") return "Active";
    if (events.koth.status === "pending") return "Pending";
    return "No live event";
  }, [events, kothPhase]);

  const nuketownStatusLabel = useMemo(() => {
    if (!events) return "Loading…";
    if (nuketown.status === "active") return "Active";
    if (nuketown.status === "pending") return "Pending";
    return "No live event";
  }, [events, nuketown.status]);

  const onev1StatusLabel = useMemo(() => {
    if (!events) return "Loading…";
    if (!onev1.configured) return "Not set up";
    if (!onev1.enabled) return "Disabled";
    if (onev1.status === "running") return "Live match";
    if (onev1.status === "pending") return "Waiting";
    return "Idle";
  }, [events, onev1]);

  const mazeStatusLabel = useMemo(() => {
    if (!events) return "Loading…";
    const st = events?.maze?.status ?? "none";
    if (st === "active") return "Active";
    if (st === "pending") return "Pending";
    return "No live event";
  }, [events]);

  const dockedCargoStatusLabel = useMemo(() => {
    if (!events) return "Loading…";
    if (events.dockedCargo?.active) return "Active";
    if (events.dockedCargo?.configured) return "Idle";
    return "Not configured";
  }, [events]);

  if (!server) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center animate-fade-up">
          <Ghost className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-rajdhani font-bold text-foreground mb-2">Server Not Found</h2>
          <button onClick={() => navigate("/")} className="text-primary text-sm hover:underline">
            Go back home
          </button>
        </div>
      </div>
    );
  }

  if (loading || loadingServers) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border px-4 py-4 md:px-8">
          <div className="container flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-muted animate-pulse" />
            <div className="h-6 w-40 rounded bg-muted animate-pulse" />
          </div>
        </header>
        <main className="container py-8">
          <div className="rounded-lg border border-border bg-card p-6 h-56 animate-pulse" />
        </main>
      </div>
    );
  }

  async function submitLink() {
    if (!serverId) return;
    const name = linkName.trim();
    if (!name) return;
    setLinkBusy(true);
    setLinkError(null);
    const res = await postLink(serverId, name);
    setLinkBusy(false);
    if (!res.ok) {
      setLinkError(res.error ?? "Link failed");
      return;
    }
    setLinkOpen(false);
    setLinkName("");
    await refetchMyStats();
  }

  async function doEventJoin(kind: "koth" | "maze" | "nuketown") {
    if (!serverId) return;
    if (!isLinked) {
      setLinkOpen(true);
      return;
    }
    setEventError((e) => ({ ...e, [kind]: null }));
    setEventBusy((b) => ({ ...b, [kind]: true }));
    try {
      await joinEventFromWebsite(serverId, kind);
      await queryClient.invalidateQueries({ queryKey: ["server-events", serverId] });
    } catch (e) {
      setEventError((x) => ({ ...x, [kind]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setEventBusy((b) => ({ ...b, [kind]: false }));
    }
  }

  async function doEventLeave(kind: "koth" | "maze" | "nuketown") {
    if (!serverId) return;
    if (!isLinked) {
      setLinkOpen(true);
      return;
    }
    setEventError((e) => ({ ...e, [kind]: null }));
    setEventBusy((b) => ({ ...b, [kind]: true }));
    try {
      await leaveEventFromWebsite(serverId, kind);
      await queryClient.invalidateQueries({ queryKey: ["server-events", serverId] });
    } catch (e) {
      setEventError((x) => ({ ...x, [kind]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setEventBusy((b) => ({ ...b, [kind]: false }));
    }
  }

  const COLORS = [
    { key: "red", label: "Red" },
    { key: "orange", label: "Orange" },
    { key: "yellow", label: "Yellow" },
    { key: "green", label: "Green" },
    { key: "blue", label: "Blue" },
    { key: "purple", label: "Purple" },
    { key: "black", label: "Black" },
    { key: "white", label: "White" },
    { key: "brown", label: "Brown" },
    { key: "pink", label: "Pink" },
    { key: "cyan", label: "Cyan" },
    { key: "lime", label: "Lime" },
  ];

  async function openClanSystem() {
    if (!myStats || !("linked" in myStats) || !myStats.linked) {
      setLinkOpen(true);
      return;
    }
    setClanError(null);
    setClanOpen(true);
    await refetchClanMe();
    await refetchClanStats();
  }

  async function doCreateClan() {
    if (!serverId) return;
    setClanError(null);
    try {
      await createClanOnWebsite(serverId, { name: clanName.trim(), tag: clanTag.trim().toUpperCase(), color: clanColor });
      setCreateClanOpen(false);
      setClanName("");
      setClanTag("");
      setInviteCode(null);
      await refetchClanMe();
      await refetchClanStats();
    } catch (e) {
      setClanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doJoinClan() {
    if (!serverId) return;
    setClanError(null);
    try {
      await joinClanOnWebsite(serverId, joinCode.trim());
      setJoinClanOpen(false);
      setJoinCode("");
      await refetchClanMe();
      await refetchClanStats();
    } catch (e) {
      setClanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doLeaveClan() {
    if (!serverId) return;
    setClanError(null);
    try {
      await leaveClanOnWebsite(serverId);
      setInviteCode(null);
      await refetchClanMe();
      await refetchClanStats();
    } catch (e) {
      setClanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doInviteClan() {
    if (!serverId) return;
    setClanError(null);
    try {
      const r = await inviteClanOnWebsite(serverId);
      setInviteCode(String(r.code ?? ""));
    } catch (e) {
      setClanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doKick(userId: string) {
    if (!serverId) return;
    setClanError(null);
    try {
      await kickClanMember(serverId, userId);
      await refetchClanMe();
      await refetchClanStats();
    } catch (e) {
      setClanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doPromote(userId: string) {
    if (!serverId) return;
    setClanError(null);
    try {
      await promoteClanMember(serverId, userId);
      await refetchClanMe();
    } catch (e) {
      setClanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function doDeleteClan() {
    if (!serverId) return;
    setClanError(null);
    setDeleteBusy(true);
    try {
      await deleteClanOnWebsite(serverId, deleteConfirm);
      setDeleteBusy(false);
      setDeleteConfirm("");
      setInviteCode(null);
      await refetchClanMe();
      await refetchClanStats();
    } catch (e) {
      setDeleteBusy(false);
      setClanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openNominateModal() {
    if (!serverId) return;
    setNominateStep("list");
    setNominatePick(null);
    setNominateOpen(true);
    setNominateLoading(true);
    setEventError((e) => ({ ...e, onev1: null }));
    try {
      const r = await fetchOneV1NominateCandidates(serverId);
      setNominateCandidates(r.candidates);
    } catch (e) {
      setEventError((x) => ({ ...x, onev1: e instanceof Error ? e.message : String(e) }));
      setNominateCandidates([]);
    } finally {
      setNominateLoading(false);
    }
  }

  async function confirmNominate() {
    if (!serverId || !nominatePick) return;
    setOnev1Busy(true);
    setEventError((e) => ({ ...e, onev1: null }));
    try {
      await postOneV1Nominate(serverId, nominatePick.discordUserId);
      setNominateOpen(false);
      setNominatePick(null);
      setNominateStep("list");
      await queryClient.invalidateQueries({ queryKey: ["server-events", serverId] });
      await queryClient.invalidateQueries({ queryKey: ["site-inbox"] });
    } catch (e) {
      setEventError((x) => ({ ...x, onev1: e instanceof Error ? e.message : String(e) }));
    } finally {
      setOnev1Busy(false);
    }
  }

  async function doOneV1MatchAction(action: "accept" | "duck") {
    if (!serverId) return;
    const m = onev1.match as { matchId?: number } | null;
    const mid = m?.matchId;
    if (mid == null || !Number.isFinite(Number(mid))) return;
    setOnev1Busy(true);
    setEventError((e) => ({ ...e, onev1: null }));
    try {
      await postOneV1MatchAction(serverId, Number(mid), action);
      await queryClient.invalidateQueries({ queryKey: ["server-events", serverId] });
      await queryClient.invalidateQueries({ queryKey: ["site-inbox"] });
    } catch (e) {
      setEventError((x) => ({ ...x, onev1: e instanceof Error ? e.message : String(e) }));
    } finally {
      setOnev1Busy(false);
    }
  }

  async function dismissOnev1Inbox(ids: number[]) {
    try {
      await markSiteInboxRead(ids);
      await queryClient.invalidateQueries({ queryKey: ["site-inbox"] });
    } catch {
      /* ignore */
    }
  }

  function openEventLeaderboard(title: string, payload: unknown) {
    setEventLbTitle(title);
    setEventLbPayload(payload);
    setEventLbOpen(true);
  }

  function medal(rank: number): string {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return "🏅";
  }

  function renderMazeSnapshot(payload: any) {
    const leaderboard: { discordUserId: string; kills: number; clanName: string }[] = Array.isArray(payload?.leaderboard)
      ? payload.leaderboard
      : [];
    const roster: { ingameName: string; clanName: string; spawnNumber: number; discordUserId: string }[] = Array.isArray(
      payload?.roster
    )
      ? payload.roster
      : [];
    const top = payload?.topKiller as { clanName: string; ingameName: string } | null | undefined;
    const totalKills = typeof payload?.totalKills === "number" ? payload.totalKills : null;

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Ended</Badge>
            {totalKills != null ? <span className="text-sm text-muted-foreground">Total kills: <span className="text-foreground font-semibold">{totalKills}</span></span> : null}
            {top ? (
              <span className="text-sm text-muted-foreground">
                Winner: <span className="text-foreground font-semibold">{top.ingameName}</span>{" "}
                <span className="text-muted-foreground">[{top.clanName}]</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="font-rajdhani font-bold text-foreground mb-2">Participants</div>
            <div className="space-y-1 max-h-64 overflow-auto pr-1">
              {roster.length ? (
                roster.map((p) => (
                  <div key={p.discordUserId} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">
                      {p.ingameName} <span className="text-muted-foreground">[{p.clanName}]</span>
                    </span>
                    <span className="text-muted-foreground">Spawn {p.spawnNumber}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No roster data.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="font-rajdhani font-bold text-foreground mb-2">Event Leaderboard</div>
            <div className="space-y-1 max-h-64 overflow-auto pr-1">
              {leaderboard.length ? (
                leaderboard.slice(0, 12).map((row, i) => (
                  <div
                    key={row.discordUserId}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                      i % 2 === 0 ? "bg-muted/30" : ""
                    } ${i < 3 ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 text-center text-muted-foreground">
                        {medal(i + 1)} {i + 1}
                      </span>
                      <span className="text-foreground font-medium">
                        <span className="text-muted-foreground">[{row.clanName}]</span>{" "}
                        <span className="text-foreground">{"<@"}{row.discordUserId}{">"}</span>
                      </span>
                    </div>
                    <span className="font-mono text-muted-foreground">{row.kills}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No kill scores recorded.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderKothSnapshot(payload: any) {
    const participants: { discordUserId: string; ingameName: string; clanName: string; gateNumber: number }[] =
      Array.isArray(payload?.participants) ? payload.participants : [];
    const perWave: { wave: number; players: { discordUserId: string; kills: number; clanName: string }[] }[] =
      Array.isArray(payload?.perWave) ? payload.perWave : [];

    const totalsByUser = new Map<string, { discordUserId: string; clanName: string; kills: number }>();
    for (const w of perWave) {
      const players = Array.isArray(w?.players) ? w.players : [];
      for (const p of players) {
        const id = String(p.discordUserId ?? "");
        if (!id) continue;
        const prev = totalsByUser.get(id);
        const kills = Number(p.kills ?? 0) || 0;
        const clanName = String((p as any).clanName ?? "Clan");
        totalsByUser.set(id, { discordUserId: id, clanName, kills: (prev?.kills ?? 0) + kills });
      }
    }
    const totals = [...totalsByUser.values()].sort((a, b) => b.kills - a.kills).slice(0, 12);

    const top = payload?.topKiller as { clanName: string; ingameName: string } | null | undefined;

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Ended</Badge>
            {top ? (
              <span className="text-sm text-muted-foreground">
                Winner: <span className="text-foreground font-semibold">{top.ingameName}</span>{" "}
                <span className="text-muted-foreground">[{top.clanName}]</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="font-rajdhani font-bold text-foreground mb-2">Participants</div>
            <div className="space-y-1 max-h-64 overflow-auto pr-1">
              {participants.length ? (
                participants.map((p) => (
                  <div key={p.discordUserId} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">
                      {p.ingameName} <span className="text-muted-foreground">[{p.clanName}]</span>
                    </span>
                    <span className="text-muted-foreground">Gate {p.gateNumber}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No roster data.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="font-rajdhani font-bold text-foreground mb-2">Event Leaderboard (Total)</div>
            <div className="space-y-1 max-h-64 overflow-auto pr-1">
              {totals.length ? (
                totals.map((row, i) => (
                  <div
                    key={row.discordUserId}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                      i % 2 === 0 ? "bg-muted/30" : ""
                    } ${i < 3 ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 text-center text-muted-foreground">
                        {medal(i + 1)} {i + 1}
                      </span>
                      <span className="text-foreground font-medium">
                        <span className="text-muted-foreground">[{row.clanName}]</span>{" "}
                        <span className="text-foreground">{"<@"}{row.discordUserId}{">"}</span>
                      </span>
                    </div>
                    <span className="font-mono text-muted-foreground">{row.kills}</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No kill scores recorded.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 md:px-8 md:py-4">
        <div className="container">
          {/* Mobile: keep profile visible — back + avatar on one row; title full width below */}
          <div className="mb-2 flex items-center justify-between gap-2 md:mb-0 md:hidden">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="shrink-0">
              <UserMenu />
            </div>
          </div>

          <div className="flex items-start gap-2 md:items-center md:gap-4">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="hidden shrink-0 rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-muted transition-colors md:inline-flex"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1
                className="min-w-0 truncate text-sm font-rajdhani font-bold normal-case tracking-normal text-foreground md:text-xl lg:text-2xl"
                title={server.hostnamePlain || server.nickname}
              >
                <ServerHostname
                  segments={server.hostnameSegments}
                  hostnamePlain={server.hostnamePlain}
                  nickname={server.nickname}
                />
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:mt-1">
                <span className="flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${server.ok ? "bg-connected" : "bg-disconnected"}`} />
                  {server.ok ? "Online" : "Offline"}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {server.players ?? "—"}/{server.maxPlayers ?? "—"}
                </span>
              </div>
            </div>
            <div className="hidden shrink-0 md:block">
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8 flex flex-col gap-4">
        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={openClanSystem}>
            Clan System
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card animate-fade-up overflow-hidden">
          <div className="flex items-center justify-between w-full px-6 py-4 text-left">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-rajdhani font-bold text-foreground">Server Details</h2>
            </div>
          </div>
          <div className="px-6 pb-6 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-4">
              <span className="rounded-sm bg-muted px-2 py-0.5">{server.nickname}</span>
              {server.error ? (
                <span className="rounded-sm bg-destructive/20 text-destructive px-2 py-0.5 border border-destructive/30">
                  {server.error}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-primary" />
                  Players
                </div>
                <div className="mt-2 text-2xl font-rajdhani font-bold text-foreground">
                  {server.players ?? "—"}<span className="text-muted-foreground">/{server.maxPlayers ?? "—"}</span>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <MapIcon className="h-4 w-4 text-primary" />
                  Map
                </div>
                <div className="mt-2 text-base font-medium text-foreground truncate">{server.map ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Timer className="h-4 w-4 text-primary" />
                  Uptime
                </div>
                <div className="mt-2 text-base font-medium text-foreground">
                  {typeof server.uptime === "number" ? `${Math.floor(server.uptime / 60)} min` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Events */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-rajdhani">
              <Activity className="h-4 w-4 text-primary" />
              Events
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center justify-between">
                <div className="font-rajdhani font-bold text-foreground">KOTH EVENT</div>
                <span className={cn("text-xs", neonEventStatusClass(kothStatusLabel))}>{kothStatusLabel}</span>
              </div>
              {events?.koth.status === "active" &&
              typeof events.koth.currentWave === "number" &&
              typeof events.koth.wavesTotal === "number" ? (
                <div className="mt-1 text-xs text-muted-foreground font-mono">
                  Wave {events.koth.currentWave}/{events.koth.wavesTotal}
                </div>
              ) : null}
              <div className="mt-2 text-sm text-muted-foreground">
                Joined: <span className="text-foreground font-semibold">{events?.koth.joined ?? "—"}</span>
                {typeof events?.koth.gatesTotal === "number" ? (
                  <span className="ml-2">
                    Gates: <span className="text-foreground font-semibold">{events?.koth.joined ?? 0}</span>/
                    {events.koth.gatesTotal}
                  </span>
                ) : null}
              </div>
              {kothPhaseRemainSec != null && kothPhase ? (
                <div
                  className={`mt-2 text-sm ${
                    kothDoorFinalHighlight ? "font-semibold text-amber-400" : "text-muted-foreground"
                  }`}
                >
                  {kothPhase === "door_delay" ? (
                    <>
                      Doors open in{" "}
                      <span className="font-mono tabular-nums text-foreground">{kothPhaseRemainSec}s</span>
                      {kothDoorFinalHighlight ? (
                        <span className="ml-2 text-amber-400/90">(get ready)</span>
                      ) : null}
                    </>
                  ) : kothPhase === "wave_active" ? (
                    <>
                      Wave ends in{" "}
                      <span className="font-mono tabular-nums text-foreground">{kothPhaseRemainSec}s</span>
                    </>
                  ) : null}
                </div>
              ) : kothPhase === "between_waves" ? (
                <div className="mt-2 text-sm text-muted-foreground">Preparing the next wave…</div>
              ) : null}
              {events?.koth.status === "pending" ? (
                <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  {myDiscordUserId && events.koth.participants.some((p) => String(p.discordUserId) === String(myDiscordUserId)) ? (
                    <Button
                      variant="destructive"
                      className="w-full sm:w-auto"
                      disabled={Boolean(eventBusy.koth)}
                      onClick={() => doEventLeave("koth")}
                    >
                      {eventBusy.koth ? "Leaving…" : "Leave"}
                    </Button>
                  ) : (
                    <Button
                      className="w-full sm:w-auto"
                      disabled={Boolean(eventBusy.koth)}
                      onClick={() => doEventJoin("koth")}
                    >
                      {eventBusy.koth ? "Joining…" : "Join"}
                    </Button>
                  )}
                  {!isLinked ? (
                    <div className="text-xs text-muted-foreground sm:ml-2">
                      Link required to join.
                    </div>
                  ) : null}
                </div>
              ) : events?.koth.status === "active" ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  Lobby closed — the match is starting or in progress.
                </div>
              ) : null}
              {eventError.koth ? (
                <div className="mt-2 text-xs text-destructive">{eventError.koth}</div>
              ) : null}
              {events?.koth.status && events.koth.status !== "none" ? (
                <div className="mt-3 space-y-1">
                  {events.koth.participants.slice(0, 12).map((p) => (
                    <div key={p.discordUserId} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">
                        {p.ingameName}{" "}
                        <span className="text-muted-foreground">[{p.clanName}]</span>
                      </span>
                      <span className="text-muted-foreground">Gate {p.gateNumber}</span>
                    </div>
                  ))}
                </div>
              ) : events?.koth.ended ? (
                <div className="mt-3 space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Status: <span className="text-foreground font-semibold">Ended</span> (kept for 10 minutes)
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => openEventLeaderboard("KOTH Event Leaderboard", events?.koth.ended?.payload)}
                  >
                    Event Leaderboard
                  </Button>
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  {events ? "There are no live events now." : "Loading event status…"}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center justify-between">
                <div className="font-rajdhani font-bold text-foreground">NUKETOWN</div>
                <span className={cn("text-xs", neonEventStatusClass(nuketownStatusLabel))}>{nuketownStatusLabel}</span>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                Joined: <span className="text-foreground font-semibold">{events ? nuketown.joined : "—"}</span>
                {events && nuketown.teamLimit != null ? (
                  <span className="ml-2">
                    Team limit: <span className="text-foreground font-semibold">{nuketown.teamLimit}</span>
                  </span>
                ) : null}
              </div>
              {events && nuketown.status === "pending" && nuketown.lobbyEndsAtMs ? (
                <div className="mt-2 text-sm text-muted-foreground">
                  Starts in{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {Math.max(0, Math.ceil((nuketown.lobbyEndsAtMs - Date.now()) / 1000))}s
                  </span>
                </div>
              ) : null}

              {events && nuketown.status !== "none" ? (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Bracket</div>
                  {(() => {
                    const b: any = nuketown.bracket as any;
                    const bracketTeams = Array.isArray(b?.teams) ? b.teams : [];
                    const bySlot = new Map<number, { tag: string; color: string | null }>();

                    const COLOR_KEY_TO_HEX: Record<string, string> = {
                      red: "#ef4444",
                      orange: "#f97316",
                      yellow: "#eab308",
                      green: "#22c55e",
                      blue: "#3b82f6",
                      purple: "#a855f7",
                      black: "#111827",
                      white: "#e5e7eb",
                      brown: "#a16207",
                      pink: "#ec4899",
                      cyan: "#06b6d4",
                      lime: "#84cc16",
                    };
                    const normColor = (c: unknown): string | null => {
                      const s = typeof c === "string" ? c.trim() : "";
                      if (!s) return null;
                      if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
                      const k = s.toLowerCase();
                      return COLOR_KEY_TO_HEX[k] ?? null;
                    };

                    // Prefer bracket json (active); fallback to participants/teams (pending).
                    for (const t of bracketTeams) {
                      const slot = Number(t?.slot);
                      if (!Number.isFinite(slot)) continue;
                      const rawTag = typeof t?.clanTag === "string" ? t.clanTag.trim() : "";
                      const tag = rawTag ? `[${rawTag.toUpperCase()}]` : `Team ${slot}`;
                      const color = normColor(t?.clanColor);
                      bySlot.set(slot, { tag: String(tag), color });
                    }
                    if (bySlot.size === 0 && Array.isArray(nuketown.participants)) {
                      for (const p of nuketown.participants as any[]) {
                        const slot = Number(p?.teamSlot);
                        if (!Number.isFinite(slot)) continue;
                        const rawTag = typeof p?.clanTag === "string" ? p.clanTag.trim() : "";
                        const tag = rawTag ? `[${rawTag.toUpperCase()}]` : `Team ${slot}`;
                        const color = normColor(p?.clanColor);
                        if (!bySlot.has(slot)) bySlot.set(slot, { tag: String(tag), color });
                      }
                    }

                    const cur = b?.currentMatch ?? null;
                    const winners = b?.winners ?? {};
                    const teamLabel = (slot: number | null | undefined) => {
                      const s = Number(slot);
                      if (!Number.isFinite(s)) return "TBD";
                      return bySlot.get(s) ?? { tag: `Team ${s}`, color: null };
                    };
                    const matchRow = (
                      label: "Semi 1" | "Semi 2" | "Final",
                      aSlot: number | null | undefined,
                      bSlot: number | null | undefined
                    ) => {
                      const isActive = cur && String(cur.label) === label;
                      const left = teamLabel(aSlot);
                      const right = teamLabel(bSlot);
                      const score = isActive ? `${cur.scoreA}–${cur.scoreB}` : "vs";
                      const round = isActive ? ` · Round ${cur.round}` : "";
                      return (
                        <div
                          className={`rounded-md border border-border bg-background/30 p-2 text-sm ${
                            isActive ? "ring-1 ring-primary/60" : ""
                          }`}
                        >
                          <div className="text-muted-foreground text-xs">
                            {label}
                            {round}
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-foreground font-medium truncate" style={left.color ? { color: left.color } : undefined}>
                              {left.tag}
                            </span>
                            <span className="font-mono tabular-nums text-muted-foreground shrink-0">{score}</span>
                            <span
                              className="text-foreground font-medium truncate text-right"
                              style={right.color ? { color: right.color } : undefined}
                            >
                              {right.tag}
                            </span>
                          </div>
                        </div>
                      );
                    };

                    const semi1Winner = winners?.semi1?.slot ?? null;
                    const semi2Winner = winners?.semi2?.slot ?? null;

                    return (
                      <div className="grid gap-2">
                        {matchRow("Semi 1", 1, 2)}
                        {matchRow("Semi 2", 3, 4)}
                        {matchRow("Final", semi1Winner, semi2Winner)}
                        {winners?.champion?.slot ? (
                          <div className="text-xs text-muted-foreground">
                            Champion:{" "}
                            {(() => {
                              const t = teamLabel(winners.champion.slot);
                              return (
                                <span className="text-foreground font-semibold" style={t.color ? { color: t.color } : undefined}>
                                  {t.tag}
                                </span>
                              );
                            })()}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {events?.nuketown?.status === "pending" ? (
                <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  {myDiscordUserId &&
                  Array.isArray((nuketown as any).participants) &&
                  (nuketown as any).participants.some((p: any) => String(p.discordUserId) === String(myDiscordUserId)) ? (
                    <Button
                      variant="destructive"
                      className="w-full sm:w-auto"
                      disabled={Boolean(eventBusy.nuketown)}
                      onClick={() => doEventLeave("nuketown")}
                    >
                      {eventBusy.nuketown ? "Leaving…" : "Leave"}
                    </Button>
                  ) : (
                    <Button
                      className="w-full sm:w-auto"
                      disabled={Boolean(eventBusy.nuketown)}
                      onClick={() => doEventJoin("nuketown")}
                    >
                      {eventBusy.nuketown ? "Joining…" : "Join"}
                    </Button>
                  )}
                  {!isLinked ? (
                    <div className="text-xs text-muted-foreground sm:ml-2">Link required to join.</div>
                  ) : null}
                </div>
              ) : events?.nuketown?.status === "active" ? (
                <div className="mt-3 text-xs text-muted-foreground">Lobby closed — the match is in progress.</div>
              ) : null}
              {eventError.nuketown ? <div className="mt-2 text-xs text-destructive">{eventError.nuketown}</div> : null}

              {events && nuketown.status && nuketown.status !== "none" ? (
                <div className="mt-3 space-y-1">
                  {nuketown.participants.slice(0, 10).map((p: any) => (
                    <div key={p.discordUserId} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">
                        {p.ingameName}{" "}
                        <span className="text-muted-foreground">
                          [{p.clanTag || p.clanName}]
                        </span>
                      </span>
                      <span className="text-muted-foreground">{p.teamSlot ? `Team ${p.teamSlot}` : ""}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {events && nuketown.ended ? (
                <div className="mt-3 text-sm text-muted-foreground">
                  {(() => {
                    const payload: any = (nuketown.ended as any)?.payload ?? null;
                    const cancelled = Boolean(payload && payload.cancelled);
                    return (
                      <>
                        Status:{" "}
                        <span className="text-foreground font-semibold">{cancelled ? "Cancelled" : "Ended"}</span>{" "}
                        (kept for 10 minutes)
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.07] to-background/40 p-4 shadow-sm shadow-violet-500/5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Swords className="h-5 w-5 shrink-0 text-violet-400" aria-hidden />
                  <div className="font-rajdhani font-bold text-foreground tracking-wide">1V1 DUELS</div>
                </div>
                <span className={cn("text-xs shrink-0", neonEventStatusClass(onev1StatusLabel))}>{onev1StatusLabel}</span>
              </div>
              {onev1InboxForServer.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {onev1InboxForServer.map((msg) => (
                    <div
                      key={msg.id}
                      className="rounded-md border border-violet-500/30 bg-violet-500/[0.06] px-3 py-2 text-xs text-foreground flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-violet-200/90">{msg.title}</div>
                        <div className="text-muted-foreground mt-0.5 leading-snug">{msg.body}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-xs h-7"
                        onClick={() => void dismissOnev1Inbox([msg.id])}
                      >
                        Dismiss
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Start a duel with <span className="text-foreground font-mono">/onev1</span> in Discord or tap{" "}
                <span className="text-foreground font-semibold">Nominate</span> here. Linked players in a clan only.
              </p>
              {events && onev1.configured && onev1.enabled && onev1.status === "none" && isLinked && clanMe && (clanMe as { inClan?: boolean }).inClan ? (
                <div className="mt-3">
                  <Button
                    type="button"
                    className="w-full sm:w-auto bg-violet-600 hover:bg-violet-500 text-white"
                    disabled={onev1Busy}
                    onClick={() => void openNominateModal()}
                  >
                    Nominate
                  </Button>
                </div>
              ) : null}
              {eventError.onev1 ? <div className="mt-2 text-xs text-destructive">{eventError.onev1}</div> : null}
              {events && onev1.configured && onev1.enabled && onev1.match ? (
                <div className="mt-3 rounded-md border border-border/80 bg-background/50 p-3 text-sm space-y-3">
                  <div className="text-foreground font-medium">
                    {onev1.status === "pending" ? "Nomination sent — waiting for accept" : "Match in progress"}
                  </div>
                  {(() => {
                    const m = onev1.match as {
                      challenger?: {
                        ingameName: string;
                        clanTag: string;
                        clanName: string;
                        clanColor: string | null;
                      };
                      opponent?: {
                        ingameName: string;
                        clanTag: string;
                        clanName: string;
                        clanColor: string | null;
                      };
                    };
                    const ch = m.challenger;
                    const op = m.opponent;
                    const COLOR_KEY_TO_HEX: Record<string, string> = {
                      red: "#ef4444",
                      orange: "#f97316",
                      yellow: "#eab308",
                      green: "#22c55e",
                      blue: "#3b82f6",
                      purple: "#a855f7",
                      black: "#111827",
                      white: "#e5e7eb",
                      brown: "#a16207",
                      pink: "#ec4899",
                      cyan: "#06b6d4",
                      lime: "#84cc16",
                    };
                    const normColor = (c: unknown): string | null => {
                      const s = typeof c === "string" ? c.trim() : "";
                      if (!s) return null;
                      if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
                      const k = s.toLowerCase();
                      return COLOR_KEY_TO_HEX[k] ?? null;
                    };
                    const tagLine = (raw: string) => {
                      const t = typeof raw === "string" ? raw.trim() : "";
                      return t ? `[${t.toUpperCase()}]` : "";
                    };
                    const nameLine = (
                      label: string,
                      p: { ingameName: string; clanTag: string; clanColor: string | null } | undefined
                    ) => (
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
                        <div
                          className="text-foreground font-medium truncate"
                          style={p?.clanColor ? { color: normColor(p.clanColor) ?? undefined } : undefined}
                        >
                          {p?.ingameName?.trim() || "—"}{" "}
                          <span className="text-muted-foreground font-normal">{tagLine(p?.clanTag ?? "")}</span>
                        </div>
                      </div>
                    );
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {nameLine("Challenger", ch)}
                        {nameLine("Opponent", op)}
                      </div>
                    );
                  })()}

                  {onev1.status === "running" && onev1.match.state && typeof onev1.match.state === "object" ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">Bracket</div>
                      {(() => {
                        const s = onev1.match.state as Record<string, unknown>;
                        const roundWinners = Array.isArray(s.roundWinners)
                          ? (s.roundWinners as ("challenger" | "opponent")[])
                          : [];
                        const currentRound = typeof s.round === "number" ? s.round : null;
                        const between = Boolean(s.betweenRounds);
                        const sc = typeof s.scoreChallenger === "number" ? s.scoreChallenger : null;
                        const so = typeof s.scoreOpponent === "number" ? s.scoreOpponent : null;
                        const cumAfter = (upToRound: number) => {
                          let ca = 0;
                          let cb = 0;
                          for (let i = 0; i < upToRound && i < roundWinners.length; i++) {
                            if (roundWinners[i] === "challenger") ca++;
                            else if (roundWinners[i] === "opponent") cb++;
                          }
                          return `${ca}–${cb}`;
                        };
                        return (
                          <div className="grid gap-2">
                            {[1, 2, 3].map((rn) => {
                              const w = roundWinners[rn - 1];
                              const done = Boolean(w);
                              const isLive =
                                !between && currentRound === rn && onev1.status === "running" && !done;
                              let center: ReactNode = "—";
                              if (isLive) {
                                center = (
                                  <span className="text-primary font-semibold tabular-nums">
                                    Live
                                    {sc != null && so != null ? (
                                      <span className="text-muted-foreground font-normal">
                                        {" "}
                                        · {sc}–{so}
                                      </span>
                                    ) : null}
                                  </span>
                                );
                              } else if (done) {
                                center = (
                                  <span className="text-muted-foreground font-mono tabular-nums">{cumAfter(rn)}</span>
                                );
                              }
                              return (
                                <div
                                  key={rn}
                                  className={`rounded-md border border-border bg-background/30 p-2 text-sm ${
                                    isLive ? "ring-1 ring-primary/60" : ""
                                  }`}
                                >
                                  <div className="text-muted-foreground text-xs">Round {rn}</div>
                                  <div className="mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                    {center}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  ) : onev1.status === "pending" ? (
                    <>
                      {myDiscordUserId &&
                      onev1.match &&
                      String((onev1.match as { opponentDiscordId?: string }).opponentDiscordId) === String(myDiscordUserId) ? (
                        <div className="flex flex-col sm:flex-row gap-2 pt-1">
                          <Button
                            type="button"
                            className="bg-emerald-600 hover:bg-emerald-500 text-white"
                            disabled={onev1Busy}
                            onClick={() => void doOneV1MatchAction("accept")}
                          >
                            Accept
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={onev1Busy}
                            onClick={() => void doOneV1MatchAction("duck")}
                          >
                            🦆 Duck
                          </Button>
                        </div>
                      ) : myDiscordUserId &&
                        onev1.match &&
                        String((onev1.match as { challengerDiscordId?: string }).challengerDiscordId) ===
                          String(myDiscordUserId) ? (
                        <div className="text-xs text-muted-foreground">
                          Waiting for your opponent to accept or duck. You’ll get a site notification when they respond.
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Only the challenger and opponent see accept/duck actions on this page.
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              ) : events && onev1.configured && !onev1.enabled ? (
                <div className="mt-3 text-sm text-amber-500/90">1v1 is turned off in server settings.</div>
              ) : events && !onev1.configured ? (
                <div className="mt-3 text-sm text-muted-foreground">Admins can enable this with `/onev1-setup` in Discord.</div>
              ) : null}
              {events && onev1.ended ? (
                <div className="mt-3 text-sm text-muted-foreground">
                  Last result kept for{" "}
                  <span className="text-foreground font-semibold">10 minutes</span>. Start the next duel from Discord or
                  Nominate here.
                </div>
              ) : null}
            </div>

            <div
              className={cn(
                "rounded-lg border p-4 transition-shadow",
                events?.dockedCargo?.active
                  ? "border-cyan-500/50 bg-gradient-to-br from-cyan-500/15 via-background/80 to-violet-500/10 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
                  : "border-border bg-background/40"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-rajdhani font-bold text-foreground tracking-wide">DOCKED CARGO</div>
                <span className={cn("text-xs shrink-0", neonEventStatusClass(dockedCargoStatusLabel))}>
                  {dockedCargoStatusLabel}
                </span>
              </div>
              {events?.dockedCargo?.active ? (
                <div className="mt-3 rounded-md border border-cyan-400/30 bg-cyan-500/[0.08] px-3 py-2.5">
                  <p className="text-sm font-rajdhani font-semibold text-cyan-200/95 tracking-wide">
                    Cargo is docked — contest it in-game now.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    Ship is stopped at your configured coords. When the timer ends it will undock automatically.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {events?.dockedCargo?.configured
                    ? "Automation is configured. When a run starts, status flips to Active here."
                    : "Admins configure this in Discord or the admin panel."}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="flex items-center justify-between">
                <div className="font-rajdhani font-bold text-foreground">MAZE EVENT</div>
                <span className={cn("text-xs", neonEventStatusClass(mazeStatusLabel))}>{mazeStatusLabel}</span>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                Joined: <span className="text-foreground font-semibold">{events?.maze.joined ?? "—"}</span>
                {typeof events?.maze.spawnPointsTotal === "number" ? (
                  <span className="ml-2">
                    Spawns: <span className="text-foreground font-semibold">{events?.maze.joined ?? 0}</span>/
                    {events.maze.spawnPointsTotal}
                  </span>
                ) : null}
              </div>
              {events?.maze.status && events.maze.status !== "none" ? (
                <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  {myDiscordUserId && events.maze.participants.some((p) => String(p.discordUserId) === String(myDiscordUserId)) ? (
                    <Button
                      variant="destructive"
                      className="w-full sm:w-auto"
                      disabled={Boolean(eventBusy.maze)}
                      onClick={() => doEventLeave("maze")}
                    >
                      {eventBusy.maze ? "Leaving…" : "Leave"}
                    </Button>
                  ) : (
                    <Button
                      className="w-full sm:w-auto"
                      disabled={Boolean(eventBusy.maze)}
                      onClick={() => doEventJoin("maze")}
                    >
                      {eventBusy.maze ? "Joining…" : "Join"}
                    </Button>
                  )}
                  {!isLinked ? (
                    <div className="text-xs text-muted-foreground sm:ml-2">
                      Link required to join.
                    </div>
                  ) : null}
                </div>
              ) : null}
              {eventError.maze ? (
                <div className="mt-2 text-xs text-destructive">{eventError.maze}</div>
              ) : null}
              {events?.maze.status && events.maze.status !== "none" ? (
                <div className="mt-3 space-y-1">
                  {events.maze.participants.slice(0, 10).map((p) => (
                    <div key={p.discordUserId} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">
                        {p.ingameName} <span className="text-muted-foreground">[{p.clanName}]</span>
                      </span>
                      <span className="text-muted-foreground">Spawn {p.spawnNumber}</span>
                    </div>
                  ))}
                </div>
              ) : events?.maze.ended ? (
                <div className="mt-3 space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Status: <span className="text-foreground font-semibold">Ended</span> (kept for 10 minutes)
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => openEventLeaderboard("Maze Event Leaderboard", events?.maze.ended?.payload)}
                  >
                    Event Leaderboard
                  </Button>
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  {events ? "There are no live events now." : "Loading event status…"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Leaderboard */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-rajdhani">
              <Trophy className="h-4 w-4 text-primary" />
              Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard?.leaderboard?.length ? (
              <div className="space-y-3">
                {/* Podium */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { rank: 2, rowIndex: 1 },
                    { rank: 1, rowIndex: 0 },
                    { rank: 3, rowIndex: 2 },
                  ].map(({ rank, rowIndex }) => {
                    const row = leaderboard.leaderboard[rowIndex];
                    const color =
                      rank === 1
                        ? "bg-yellow-500/10 border-yellow-500/30"
                        : rank === 2
                          ? "bg-slate-400/10 border-slate-400/30"
                          : "bg-amber-700/10 border-amber-700/30";
                    if (!row) return <div key={rank} className="rounded-lg border border-border bg-muted/20 p-4" />;
                    return (
                      <div key={rank} className={`rounded-lg border ${color} p-4 text-center`}>
                        <div className="text-xs text-muted-foreground">#{rank}</div>
                        <div className="mt-1 font-rajdhani font-bold text-foreground truncate">{row.ingameName}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{row.kills} kills</div>
                      </div>
                    );
                  })}
                </div>
                {/* Top 12 list */}
                <div className="space-y-1">
                  {leaderboard.leaderboard.map((p, i) => (
                    <div key={p.discordUserId} className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${i % 2 === 0 ? "bg-muted/30" : ""}`}>
                      <div className="flex items-center gap-3">
                        <span className="w-8 text-center text-muted-foreground">#{i + 1}</span>
                        <span className="text-foreground font-medium">{p.ingameName}</span>
                      </div>
                      <span className="font-mono text-muted-foreground">{p.kills}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No leaderboard data yet.</div>
            )}
          </CardContent>
        </Card>

        {/* My Stats */}
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-rajdhani">
              <User className="h-4 w-4 text-primary" />
              My Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myStats && myStats.ok && "linked" in myStats && !myStats.linked ? (
              <div className="flex flex-col gap-3">
                <div className="text-sm text-muted-foreground">
                  You must link before you can start tracking your stats.
                </div>
                <div>
                  <Button onClick={() => { setLinkError(null); setLinkOpen(true); }}>
                    Link Now
                  </Button>
                </div>
              </div>
            ) : myStats && myStats.ok && "linked" in myStats && myStats.linked ? (
              <div className="grid gap-3 md:grid-cols-3">
                <StatCard label="Kills" value={myStats.kills} />
                <StatCard label="Deaths" value={myStats.deaths} />
                <StatCard label="KD Ratio" value={myStats.kdRatio} hero />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Loading…</div>
            )}
          </CardContent>
        </Card>

        <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-rajdhani">Link your in-game name</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Enter your Rust name" />
              {linkError ? <div className="text-sm text-destructive">{linkError}</div> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLinkOpen(false)} disabled={linkBusy}>
                Cancel
              </Button>
              <Button onClick={submitLink} disabled={linkBusy || !linkName.trim()}>
                {linkBusy ? "Linking…" : "Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={eventLbOpen} onOpenChange={setEventLbOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="font-rajdhani">{eventLbTitle}</DialogTitle>
            </DialogHeader>
            {eventLbPayload && (eventLbPayload as any).kind === "maze"
              ? renderMazeSnapshot(eventLbPayload)
              : eventLbPayload && (eventLbPayload as any).kind === "koth"
                ? renderKothSnapshot(eventLbPayload)
                : <div className="text-sm text-muted-foreground">No snapshot data.</div>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEventLbOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={nominateOpen}
          onOpenChange={(o) => {
            setNominateOpen(o);
            if (!o) {
              setNominateStep("list");
              setNominatePick(null);
            }
          }}
        >
          <DialogContent className="w-[95vw] max-w-md border-violet-500/20 bg-background/95">
            <DialogHeader>
              <DialogTitle className="font-rajdhani">
                {nominateStep === "confirm" ? "Confirm nomination" : "Nominate opponent"}
              </DialogTitle>
            </DialogHeader>
            {nominateStep === "list" ? (
              <div className="space-y-2">
                {nominateLoading ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">Loading players…</div>
                ) : nominateCandidates.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4">
                    No eligible players found — they must be linked, in a clan, and not in another event.
                  </div>
                ) : (
                  <ScrollArea className="h-[min(360px,50vh)] pr-2">
                    <div className="space-y-1">
                      {nominateCandidates.map((c) => (
                        <button
                          key={c.discordUserId}
                          type="button"
                          className="w-full flex items-center gap-3 rounded-lg border border-border/80 bg-background/50 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                          onClick={() => {
                            setNominatePick(c);
                            setNominateStep("confirm");
                          }}
                        >
                          <img
                            src={c.avatarUrl}
                            alt=""
                            className="h-10 w-10 rounded-full shrink-0 border border-border"
                          />
                          <span className="text-sm font-medium text-foreground truncate">{c.displayName}</span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {nominatePick ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={nominatePick.avatarUrl}
                      alt=""
                      className="h-12 w-12 rounded-full border border-violet-500/30"
                    />
                    <div>
                      You want to nominate <span className="font-semibold text-foreground">{nominatePick.displayName}</span>.
                      Is this correct?
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              {nominateStep === "confirm" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setNominateStep("list")} disabled={onev1Busy}>
                    No, go back
                  </Button>
                  <Button
                    type="button"
                    className="bg-violet-600 hover:bg-violet-500 text-white"
                    disabled={onev1Busy || !nominatePick}
                    onClick={() => void confirmNominate()}
                  >
                    {onev1Busy ? "Sending…" : "Yes, nominate"}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" onClick={() => setNominateOpen(false)}>
                  Close
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={clanOpen} onOpenChange={setClanOpen}>
          <DialogContent className="w-[95vw] max-w-lg sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-rajdhani">Clan System</DialogTitle>
            </DialogHeader>

            {clanError ? <div className="text-sm text-destructive">{clanError}</div> : null}

            {clanMe && (clanMe as any).inClan === true ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-rajdhani font-bold text-foreground truncate">
                        {(clanMe as any).clan.clanName}{" "}
                        <span className="text-muted-foreground">[{(clanMe as any).clan.clanTag ?? "----"}]</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Members: <span className="text-foreground font-semibold">{(clanMe as any).members.length}</span>
                      </div>
                    </div>
                    <div className="flex w-full sm:w-auto flex-col sm:flex-row gap-2">
                      <Button variant="outline" onClick={doInviteClan}>
                        Invite members
                      </Button>
                      <Button variant="outline" onClick={doLeaveClan}>
                        Leave clan
                      </Button>
                    </div>
                  </div>
                  {inviteCode ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                      Invite code: <span className="font-mono text-foreground font-semibold">{inviteCode}</span>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-background/40 p-4">
                    <div className="font-rajdhani font-bold text-foreground mb-2">Members</div>
                    <div className="space-y-2 max-h-72 overflow-auto pr-1">
                      {(clanMe as any).members.map((m: any) => (
                        <div
                          key={m.discordUserId}
                          className="flex flex-col sm:flex-row sm:items-center items-start justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              className="h-8 w-8 rounded-full border border-border"
                              alt="avatar"
                              src={m.avatarUrl}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{m.ingameName}</div>
                              <div className="text-xs text-muted-foreground">{"<@"}{m.discordUserId}{">"}</div>
                            </div>
                          </div>
                          {isClanOwner ? (
                            <div className="flex w-full sm:w-auto flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <Button size="sm" variant="outline" onClick={() => doPromote(m.discordUserId)}>
                                Promote
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => doKick(m.discordUserId)}>
                                Kick
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background/40 p-4">
                    <div className="font-rajdhani font-bold text-foreground mb-2">Clan stats</div>
                    {clanStats?.ok ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <StatCard label="Kills" value={clanStats.totalKills} />
                          <StatCard label="Deaths" value={clanStats.totalDeaths} />
                          <StatCard label="KD Ratio" value={clanStats.kdRatio} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {[
                            { rank: 2, rowIndex: 1 },
                            { rank: 1, rowIndex: 0 },
                            { rank: 3, rowIndex: 2 },
                          ].map(({ rank, rowIndex }) => {
                            const row = clanStats.top3[rowIndex];
                            const color =
                              rank === 1
                                ? "bg-yellow-500/10 border-yellow-500/30"
                                : rank === 2
                                  ? "bg-slate-400/10 border-slate-400/30"
                                  : "bg-amber-700/10 border-amber-700/30";
                            if (!row)
                              return (
                                <div key={rank} className="rounded-lg border border-border bg-muted/20 p-4" />
                              );
                            return (
                              <div key={rank} className={`rounded-lg border ${color} p-4 text-center`}>
                                <div className="text-xs text-muted-foreground">#{rank}</div>
                                <div className="mt-1 font-rajdhani font-bold text-foreground truncate">
                                  {row.ingameName}
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">{row.kills} kills</div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Total members: <span className="text-foreground font-semibold">{clanStats.totalMembers}</span>
                        </div>

                        <div className="pt-2">
                          <div className="font-rajdhani font-bold text-foreground mb-2">Leaderboard</div>
                          <div className="space-y-1">
                            {(clanStats.leaderboard ?? []).map((p, i) => (
                              <div
                                key={p.discordUserId}
                                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                                  i % 2 === 0 ? "bg-muted/30" : ""
                                } ${i < 3 ? "bg-primary/5" : ""}`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="w-8 text-center text-muted-foreground">#{i + 1}</span>
                                  <span className="truncate text-foreground font-medium">{p.ingameName}</span>
                                </div>
                                <span className="font-mono text-muted-foreground">{p.kills}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Loading…</div>
                    )}
                  </div>
                </div>

                {isClanOwner ? (
                  <div className="rounded-lg border border-border bg-background/40 p-4">
                    <div className="font-rajdhani font-bold text-foreground mb-2">Danger zone</div>
                    <div className="text-sm text-muted-foreground">
                      To delete your clan, type <span className="font-mono text-foreground">DELETE</span> below.
                    </div>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        value={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.value)}
                        placeholder="Type DELETE"
                      />
                      <Button
                        variant="destructive"
                        disabled={deleteBusy || deleteConfirm !== "DELETE"}
                        onClick={doDeleteClan}
                      >
                        Delete clan
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <div className="font-rajdhani font-bold text-foreground">Choose an option</div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button onClick={() => setCreateClanOpen(true)}>Create a Clan</Button>
                    <Button variant="outline" onClick={() => setJoinClanOpen(true)}>
                      Join a clan
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setClanOpen(false)}>
                Close
              </Button>
            </DialogFooter>

            <Dialog open={createClanOpen} onOpenChange={setCreateClanOpen}>
              <DialogContent className="w-[95vw] max-w-md">
                <DialogHeader>
                  <DialogTitle className="font-rajdhani">Create a Clan</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">What would you like to name your Clan?</div>
                    <Input value={clanName} onChange={(e) => setClanName(e.target.value)} placeholder="Clan name" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">What would you like your Clan Tag to be? (4 letters)</div>
                    <Input value={clanTag} onChange={(e) => setClanTag(e.target.value.toUpperCase())} placeholder="TAGG" maxLength={4} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">What would you like your clan color to be?</div>
                    <div className="max-h-40 overflow-auto rounded-md border border-border bg-background/40 p-2">
                      <div className="grid grid-cols-2 gap-2">
                        {COLORS.map((c) => (
                          <button
                            key={c.key}
                            onClick={() => setClanColor(c.key)}
                            className={`rounded-md border px-3 py-2 text-sm text-left ${
                              clanColor === c.key
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted/30"
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateClanOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={doCreateClan} disabled={!clanName.trim() || !/^[A-Z]{4}$/.test(clanTag.trim())}>
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={joinClanOpen} onOpenChange={setJoinClanOpen}>
              <DialogContent className="w-[95vw] max-w-md">
                <DialogHeader>
                  <DialogTitle className="font-rajdhani">Join a clan</DialogTitle>
                </DialogHeader>
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Enter the 4 digit clan invite code.</div>
                  <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="0000" maxLength={4} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setJoinClanOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={doJoinClan} disabled={!/^\d{4}$/.test(joinCode.trim())}>
                    Join
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default ServerDetail;
