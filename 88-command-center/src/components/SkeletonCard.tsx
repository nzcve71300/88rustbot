const SkeletonCard = () => (
  <div className="min-w-[280px] w-full rounded-lg border-l-4 border-l-muted border border-border bg-card p-5 animate-pulse">
    <div className="flex justify-between mb-3">
      <div className="h-5 w-32 rounded bg-muted" />
      <div className="h-4 w-16 rounded bg-muted" />
    </div>
    <div className="flex gap-1.5 mb-4">
      <div className="h-5 w-10 rounded bg-muted" />
      <div className="h-5 w-16 rounded bg-muted" />
      <div className="h-5 w-14 rounded bg-muted" />
    </div>
    <div className="h-4 w-20 rounded bg-muted" />
  </div>
);

export default SkeletonCard;
