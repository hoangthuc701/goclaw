import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderData, ProviderInput } from "./hooks/use-providers";
import { slugify, isValidSlug } from "@/lib/slug";
import { PROVIDER_TYPES } from "@/constants/providers";
import { OAuthSection } from "./provider-oauth-section";
import { CLISection } from "./provider-cli-section";

interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderData | null; // null = create mode
  onSubmit: (data: ProviderInput) => Promise<unknown>;
  existingProviders?: ProviderData[];
}

export function ProviderFormDialog({ open, onOpenChange, provider, onSubmit, existingProviders = [] }: ProviderFormDialogProps) {
  const isEdit = !!provider;
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [providerType, setProviderType] = useState("openai_compat");
  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Only one Claude CLI provider allowed per instance
  const hasClaudeCLI = !isEdit && existingProviders.some((p) => p.provider_type === "claude_cli");

  const isOAuth = providerType === "chatgpt_oauth";
  const isCLI = providerType === "claude_cli";

  useEffect(() => {
    if (open) {
      setError("");
      if (provider) {
        setName(provider.name);
        setDisplayName(provider.display_name || "");
        setProviderType(provider.provider_type);
        setApiBase(provider.api_base || "");
        setApiKey(provider.api_key || "");
        setEnabled(provider.enabled);
      } else {
        setName("");
        setDisplayName("");
        setProviderType("openai_compat");
        setApiBase("");
        setApiKey("");
        setEnabled(true);
      }
    }
  }, [open, provider]);

  const handleSubmit = async () => {
    if (!name.trim() || !providerType) return;
    setLoading(true);
    try {
      const data: ProviderInput = {
        name: name.trim(),
        display_name: displayName.trim() || undefined,
        provider_type: providerType,
        api_base: apiBase.trim() || undefined,
        enabled,
      };

      // Only include api_key if it's a real value (not the mask)
      if (apiKey && apiKey !== "***") {
        data.api_key = apiKey;
      }

      await onSubmit(data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Provider" : "Add Provider"}</DialogTitle>
          <DialogDescription>Configure an LLM provider connection.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 overflow-y-auto min-h-0">
          {/* Provider type selector — always shown in create mode */}
          {!isEdit && (
            <ProviderTypeSelect
              value={providerType}
              hasClaudeCLI={hasClaudeCLI}
              onChange={(v) => {
                setProviderType(v);
                const preset = PROVIDER_TYPES.find((t) => t.value === v);
                setApiBase(preset?.apiBase || "");
                if (v === "chatgpt_oauth") {
                  setName("openai-codex");
                  setDisplayName("ChatGPT (OAuth)");
                } else {
                  if (name === "openai-codex") setName("");
                  if (displayName === "ChatGPT (OAuth)") setDisplayName("");
                }
              }}
            />
          )}

          {isOAuth ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value="openai-codex" disabled />
                </div>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input value="ChatGPT (OAuth)" disabled />
                </div>
              </div>
              <OAuthSection onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["providers"] }); onOpenChange(false); }} />
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(slugify(e.target.value))}
                    placeholder="e.g. openrouter"
                    disabled={isEdit}
                  />
                  <p className="text-xs text-muted-foreground">Lowercase, numbers, hyphens</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="OpenRouter"
                  />
                </div>
              </div>

              {isEdit && (
                <div className="space-y-2">
                  <Label>Provider Type *</Label>
                  <Select value={providerType} onValueChange={setProviderType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_TYPES.filter((t) => t.value !== "chatgpt_oauth").map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Claude CLI section */}
              {isCLI && <CLISection open={open} />}

              {/* Standard provider fields (not shown for Claude CLI) */}
              {!isCLI && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="apiBase">API Base URL</Label>
                    <Input
                      id="apiBase"
                      value={apiBase}
                      onChange={(e) => setApiBase(e.target.value)}
                      placeholder={PROVIDER_TYPES.find((t) => t.value === providerType)?.placeholder || PROVIDER_TYPES.find((t) => t.value === providerType)?.apiBase || "https://api.example.com/v1"}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="apiKey">API Key</Label>
                    <Input
                      id="apiKey"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={isEdit ? "Leave as-is or enter new key" : "sk-..."}
                    />
                    {isEdit && apiKey === "***" && (
                      <p className="text-xs text-muted-foreground">
                        API key is set. Clear and type a new value to change it.
                      </p>
                    )}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between">
                <Label htmlFor="enabled">Enabled</Label>
                <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {isOAuth ? "Close" : "Cancel"}
          </Button>
          {!isOAuth && (
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || !isValidSlug(name) || !providerType || loading}
            >
              {loading ? (isEdit ? "Saving..." : "Creating...") : isEdit ? "Save" : "Create"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Provider type select dropdown ---

function ProviderTypeSelect({ value, hasClaudeCLI, onChange }: {
  value: string;
  hasClaudeCLI: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Provider Type *</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDER_TYPES.map((t) => (
            <SelectItem
              key={t.value}
              value={t.value}
              disabled={t.value === "claude_cli" && hasClaudeCLI}
            >
              {t.label}
              {t.value === "claude_cli" && hasClaudeCLI && (
                <span className="ml-1 text-xs opacity-60">(already added)</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
