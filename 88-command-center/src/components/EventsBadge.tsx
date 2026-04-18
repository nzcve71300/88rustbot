import { Crown, Truck, Grid3X3, Package, Plane, Zap } from "lucide-react";
import type { GameEvent } from "@/data/mockData";

const iconMap: Record<string, React.ElementType> = {
  crown: Crown,
  truck: Truck,
  grid3x3: Grid3X3,
  package: Package,
  plane: Plane,
};

const EventsBadge = ({ event }: { event: GameEvent }) => {
  const Icon = iconMap[event.icon] || Zap;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5 text-sm font-medium text-primary">
      <Icon className="h-3.5 w-3.5" />
      {event.name}
    </span>
  );
};

export default EventsBadge;
