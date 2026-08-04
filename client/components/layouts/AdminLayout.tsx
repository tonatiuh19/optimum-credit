import { ReactNode, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Workflow,
  FileCheck2,
  MessageSquare,
  Mailbox,
  LifeBuoy,
  PlayCircle,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Zap,
  UserCog,
  CreditCard,
  Layers,
  Lock,
  ClipboardList,
  CheckSquare,
  CalendarDays,
  Repeat,
  Handshake,
} from "lucide-react";
import AdminThemeToggle from "@/components/AdminThemeToggle";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { adminLogout, fetchAdminMe } from "@/store/slices/adminAuthSlice";
import { fetchSectionLocks } from "@/store/slices/adminSlice";
import { fetchWorkBadge } from "@/store/slices/workTasksSlice";
import { useTranslation } from "react-i18next";

interface Props {
  children: ReactNode;
}

const NAV_GROUPS = [
  {
    labelKey: "adminNav.groups.overview",
    items: [
      {
        to: "/admin",
        end: true,
        labelKey: "adminNav.dashboard",
        icon: LayoutDashboard,
        sectionKey: "dashboard",
      },
      {
        to: "/admin/clients",
        labelKey: "adminNav.clients",
        icon: Users,
        sectionKey: "clients",
      },
      {
        to: "/admin/pipeline",
        labelKey: "adminNav.pipeline",
        icon: Workflow,
        sectionKey: "pipeline",
      },
      {
        to: "/admin/affiliates",
        labelKey: "adminNav.affiliates",
        icon: Handshake,
        sectionKey: "affiliates",
        affiliateManagersOnly: true,
      },
    ],
  },
  {
    labelKey: "adminNav.groups.work",
    items: [
      {
        to: "/admin/documents",
        labelKey: "adminNav.docReview",
        icon: FileCheck2,
        sectionKey: "documents",
      },
      {
        to: "/admin/payments",
        labelKey: "adminNav.payments",
        icon: CreditCard,
        sectionKey: "payments",
      },
      {
        to: "/admin/tradelines",
        labelKey: "adminNav.tradelines",
        icon: Layers,
        sectionKey: "tradelines",
      },
      {
        to: "/admin/subscriptions",
        labelKey: "adminNav.subscriptions",
        icon: Repeat,
        sectionKey: "subscriptions",
      },
      {
        to: "/admin/calendar",
        labelKey: "adminNav.calendar",
        icon: CalendarDays,
        sectionKey: "calendar",
      },
      {
        to: "/admin/my-tasks",
        labelKey: "adminNav.myTasks",
        icon: CheckSquare,
        sectionKey: "my_tasks",
      },
      {
        to: "/admin/tasks",
        labelKey: "adminNav.clientTasks",
        icon: ClipboardList,
        sectionKey: "tasks",
      },
      {
        to: "/admin/conversations",
        labelKey: "adminNav.conversations",
        icon: MessageSquare,
        sectionKey: "conversations",
      },
      {
        to: "/admin/tickets",
        labelKey: "adminNav.support",
        icon: LifeBuoy,
        sectionKey: "tickets",
      },
    ],
  },
  {
    labelKey: "adminNav.groups.content",
    items: [
      {
        to: "/admin/templates",
        labelKey: "adminNav.templates",
        icon: Mailbox,
        sectionKey: "templates",
      },
      {
        to: "/admin/videos",
        labelKey: "adminNav.education",
        icon: PlayCircle,
        sectionKey: "videos",
      },
      {
        to: "/admin/reminder-flows",
        labelKey: "adminNav.reminderFlows",
        icon: Zap,
        sectionKey: "reminder-flows",
      },
    ],
  },
  {
    labelKey: "adminNav.groups.insights",
    items: [
      {
        to: "/admin/reports",
        labelKey: "adminNav.reports",
        icon: BarChart3,
        superAdminOnly: true,
        sectionKey: "reports",
      },
      {
        to: "/admin/settings",
        labelKey: "adminNav.settings",
        icon: Settings,
        superAdminOnly: true,
        sectionKey: "settings",
      },
      {
        to: "/admin/people",
        labelKey: "adminNav.people",
        icon: UserCog,
        superAdminOnly: true,
        sectionKey: "people",
      },
    ],
  },
];

/** Sections affiliate-role users may still see in the admin shell (their scoped pipeline/clients view). */
const AFFILIATE_ALLOWED_SECTION_KEYS = new Set(["dashboard", "pipeline", "clients"]);

