import { useState, useEffect, useMemo } from "react";
import ServerCard from "@/components/ServerCard";
import SkeletonCard from "@/components/SkeletonCard";
import AnimatedSearchBar from "@/components/AnimatedSearchBar";
import { Server } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { useQuery } from "@tanstack/react-query";
import { fetchServers } from "@/lib/servers";

const Home = () => {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

  const { data: servers = [], isLoading: loadingServers } = useQuery({
    queryKey: ["servers"],
    queryFn: fetchServers,
    retry: false,
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return servers;
    const q = search.toLowerCase();
    return servers.filter(
      (s) =>
        (s.hostnamePlain || s.nickname).toLowerCase().includes(q) ||
        s.nickname.toLowerCase().includes(q)
    );
  }, [search, servers]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="container flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Server className="h-4 w-4" />
            <span>{servers.length} servers</span>
          </div>

          <h1 className="text-3xl font-rajdhani font-bold text-primary">88</h1>

          <UserMenu />
        </div>
      </header>

      <main className="container py-8">
        <div className="mb-6 animate-fade-in">
          <h2 className="text-2xl font-rajdhani font-bold text-foreground">Your Servers</h2>
          <p className="text-sm text-muted-foreground mb-4">Select a server to view details</p>
          <AnimatedSearchBar
            value={search}
            onChange={setSearch}
            suggestionNames={servers.map((s) => s.hostnamePlain || s.nickname)}
          />
        </div>

        <div className="flex flex-col gap-3">
          {loading || loadingServers ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : filtered.length > 0 ? (
            filtered.map((server, i) => (
              <ServerCard key={server.id} server={server} index={i} />
            ))
          ) : (
            <div className="py-12 text-center text-muted-foreground text-sm animate-fade-in">
              No servers match "{search}"
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Home;
