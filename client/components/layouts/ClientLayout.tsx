import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  ScrollText,
  TrendingUp,
  Bot,
  LifeBuoy,
  PlayCircle,
  User,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clientLogout, fetchClientMe } from "@/store/slices/clientAuthSlice";

interface Props {
  children: ReactNode;
}

const NAV = [
  { to: "/portal", end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: "/portal/documents", label: "My Documents", icon: FileText },
  { to: "/portal/contract", label: "Service Agreement", icon: ScrollText },
  { to: "/portal/reports", label: "Progress Reports", icon: TrendingUp },
  { to: "/portal/optibot", label: "Optibot AI", icon: Bot },
  { to: "/portal/videos", label: "Education", icon: PlayCircle },
  { to: "/portal/support", label: "Support", icon: LifeBuoy },
  { to: "/portal/profile", label: "My Profile", icon: User },
];

export default function ClientLayout({ children }: Props) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, token } = useAppSelector((s) => s.clientAuth);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (token && !user) dispatch(fetchClientMe());
  }, [token, user, dispatch]);

  useEffect(() => {
    if (!token) navigate("/portal/login", { replace: true });
  }, [token, navigate]);

  const handleLogout = async () => {
    await dispatch(clientLogout());
    navigate("/portal/login");
  };

  return (
    <div className="min-h-screen bg-secondary/40">
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between bg-card border-b border-border px-4 h-14">
        <Link to="/portal" className="flex items-center gap-2 font-bold">
          <div className="w-7 h-7 bg-gradient-to-br from-primary to-primary-600 rounded-md flex items-center justify-center text-white text-xs font-bold">
            OCR
          </div>
          <span>Portal</span>
        </Link>
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

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${
            mobileOpen ? "block" : "hidden"
          } md:block fixed md:sticky top-14 md:top-0 left-0 z-30 w-full md:w-64 lg:w-72 h-[calc(100vh-3.5rem)] md:h-screen bg-card border-r border-border md:flex md:flex-col`}
        >
          {/* Logo (desktop only) */}
          <div className="hidden md:flex items-center gap-2 px-6 h-20 border-b border-border">
            <Link
              to="/portal"
              className="flex items-center gap-2 font-bold text-lg"
            >
              <div className="w-9 h-9 bg-gradient-to-br from-primary to-primary-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">
                OCR
              </div>
              <div>
                <div className="leading-none">Optimum</div>
                <div className="text-xs text-muted-foreground font-normal">
                  Client Portal
                </div>
              </div>
            </Link>
          </div>

          {/* User card */}
          <div className="p-4 mx-3 my-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/0 border border-primary/10">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Welcome back
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
            {NAV.map((item) => (
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
                <item.icon className="w-4.5 h-4.5 w-5 h-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="p-3 mt-2 border-t border-border">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Log out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
