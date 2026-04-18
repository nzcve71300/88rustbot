import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SystemPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-rajdhani">{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Web actions for this system are not wired yet — use the matching Discord admin commands in your server for now.
      </CardContent>
    </Card>
  );
}
