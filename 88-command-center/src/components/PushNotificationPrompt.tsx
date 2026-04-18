import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/lib/auth";
import {
  fetchPushEligible,
  getExistingPushSubscription,
  getNotifyPromptStatus,
  markNotifyPromptComplete,
  markNotifyPromptDismissed,
  pushApisSupported,
  subscribeToPushNotifications,
} from "@/lib/pushNotifications";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const PROMPT_DELAY_MS = 900;

function dispatchPushSubscriptionChanged(): void {
  window.dispatchEvent(new Event("grindset-push-subscription-changed"));
}

export function PushNotificationPrompt() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false, staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me?.ok) return;
    let cancelled = false;

    void (async () => {
      if (!pushApisSupported()) return;
      if (getNotifyPromptStatus() !== "none") return;

      const existing = await getExistingPushSubscription();
      if (existing) {
        markNotifyPromptComplete();
        return;
      }

      const el = await fetchPushEligible();
      if (!el.ok || !el.linked) return;

      await new Promise((r) => setTimeout(r, PROMPT_DELAY_MS));
      if (cancelled) return;
      if (getNotifyPromptStatus() !== "none") return;
      setOpen(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [me?.ok]);

  async function onEnable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        markNotifyPromptDismissed();
        setOpen(false);
        return;
      }
      const result = await subscribeToPushNotifications();
      if (result.ok) {
        markNotifyPromptComplete();
        dispatchPushSubscriptionChanged();
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }

  function onNotNow() {
    markNotifyPromptDismissed();
    setOpen(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={() => {
          markNotifyPromptDismissed();
          setOpen(false);
        }}
        onPointerDownOutside={() => {
          markNotifyPromptDismissed();
          setOpen(false);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="font-rajdhani">Enable event notifications?</AlertDialogTitle>
          <AlertDialogDescription>
            Get alerted when KOTH, Maze, or Nuketown starts. You only link once per Discord — that covers every Rust
            server there.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={onNotNow}>
            Not now
          </Button>
          <Button type="button" disabled={busy} onClick={onEnable}>
            {busy ? "…" : "Allow notifications"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
