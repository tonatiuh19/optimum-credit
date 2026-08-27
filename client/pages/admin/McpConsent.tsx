import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { approveMcpConsent } from "@/store/slices/adminMcpSlice";
import { logger } from "@/utils/logger";

/**
 * OAuth consent for remote MCP (Cursor / Claude Desktop).
 * Opened by /api/mcp/oauth/authorize after PKCE params are validated.
 * Must be behind RequireStaff so login returns here via location.state.from.
 */
export default function AdminMcpConsent() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [params] = useSearchParams();
  const user = useAppSelector((s) => s.adminAuth.user);
  const { consentBusy, error } = useAppSelector((s) => s.adminMcp);

  const oauth = useMemo(
    () => ({
      client_id: params.get("client_id") || "",
      redirect_uri: params.get("redirect_uri") || "",
      code_challenge: params.get("code_challenge") || "",
      code_challenge_method: params.get("code_challenge_method") || "S256",
      scope: params.get("scope") || "admin_ai.read",
      resource: params.get("resource") || "",
      state: params.get("state") || "",
    }),
    [params],
  );

  const missing =
    !oauth.client_id || !oauth.redirect_uri || !oauth.code_challenge;

  const submit = (approve: boolean) => {
    if (missing) return;
    void dispatch(approveMcpConsent({ ...oauth, approve }))
      .unwrap()
      .then((redirectTo) => {
        window.location.href = redirectTo;
      })
      .catch((e) => logger.warn("mcp consent failed", e));
  };

  if (missing) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-card p-6 text-sm text-destructive">
          {t("adminMcp.invalidRequest")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-10">
      <div className="max-w-lg w-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="bg-primary/5 border-b border-border px-6 py-5 flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {t("adminMcp.consentTitle")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("adminMcp.consentSubtitle")}
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
            <p>
              {t("adminMcp.consentAs", {
                name:
                  user
                    ? `${user.first_name} ${user.last_name}`.trim()
                    : t("adminProfile.you"),
                email: user?.email || "",
              })}
            </p>
          </div>
          <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
            <li>{t("adminMcp.permSearch")}</li>
            <li>{t("adminMcp.permPipeline")}</li>
            <li>{t("adminMcp.permReports")}</li>
            <li>{t("adminMcp.permTasks")}</li>
            <li>{t("adminMcp.permPayments")}</li>
            <li>{t("adminMcp.permDocs")}</li>
            <li>{t("adminMcp.permWrites")}</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("adminMcp.consentNote")}
          </p>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={consentBusy}
            onClick={() => submit(false)}
          >
            {t("adminMcp.deny")}
          </Button>
          <Button
            type="button"
            disabled={consentBusy}
            onClick={() => submit(true)}
            className="gap-2"
          >
            {consentBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t("adminMcp.allow")}
          </Button>
        </div>
      </div>
    </div>
  );
}
