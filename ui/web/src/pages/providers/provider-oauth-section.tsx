import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ExternalLink, CheckCircle, ClipboardPaste } from "lucide-react";
import { useHttp } from "@/hooks/use-ws";
import { toast } from "@/stores/use-toast-store";

interface OAuthStatus {
  authenticated: boolean;
  provider_name?: string;
  error?: string;
}

interface StartResponse {
  auth_url?: string;
  status?: string;
}

export function OAuthSection({ onSuccess }: { onSuccess: () => void }) {
  const http = useHttp();
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [waitingCallback, setWaitingCallback] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justAuthenticated, setJustAuthenticated] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await http.get<OAuthStatus>("/v1/auth/openai/status");
      setStatus(res);
      return res;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [http]);

  useEffect(() => {
    fetchStatus();
    return stopPolling;
  }, [fetchStatus]);

  // Countdown timer — auto-close dialog after auth success
  useEffect(() => {
    if (!justAuthenticated) return;
    setCountdown(3);
    const iv = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(iv);
          onSuccess();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [justAuthenticated, onSuccess]);

  const showSuccess = () => {
    setWaitingCallback(false);
    setJustAuthenticated(true);
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await http.post<StartResponse>("/v1/auth/openai/start");
      if (res.status === "already_authenticated") {
        await fetchStatus();
        showSuccess();
        return;
      }
      if (res.auth_url) {
        window.open(res.auth_url, "_blank", "noopener,noreferrer");
        setWaitingCallback(true);
        setPasteUrl("");
        pollRef.current = setInterval(async () => {
          const s = await fetchStatus();
          if (s?.authenticated) {
            stopPolling();
            showSuccess();
          }
        }, 2000);
        timeoutRef.current = setTimeout(() => {
          stopPolling();
          setWaitingCallback(false);
        }, 6 * 60 * 1000);
      }
    } catch (err) {
      toast.error("OAuth failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setStarting(false);
    }
  };

  const handlePasteSubmit = async () => {
    const url = pasteUrl.trim();
    if (!url) return;
    setSubmitting(true);
    try {
      await http.post("/v1/auth/openai/callback", { redirect_url: url });
      stopPolling();
      setPasteUrl("");
      await fetchStatus();
      showSuccess();
    } catch (err) {
      toast.error("Exchange failed", err instanceof Error ? err.message : "Invalid redirect URL");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await http.post("/v1/auth/openai/logout");
      setStatus({ authenticated: false });
      toast.success("Logged out", "OpenAI OAuth token removed");
    } catch (err) {
      toast.error("Logout failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking authentication status...
      </div>
    );
  }

  // Just authenticated — show success with countdown
  if (justAuthenticated) {
    return (
      <div className="space-y-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Authentication successful!</p>
            <p className="text-xs mt-0.5 opacity-80">
              Provider <code className="rounded bg-muted px-1 font-mono text-xs">openai-codex</code> is
              now active. Closing in {countdown}s...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Already authenticated (opened dialog when already authed)
  if (status?.authenticated) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>
            Authenticated — provider <code className="rounded bg-muted px-1 font-mono text-xs">openai-codex</code> active
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Use model prefix <code className="rounded bg-muted px-1 font-mono">openai-codex/</code> in
          agent config (e.g. openai-codex/gpt-4o). Token refreshes automatically.
        </p>
        <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
          Remove Token
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sign in with your ChatGPT account to use your subscription's models
        without a separate API key.
      </p>
      {waitingCallback ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-sm text-blue-700 dark:text-blue-400">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>Waiting for authentication... Complete sign-in in the opened window.</span>
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <strong>Remote/VPS?</strong> After signing in, your browser will try to open{" "}
              <code className="text-xs">localhost:1455</code> and show a{" "}
              <strong>&quot;Can&apos;t reach this page&quot;</strong> error.
              That&apos;s normal — <strong>copy the full URL from the browser address bar</strong> and paste it below.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePasteSubmit()}
                className="text-xs font-mono h-8"
              />
              <Button
                size="sm"
                onClick={handlePasteSubmit}
                disabled={submitting || !pasteUrl.trim()}
                className="gap-1.5 shrink-0 h-8"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
                Submit
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={handleStart} disabled={starting} className="gap-1.5">
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          {starting ? "Starting..." : "Sign in with ChatGPT"}
        </Button>
      )}
    </div>
  );
}
