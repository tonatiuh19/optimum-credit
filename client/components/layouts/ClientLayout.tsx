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
  FileText,
  TrendingUp,
  LifeBuoy,
  PlayCircle,
  User,
  LogOut,
  Menu,
  X,
  Lock,
  CreditCard,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clientLogout, fetchClientMe } from "@/store/slices/clientAuthSlice";
import { fetchPortalSectionLocks } from "@/store/slices/portalSlice";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import LegalLinks from "@/components/LegalLinks";

interface Props {
  children: ReactNode;
}

const NAV: {
  to: string;
  end?: boolean;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  sectionKey?: string;
}[] = [
  {
    to: "/portal",
    end: true,
    labelKey: "sidebar.dashboard",
    icon: LayoutDashboard,
    sectionKey: "portal_dashboard",
  },
  { to: "/portal/documents", labelKey: "sidebar.documents", icon: FileText },
  {
    to: "/portal/reports",
    labelKey: "sidebar.reports",
    icon: TrendingUp,
    sectionKey: "portal_reports",
  },
  {
    to: "/portal/videos",
    labelKey: "sidebar.education",
    icon: PlayCircle,
    sectionKey: "portal_videos",
  },
  {
    to: "/portal/support",
    labelKey: "sidebar.support",
    icon: LifeBuoy,
    sectionKey: "portal_support",
  },
  {
    to: "/portal/profile",
    labelKey: "sidebar.profile",
    icon: User,
    sectionKey: "portal_profile",
  },
  {
    to: "/portal/payments",
    labelKey: "sidebar.payments",
    icon: CreditCard,
  },
];

export default function ClientLayout({ children }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, token } = useAppSelector((s) => s.clientAuth);
  const { sectionLocks, sectionLocksInitialized } = useAppSelector(
    (s) => s.portal,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (token && !user) dispatch(fetchClientMe());
  }, [token, user, dispatch]);

  useEffect(() => {
    if (!token) navigate("/portal/login", { replace: true });
  }, [token, navigate]);

  useEffect(() => {
    if (token) dispatch(fetchPortalSectionLocks());
  }, [token, dispatch]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Build locked key set from DB
  const lockedKeys = new Set(
    sectionLocks.filter((l) => l.is_locked).map((l) => l.section_key),
  );

  // Redirect direct URL access to locked sections (only after locks are loaded)
  const isLockedRoute =
    sectionLocksInitialized &&
    NAV.some(
      (item) =>
        item.sectionKey &&
        lockedKeys.has(item.sectionKey) &&
        location.pathname === item.to,
    );
  if (isLockedRoute) return <Navigate to="/portal/documents" replace />;

  const handleLogout = async () => {
    await dispatch(clientLogout());
    navigate("/portal/login");
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col w-full max-w-[100vw] overflow-x-hidden">
      {/* Mobile overlay — closes sidebar on tap outside */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between bg-card border-b border-border px-4 h-14">
        <Link to="/portal" className="flex items-center gap-2 font-bold">
          <div className="w-7 h-7 bg-gradient-to-br from-primary to-primary-600 rounded-md flex items-center justify-center text-white text-xs font-bold">
            OCR
          </div>
          <span>Portal</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle zone="portal" compact />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-md hover:bg-secondary"
            aria-label="Menu"
          >
            {mobileOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      <div className="flex w-full min-w-0">
        {/* Sidebar */}
        <aside
          className={`${
            mobileOpen ? "block" : "hidden"
          } md:block fixed md:sticky top-14 md:top-0 left-0 z-30 w-[min(100%,20rem)] md:w-64 lg:w-72 h-[calc(100dvh-3.5rem)] md:h-[100dvh] bg-card border-r border-border md:flex md:flex-col shrink-0`}
        >
          {/* Logo (desktop only) */}
          <div className="hidden md:flex items-center gap-2 px-6 h-20 border-b border-border">
            <Link
              to="/portal"
              className="flex items-center transition-opacity hover:opacity-80"
            >
              <img
                src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_dark.png"
                alt="Optimum Credit"
                className="h-8 w-auto dark:hidden"
              />
              <img
                src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
                alt=""
                aria-hidden
                className="h-8 w-auto hidden dark:block"
              />
            </Link>
          </div>

          {/* User card */}
          <div className="p-4 mx-3 my-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/0 border border-primary/10">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {t("sidebar.welcomeBack")}
            </div>
            <div className="font-semibold mt-1">
              {user?.first_name || "Client"} {user?.last_name || ""}
            </div>
            {user?.pipeline_stage && (
              <div className="mt-2 inline-flex items-center text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-primary/10 text-primary">
                {String(user.pipeline_stage).replace(/_/g, " ")}
              </div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
            {!sectionLocksInitialized ? (
              // Skeleton nav while locks load — prevents flash of unlocked items
              <div className="space-y-0.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg animate-pulse"
                  >
                    <div className="w-5 h-5 rounded bg-muted shrink-0" />
                    <div className="h-3 rounded bg-muted flex-1" />
                  </div>
                ))}
              </div>
            ) : (
              NAV.map((item) => {
                const locked = item.sectionKey
                  ? lockedKeys.has(item.sectionKey)
                  : false;
                const lockData = locked
                  ? sectionLocks.find((l) => l.section_key === item.sectionKey)
                  : null;
                const tooltip = lockData?.lock_reason ?? "Coming soon";
                return locked ? (
                  <div
                    key={item.to}
                    title={tooltip}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-not-allowed select-none text-muted-foreground/40"
                  >
                    <item.icon className="w-5 h-5 shrink-0" />
                    <span className="flex-1">{t(item.labelKey)}</span>
                    <Lock className="w-3 h-3 shrink-0" />
                  </div>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`
                    }
                  >
                    <item.icon className="w-5 h-5" />
                    {t(item.labelKey)}
                  </NavLink>
                );
              })
            )}
          </nav>

          <div className="p-3 mt-2 border-t border-border space-y-1">
            <div className="px-3 py-1.5">
              <LanguageSwitcher variant="full" />
            </div>
            <ThemeToggle zone="portal" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              {t("sidebar.signOut")}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          {!sectionLocksInitialized ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="app-page container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 md:py-10">
              {children}
            </div>
          )}
        </main>
      </div>

      <footer className="border-t border-border bg-card/80 shrink-0">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground text-center sm:text-left">
            © {new Date().getFullYear()} Optimum Credit
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            <LegalLinks className="text-xs text-muted-foreground" />
            <ThemeToggle zone="portal" compact />
            <LanguageSwitcher variant="compact" />
          </div>
        </div>
      </footer>
    </div>
  );
}
