interface StatCardProps {
  label: string;
  value: string | number;
  hero?: boolean;
}

const StatCard = ({ label, value, hero }: StatCardProps) => (
  <div className={`rounded-lg border border-border bg-muted/30 p-4 text-center ${hero ? "col-span-full" : ""}`}>
    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
    <p className={`font-rajdhani font-bold ${hero ? "text-4xl text-primary text-glow" : "text-2xl text-foreground"}`}>
      {value}
    </p>
  </div>
);

export default StatCard;
