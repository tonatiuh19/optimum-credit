/**
 * Clickable contact phone — Call (softphone) or Text (Conversations compose).
 * Renders plain text when staff lack Conversations / OFG access.
 */
import { MessageSquare, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startOutboundCall } from "@/store/slices/voiceSlice";
import {
  buildComposeDeepLink,
  normalizeContactPhone,
} from "@/lib/contactPhoneActions";
import { cn } from "@/lib/utils";

export type ContactPhoneActionsProps = {
  phone: string | null | undefined;
  clientId?: number | null;
  clientName?: string | null;
  contactId?: number | null;
  contactName?: string | null;
  className?: string;
  /** Optional override when already on Conversations (avoid full navigation). */
  onText?: (opts: {
    phone: string;
    clientId?: number | null;
    clientName?: string | null;
    contactId?: number | null;
    contactName?: string | null;
  }) => void;
};

export function ContactPhoneActions({
  phone,
  clientId,
  clientName,
  contactId,
  contactName,
  className,
  onText,
}: ContactPhoneActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const conversationsEnabled = useAppSelector(
    (s) => s.adminAuth.user?.conversations_enabled,
  );

  const raw = String(phone || "").trim();
  if (!raw) return null;

  if (!conversationsEnabled) {
    return <span className={cn("tabular-nums", className)}>{raw}</span>;
  }

  const normalized = normalizeContactPhone(raw);
  const dialPhone = normalized?.phone ?? raw;

  const handleCall = () => {
    dispatch(
      startOutboundCall({
        phone: dialPhone,
        clientName: clientName ?? contactName ?? null,
        clientId: clientId ?? null,
      }),
    );
  };

  const handleText = () => {
    if (onText) {
      onText({
        phone: dialPhone,
        clientId: clientId ?? null,
        clientName: clientName ?? null,
        contactId: contactId ?? null,
        contactName: contactName ?? null,
      });
      return;
    }
    const href = buildComposeDeepLink({
      phone: dialPhone,
      clientId: clientId ?? null,
      contactId: contactId ?? null,
    });
    if (href) navigate(href);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 tabular-nums text-left",
            "hover:text-primary hover:underline underline-offset-2",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            className,
          )}
          title={t("conversations.phoneActions.choose")}
          data-testid="contact-phone-actions-trigger"
        >
          {raw}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="font-normal text-muted-foreground truncate">
          {normalized?.label ?? raw}
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2"
          onSelect={handleCall}
          data-testid="contact-phone-action-call"
        >
          <Phone className="h-3.5 w-3.5 text-accent" />
          {t("conversations.phoneActions.call")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          onSelect={handleText}
          data-testid="contact-phone-action-text"
        >
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          {t("conversations.phoneActions.text")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
