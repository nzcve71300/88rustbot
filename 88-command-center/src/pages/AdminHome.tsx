import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Server, Shield } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { fetchAdminEligible } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const AdminHome = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-eligible"],
    queryFn: fetchAdminEligible,
  });

  const servers =
    data?.ok && data.guilds
      ? data.guilds.flatMap((g) =>
          g.rustServers.map((s) => ({
            ...s,
            guildName: g.name,
            iconUrl: g.iconUrl,
          }))
        )
      : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="container flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/"
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
              aria-label="Home"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <Shield className="h-5 w-5 shrink-0 text-primary" />
              <h1 className="text-xl font-rajdhani font-bold text-foreground truncate">Admin Panel</h1>
            </div>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="container py-8 max-w-3xl">
        <p className="text-sm text-muted-foreground mb-6">
          Choose a Rust server where you have the bot admin role. Actions only apply to that Discord&apos;s community.
        </p>

        {isLoading ? (
          <div className="rounded-lg border border-border bg-card p-8 animate-pulse h-40" />
        ) : servers.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="font-rajdhani">No servers</CardTitle>
              <CardDescription>No admin access found, or no Rust servers in those Discords.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {servers.map((s) => (
              <Card key={`${s.guildName}-${s.id}`} className="transition-colors hover:border-primary/40">
                <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {s.iconUrl ? (
                      <img src={s.iconUrl} alt="" className="h-10 w-10 rounded-full border border-border shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                    )}
                    <div className="min-w-0">
                      <CardTitle className="text-base font-rajdhani truncate">{s.nickname}</CardTitle>
                      <CardDescription className="truncate">{s.guildName}</CardDescription>
                    </div>
                  </div>
                  <Button asChild size="sm" className="shrink-0">
                    <Link to={`/admin/server/${s.id}/koth`}>
                      <Server className="h-4 w-4 mr-1.5" />
                      Open
                    </Link>
                  </Button>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminHome;
