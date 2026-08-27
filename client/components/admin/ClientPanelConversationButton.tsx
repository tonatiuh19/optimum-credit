import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/store/hooks";

export function ClientPanelConversationButton({
  clientId,
}: {
  clientId: number | null | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const conversationsEnabled = useAppSelector(
    (s) => s.adminAuth.user?.conversations_enabled,
  );

  if (!conversationsEnabled || !clientId || clientId <= 0) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      data-testid="panel-start-conversation"
      onClick={() => navigate(`/admin/conversations?client=${clientId}`)}
    >
      <MessageSquare className="w-3.5 h-3.5" />
      {t("adminPipeline.panelStartConversation")}
    </Button>
  );
}
