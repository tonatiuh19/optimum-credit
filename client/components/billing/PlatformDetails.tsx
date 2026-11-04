import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Boxes,
  ChevronDown,
  Cpu,
  Database,
  Lock,
  Network,
  PlugZap,
  Server,
  ShieldCheck,
  Timer,
  Workflow,
} from "lucide-react";
import type { BillingPlatform } from "@/store/slices/billingSlice";

const num = (v: number) => v.toLocaleString("en-US");

/** Architecture layers (keys under billing.platform.arch.*). No provider names by design. */
const ARCH: Array<{ key: string; icon: typeof Server }> = [
  { key: "frontend", icon: Boxes },
  { key: "api", icon: Server },
  { key: "data", icon: Database },
  { key: "realtime", icon: Network },
  { key: "storage", icon: Lock },
  { key: "security", icon: ShieldCheck },
  { key: "jobs", icon: Timer },
  { key: "ai", icon: Cpu },
  { key: "voice", icon: Activity },
  { key: "observability", icon: Workflow },
];

const MODULES = [
  "crm",
  "pipeline",
  "conversations",
  "voice",
  "creditAnalysis",
  "progressReports",
  "docReview",
  "funding",
  "tasks",
  "payments",
  "affiliates",
  "eventMarketing",
  "education",
  "reminders",
  "aiAssistant",
  "mcp",
  "clientPortal",
  "notifications",
  "billing",
];

/** included = part of the platform fee; ofg = runs on OFG's own account. */
const INTEGRATIONS: Array<{ key: string; owner: "included" | "ofg" }> = [
  { key: "hosting", owner: "included" },
  { key: "database", owner: "included" },
  { key: "realtime", owner: "included" },
  { key: "storage", owner: "included" },
  { key: "email", owner: "included" },
  { key: "platformBilling", owner: "included" },
  { key: "telephony", owner: "ofg" },
  { key: "ai", owner: "ofg" },
  { key: "whatsapp", owner: "ofg" },
  { key: "crm", owner: "ofg" },
  { key: "creditSoftware", owner: "ofg" },
  { key: "clientPayments", owner: "ofg" },
  { key: "creditMonitoring", owner: "ofg" },
];

const ACTIVITY_KEYS = [
  "credit_report_reads",
  "credit_analyses",
  "progress_reports",
  "ai_calls",
  "mcp_calls",
  "sms_sent",
  "sms_received",
  "calls",
  "call_minutes",
  "call_insights",
  "whatsapp_messages",
  "emails",
  "tasks_created",
];

function Section({ title, icon: Icon, children, defaultOpen = false }: { title: string; icon: typeof Server; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-left hover:bg-muted/30 transition-colors"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="w-4 h-4 text-primary" /> {title}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`grid transition-all duration-300 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <div className="px-4 sm:px-5 pb-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Technical platform sheet: live metrics, architecture, modules, integrations. */
export function PlatformDetails({ platform }: { platform: BillingPlatform | null }) {
  const { t } = useTranslation();
  if (!platform) return null;
  const sys = platform.system;
  const kpis: Array<[string, number]> = [
    ["clients", platform.accounts.clients],
    ["activeClients", platform.accounts.active_clients],
    ["staff", platform.accounts.staff],
    ["affiliates", platform.accounts.affiliates],
    ["apiRoutes", sys.api_routes],
    ["dbTables", sys.db_tables],
    ["roles", sys.roles],
    ["jobs", sys.scheduled_jobs],
  ];

  return (
    <div className="card-base overflow-hidden" data-testid="billing-platform">
      <div className="px-4 sm:px-5 pt-4 pb-3">
        <p className="text-sm font-semibold text-foreground">{t("billing.platform.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("billing.platform.subtitle")}
          {platform.live_since ? ` · ${t("billing.platform.liveSince", { date: new Date(platform.live_since).toLocaleDateString() })}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border-y border-border">
        {kpis.map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3">
            <p className="text-xl font-bold tabular-nums text-foreground">{num(v)}</p>
            <p className="text-[11px] text-muted-foreground">{t(`billing.platform.kpi.${k}`)}</p>
          </div>
        ))}
      </div>

      <Section title={t("billing.platform.activityTitle", { month: platform.month })} icon={Activity} defaultOpen>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {ACTIVITY_KEYS.map((k) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2">
              <p className="text-base font-semibold tabular-nums text-foreground">{num(platform.activity[k] ?? 0)}</p>
              <p className="text-[11px] text-muted-foreground">{t(`billing.platform.activity.${k}`)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("billing.platform.archTitle")} icon={Server}>
        <div className="grid sm:grid-cols-2 gap-3">
          {ARCH.map(({ key, icon: Icon }) => (
            <div key={key} className="rounded-xl border border-border p-3">
              <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <Icon className="w-4 h-4 text-primary" /> {t(`billing.platform.arch.${key}.title`)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {t(`billing.platform.arch.${key}.body`, { routes: sys.api_routes, tables: sys.db_tables, seconds: sys.max_request_seconds, jobs: sys.scheduled_jobs, roles: sys.roles })}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("billing.platform.modulesTitle", { count: MODULES.length })} icon={Boxes}>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
          {MODULES.map((m) => (
            <div key={m} className="text-xs">
              <p className="font-medium text-foreground">{t(`billing.platform.modules.${m}.title`)}</p>
              <p className="text-muted-foreground leading-relaxed">{t(`billing.platform.modules.${m}.body`)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("billing.platform.integrationsTitle")} icon={PlugZap}>
        <div className="divide-y divide-border">
          {INTEGRATIONS.map((i) => (
            <div key={i.key} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-foreground">{t(`billing.platform.integrations.${i.key}.title`)}</p>
                <p className="text-[11px] text-muted-foreground">{t(`billing.platform.integrations.${i.key}.body`)}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  i.owner === "included" ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"
                }`}
              >
                {t(`billing.platform.owner.${i.owner}`)}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
