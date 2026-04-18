import { useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { ArrowLeft, Menu, Shield } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const CATS = [
  { to: "koth", label: "KOTH System" },
  { to: "maze", label: "MAZE System" },
  { to: "nuketown", label: "NUKETOWN System" },
  { to: "onev1", label: "1V1 System" },
  { to: "clan", label: "Clan System" },
] as const;

const AdminServerLayout = () => {
  const { serverId } = useParams();
  const [open, setOpen] = useState(false);
  const base = `/admin/server/${serverId}`;

  const NavItems = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1">
      {CATS.map((c) => (
        <NavLink
          key={c.to}
          to={`${base}/${c.to}`}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )
          }
        >
          {c.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 py-3 md:px-8 shrink-0">
        <div className="container flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              to="/admin"
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
              aria-label="Admin servers"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="md:hidden shrink-0" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(100%,280px)]">
                <SheetHeader>
                  <SheetTitle className="font-rajdhani text-left">Systems</SheetTitle>
                </SheetHeader>
                <div className="mt-6">
                  <NavItems onNavigate={() => setOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2 min-w-0">
              <Shield className="h-5 w-5 text-primary shrink-0 hidden sm:block" />
              <span className="text-sm text-muted-foreground truncate">
                Server <span className="text-foreground font-mono">#{serverId}</span>
              </span>
            </div>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex w-56 shrink-0 border-r border-border flex-col p-4 gap-2 bg-card/30">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">Categories</p>
          <NavItems />
        </aside>
        <main className="flex-1 min-w-0 overflow-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminServerLayout;
