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
  Lock,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { adminLogout, fetchAdminMe } from "@/store/slices/adminAuthSlice";
import { fetchSectionLocks } from "@/store/slices/adminSlice";

interface Props {
  children: ReactNode;
}

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      {
        to: "/admin",
        end: true,
        label: "Dashboard",
        icon: LayoutDashboard,
        sectionKey: "dashboard",
      },
      {
        to: "/admin/clients",
        label: "Clients",
        icon: Users,
        sectionKey: "clients",
      },
      {
        to: "/admin/pipeline",
        label: "Pipeline",
        icon: Workflow,
        sectionKey: "pipeline",
      },
    ],
  },
  {
    label: "Work",
    items: [
      {
        to: "/admin/documents",
        label: "Doc Review",
        icon: FileCheck2,
        sectionKey: "documents",
      },
      {
        to: "/admin/payments",
        label: "Payments",
        icon: CreditCard,
        sectionKey: "payments",
      },
      {
        to: "/admin/conversations",
        label: "Conversations",
        icon: MessageSquare,
        sectionKey: "conversations",
      },
      {
        to: "/admin/tickets",
        label: "Support",
        icon: LifeBuoy,
        sectionKey: "tickets",
      },
    ],
  },
  {
    label: "Content",
    items: [
      {
        to: "/admin/templates",
        label: "Templates",
        icon: Mailbox,
        sectionKey: "templates",
      },
      {
        to: "/admin/videos",
        label: "Videos",
        icon: PlayCircle,
        sectionKey: "videos",
      },
      {
        to: "/admin/reminder-flows",
        label: "Reminder Flows",
        icon: Zap,
        sectionKey: "reminder-flows",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        to: "/admin/reports",
        label: "Reports",
        icon: BarChart3,
        superAdminOnly: true,
        sectionKey: "reports",
      },
      {
        to: "/admin/settings",
        label: "Settings",
        icon: Settings,
        superAdminOnly: true,
        sectionKey: "settings",
      },
      {
        to: "/admin/people",
        label: "People",
        icon: UserCog,
        superAdminOnly: true,
        sectionKey: "people",
      },
    ],
  },
];

export default function AdminLayout({ children }: Props) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token } = useAppSelector((s) => s.adminAuth);
  const { sectionLocks, sectionLocksLoading } = useAppSelector((s) => s.admin);
  const isSuperAdmin = user?.role === "super_admin";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (token && !user) dispatch(fetchAdminMe());
  }, [token, user, dispatch]);

  useEffect(() => {
    if (token) dispatch(fetchSectionLocks());
  }, [token, dispatch]);

  useEffect(() => {
    if (!token) navigate("/admin/login", { replace: true });
  }, [token, navigate]);

  // Build a quick lookup: sectionKey → is_locked
  const lockedKeys = new Set(
    sectionLocks.filter((l) => l.is_locked).map((l) => l.section_key),
  );

  // Synchronously check if the current route is locked (no flash)
  const isCurrentLocked =
    !sectionLocksLoading &&
    NAV_GROUPS.flatMap((g) => g.items).some(
      (item) =>
        item.sectionKey &&
        lockedKeys.has(item.sectionKey) &&
        location.pathname.startsWith(item.to),
    );

  if (isCurrentLocked) return <Navigate to="/admin" replace />;

  const handleLogout = async () => {
    await dispatch(adminLogout());
    navigate("/admin/login");
  };

  const initials =
    `${user?.first_name?.[0] ?? ""}${user?.last_name?.[0] ?? ""}`.toUpperCase() ||
    "A";
  const fullName = `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim();

  return (
    <div className="h-screen overflow-hidden flex bg-secondary">
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
                src="https://disruptinglabs.com/data/optimum/assets/images/logo_horizontal_gold_white_text.png"
                alt="Optimum Credit"
                className="h-5 w-auto min-w-0"
              />
            )}
          </Link>
          {/* Collapse toggle — top-right, desktop only */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
            NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter(
                (item) => !(item as any).superAdminOnly || isSuperAdmin,
              );
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.label}>
                  {!collapsed && (
                    <div className="px-2 mb-1 text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">
                      {group.label}
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
                          ? `${item.label}: ${lockData.lock_reason}`
                          : `${item.label} — Section locked`;
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
                                  {item.label}
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
                          title={collapsed ? item.label : undefined}
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
                                <span className="truncate">{item.label}</span>
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
              {/* Logout */}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[12px] font-medium text-slate-400 hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                Log out
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <div
                title={`${fullName} — Log out`}
                onClick={handleLogout}
                className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-600 border border-primary/50 flex items-center justify-center text-[11px] font-bold text-white shadow-md shadow-primary/30 cursor-pointer hover:opacity-80 transition-opacity"
              >
                {initials}
              </div>
              <button
                onClick={handleLogout}
                title="Log out"
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
        <header className="md:hidden shrink-0 z-20 flex items-center justify-between bg-white/95 backdrop-blur-sm border-b border-slate-200/80 px-4 h-14 shadow-sm">
          <Link to="/admin" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-primary to-primary-600 rounded-lg flex items-center justify-center shadow-sm">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-foreground text-sm tracking-tight">
              Optimum Admin
            </span>
          </Link>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          {sectionLocksLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="px-5 sm:px-7 lg:px-10 py-6 md:py-8">{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}