export default function AdminLayout({ children }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token } = useAppSelector((s) => s.adminAuth);
  const { sectionLocks, sectionLocksLoading, sectionLocksInitialized } =
    useAppSelector((s) => s.admin);
  const workBadge = useAppSelector((s) => s.workTasks.badge);
  const isSuperAdmin = user?.role === "super_admin";
  const isAdmin = user?.role === "admin";
  const isAffiliate = user?.role === "affiliate";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (token && !user) dispatch(fetchAdminMe());
  }, [token, user, dispatch]);

  useEffect(() => {
    if (token) dispatch(fetchSectionLocks());
  }, [token, dispatch]);

  useEffect(() => {
    if (token && user && user.role !== "affiliate") {
      dispatch(fetchWorkBadge());
    }
  }, [token, user, dispatch]);

  useEffect(() => {
    if (!token) navigate("/admin/login", { replace: true });
  }, [token, navigate]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Build a quick lookup: sectionKey → is_locked
  const lockedKeys = new Set(
    sectionLocks.filter((l) => l.is_locked).map((l) => l.section_key),
  );

  // Synchronously check if the current route is locked (no flash).
  // Use exact match for items with `end: true` (e.g. /admin dashboard) so the
  // "/admin" prefix doesn't incorrectly match every admin sub-route.
  // affiliate-portal lives outside NAV_GROUPS for managers, so check path too.
  const isAffiliatePortalRoute =
    location.pathname === "/admin/affiliate" ||
    location.pathname.startsWith("/admin/affiliate/");
  const isCurrentLocked =
    !sectionLocksLoading &&
    (NAV_GROUPS.flatMap((g) => g.items).some(
      (item) =>
        item.sectionKey &&
        lockedKeys.has(item.sectionKey) &&
        (item.end
          ? location.pathname === item.to
          : location.pathname.startsWith(item.to)),
    ) ||
      (isAffiliatePortalRoute && lockedKeys.has("affiliate-portal")));

  if (isCurrentLocked) return <Navigate to="/admin" replace />;

  const handleLogout = async () => {
    await dispatch(adminLogout());
    navigate("/admin/login");
  };

  const initials =
    `${user?.first_name?.[0] ?? ""}${user?.last_name?.[0] ?? ""}`.toUpperCase() ||
    "A";
  const fullName = `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim();

  // Affiliate role gets a stripped-down shell: their scoped Pipeline/Clients
  // view plus a dedicated "My Affiliate" portal in place of everything else.
  const navGroups = isAffiliate
    ? [
        {
          labelKey: "adminNav.groups.overview",
          items: [
            ...NAV_GROUPS.flatMap((g) => g.items).filter((item) =>
              AFFILIATE_ALLOWED_SECTION_KEYS.has(item.sectionKey),
            ),
            {
              to: "/admin/affiliate",
              labelKey: "adminNav.myAffiliate",
              icon: Handshake,
              sectionKey: "affiliate-portal",
            },
          ],
        },
      ]
    : NAV_GROUPS;

  return (
    <div className="h-[100dvh] overflow-hidden flex bg-background w-full max-w-[100vw]">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-20 bg-black/70 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={[
          "fixed md:relative top-0 left-0 z-30 h-full flex flex-col shrink-0",
          "bg-[#0b0f1a] border-r border-white/[0.07]",
          "transition-[width,transform] duration-300 ease-in-out overflow-hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          "w-72",
          collapsed ? "md:w-[68px]" : "md:w-[220px]",
        ].join(" ")}
      >
        {/* Logo + collapse toggle */}
        <div
          className={`flex items-center h-[60px] border-b border-white/[0.07] shrink-0 transition-all duration-300 ${
            collapsed ? "justify-center px-0" : "px-4"
          }`}
        >
          <Link
            to="/admin"
            className="flex items-center gap-2.5 min-w-0 group flex-1"
          >
            {!collapsed && (
              <img
                src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
                alt="Optimum Credit"
                className="h-5 w-auto min-w-0"
              />
            )}
          </Link>
          {/* Collapse toggle — top-right, desktop only */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={
              collapsed
                ? t("adminNav.expandSidebar")
                : t("adminNav.collapseSidebar")
            }
            className="hidden md:flex items-center justify-center w-6 h-6 rounded-md text-slate-600 hover:text-slate-200 hover:bg-white/[0.08] transition-colors shrink-0"
          >
            {collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 px-2 overflow-y-auto overflow-x-hidden py-2 space-y-4">
          {sectionLocksLoading ? (
            // Skeleton nav while locks load — prevents flash of unlocked sections
            <div className="space-y-4">
              {[4, 4, 3, 3].map((count, gi) => (
                <div key={gi}>
                  {!collapsed && (
                    <div className="px-2 mb-1 h-2 w-12 rounded bg-white/[0.05] animate-pulse" />
                  )}
                  <div className="space-y-0.5">
                    {Array.from({ length: count }).map((_, i) => (
                      <div
                        key={i}
                        className={[
                          "flex items-center rounded-lg animate-pulse bg-white/[0.04]",
                          collapsed
                            ? "justify-center px-0 py-2.5 w-full h-9"
                            : "gap-2.5 px-2.5 py-2 h-9",
                        ].join(" ")}
                      >
                        <div className="w-4 h-4 rounded bg-white/[0.06] shrink-0" />
                        {!collapsed && (
                          <div className="h-2.5 rounded bg-white/[0.06] flex-1" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            navGroups.map((group) => {
              const visibleItems = group.items.filter((item) => {
                if ((item as any).superAdminOnly && !isSuperAdmin) return false;
                if (
                  (item as any).affiliateManagersOnly &&
                  !isSuperAdmin &&
                  !isAdmin
                )
                  return false;
                return true;
              });
              if (visibleItems.length === 0) return null;
              return (
                <div key={t(group.labelKey)}>
                  {!collapsed && (
                    <div className="px-2 mb-1 text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">
                      {t(group.labelKey)}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const locked = (item as any).sectionKey
                        ? lockedKeys.has((item as any).sectionKey)
                        : false;

                      if (locked) {
                        const lockData = sectionLocks.find(
                          (l) => l.section_key === item.sectionKey,
                        );
                        const tooltip = lockData?.lock_reason
                          ? `${t(item.labelKey)}: ${lockData.lock_reason}`
                          : `${t(item.labelKey)} — ${t("adminNav.sectionLocked")}`;
                        return (
                          <div
                            key={item.to}
                            title={tooltip}
                            className={[
                              "flex items-center rounded-lg text-[13px] font-medium cursor-not-allowed select-none",
                              "text-slate-600 border border-transparent",
                              collapsed
                                ? "justify-center px-0 py-2.5 w-full"
                                : "gap-2.5 px-2.5 py-2",
                            ].join(" ")}
                          >
                            <item.icon className="w-4 h-4 shrink-0 text-slate-700" />
                            {!collapsed && (
                              <>
                                <span className="truncate flex-1">
                                  {t(item.labelKey)}
                                </span>
                                <Lock className="w-3 h-3 text-slate-700 shrink-0" />
                              </>
                            )}
                            {collapsed && (
                              <Lock className="absolute top-0.5 right-0.5 w-2.5 h-2.5 text-slate-700" />
                            )}
                          </div>
                        );
                      }

                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={"end" in item ? item.end : undefined}
                          title={collapsed ? t(item.labelKey) : undefined}
                          onClick={() => setMobileOpen(false)}
                          className={({ isActive }) =>
                            [
                              "flex items-center rounded-lg text-[13px] font-medium transition-all duration-150 group relative",
                              collapsed
                                ? "justify-center px-0 py-2.5 w-full"
                                : "gap-2.5 px-2.5 py-2",
                              isActive
                                ? "bg-primary/[0.18] text-white border border-primary/[0.3] shadow-sm shadow-primary/10"
                                : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] border border-transparent",
                            ].join(" ")
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <item.icon
                                className={`w-4 h-4 shrink-0 transition-colors ${
                                  isActive
                                    ? "text-white"
                                    : "text-slate-500 group-hover:text-slate-300"
                                }`}
                              />
                              {!collapsed && (
                                <span className="truncate flex-1">
                                  {t(item.labelKey)}
                                </span>
                              )}
                              {!collapsed &&
                                item.sectionKey === "my_tasks" &&
                                workBadge.mine_open > 0 && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/30 text-white shrink-0">
                                    {workBadge.mine_open}
                                  </span>
                                )}
                              {isActive && collapsed && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                              )}
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </nav>

        {/* Footer: user + logout merged */}
        <div className="p-2 border-t border-white/[0.07] shrink-0">
          {!collapsed ? (
            <div className="rounded-xl bg-white/[0.06] border border-white/[0.10] overflow-hidden">
              {/* User info */}
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-600 border border-primary/50 flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-md shadow-primary/30">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-white truncate leading-tight">
                    {fullName || "Admin"}
                  </div>
                  <div className="text-[10px] text-primary font-semibold uppercase tracking-wider mt-0.5">
                    {user?.role ?? "admin"}
                  </div>
                </div>
              </div>
              {/* Divider */}
              <div className="h-px bg-white/[0.07] mx-3" />
              <AdminThemeToggle />
              {/* Logout */}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] font-medium text-slate-400 hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                {t("adminNav.signOut")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 w-full">
              <div
                title={`${fullName} — ${t("adminNav.signOut")}`}
                onClick={handleLogout}
                className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-600 border border-primary/50 flex items-center justify-center text-[11px] font-bold text-white shadow-md shadow-primary/30 cursor-pointer hover:opacity-80 transition-opacity"
              >
                {initials}
              </div>
              <AdminThemeToggle collapsed />
              <button
                onClick={handleLogout}
                title={t("adminNav.signOut")}
                className="flex items-center justify-center w-full rounded-lg py-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden shrink-0 z-20 flex items-center justify-between bg-[#0b0f1a] border-b border-white/[0.07] px-4 h-14">
          <Link to="/admin" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-primary to-primary-600 rounded-lg flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-foreground text-sm tracking-tight">
              Optimum Admin
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <AdminThemeToggle compact className="!w-auto" />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 rounded-lg hover:bg-white/[0.08] text-slate-300 transition-colors"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain">
          {!sectionLocksInitialized ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="app-page px-4 sm:px-6 lg:px-10 py-5 sm:py-6 md:py-8">
              {children}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
