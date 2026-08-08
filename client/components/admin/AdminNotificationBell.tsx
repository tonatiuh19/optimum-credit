import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminInbox,
  markAdminNotificationsRead,
} from "@/store/slices/adminNotificationsSlice";
import { logger } from "@/utils/logger";

export default function AdminNotificationBell({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { token, user } = useAppSelector((s) => s.adminAuth);
  const { inbox, unreadCount, inboxLoading } = useAppSelector(
    (s) => s.adminNotifications,
  );
  const isAffiliate = user?.role === "affiliate";

  useEffect(() => {
    if (!token || isAffiliate) return;
    dispatch(fetchAdminInbox()).catch((e) =>
      logger.warn("inbox poll failed", e),
    );
    const id = window.setInterval(() => {
      dispatch(fetchAdminInbox());
    }, 45_000);
    return () => window.clearInterval(id);
  }, [dispatch, token, isAffiliate]);

  if (isAffiliate) return null;

  const markAll = () => {
    if (unreadCount <= 0) return;
    dispatch(markAdminNotificationsRead({ all: true }));
  };

  const openOne = (id: number) => {
    dispatch(markAdminNotificationsRead({ ids: [id] }));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            compact
              ? "relative p-2 rounded-lg hover:bg-white/[0.08] text-slate-300 transition-colors"
              : "relative flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
          }
          aria-label={t("adminProfile.bellAria")}
        >
          <Bell className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(100vw-2rem,22rem)] p-0 overflow-hidden"
      >
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <div className="text-sm font-semibold text-foreground">
            {t("adminProfile.inboxTitle")}
          </div>
          <button
            type="button"
            onClick={markAll}
            disabled={unreadCount <= 0}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            {t("adminProfile.markAllRead")}
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {inboxLoading && inbox.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : inbox.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("adminProfile.inboxEmpty")}
            </div>
          ) : (
            inbox.map((n) => {
              const inner = (
                <div
                  className={[
                    "px-3 py-2.5 border-b border-border/60 last:border-0 transition-colors",
                    n.read_at
                      ? "bg-background"
                      : "bg-primary/[0.04] hover:bg-primary/[0.07]",
                  ].join(" ")}
                >
                  <div className="text-[13px] font-semibold text-foreground leading-snug">
                    {n.title}
                  </div>
                  {n.body && (
                    <div className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">
                      {n.body}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
              );
              if (n.link_url) {
                const to = n.link_url.startsWith("http")
                  ? n.link_url.replace(/^https?:\/\/[^/]+/, "")
                  : n.link_url;
                return (
                  <Link
                    key={n.id}
                    to={to || "/admin"}
                    onClick={() => openOne(n.id)}
                    className="block"
                  >
                    {inner}
                  </Link>
                );
              }
              return (
                <button
                  key={n.id}
                  type="button"
                  className="block w-full text-left"
                  onClick={() => openOne(n.id)}
                >
                  {inner}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-border px-3 py-2">
          <Link
            to="/admin/profile"
            className="text-[12px] font-medium text-primary hover:underline"
          >
            {t("adminProfile.managePrefs")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
