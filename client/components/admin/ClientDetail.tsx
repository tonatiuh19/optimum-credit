import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  Mail,
  Phone,
  MapPin,
  TrendingUp,
  TrendingDown,
  Minus,
  CalendarDays,
  Package,
  CreditCard,
  History,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createRoundReport,
  fetchAdminClient,
  updateClientStage,
} from "@/store/slices/adminSlice";
import { useFormik } from "formik";
import * as Yup from "yup";
import type { PipelineStage } from "@shared/api";
import { LangBadge } from "@/components/ui/lang-badge";

const STAGES: PipelineStage[] = [
  "new_client",
  "docs_ready",
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "round_5",
  "completed",
  "cancelled",
];

export default function AdminClientDetail() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const { selectedClient } = useAppSelector((s) => s.admin);

  useEffect(() => {
    if (id) dispatch(fetchAdminClient({ id: Number(id) }));
  }, [dispatch, id]);

  if (!selectedClient || selectedClient?.client?.id !== Number(id)) {
    return <div className="text-slate-400">Loading…</div>;
  }
  const c = selectedClient.client;
  const docs = selectedClient.documents || [];
  const reports = selectedClient.reports || [];
  const payments = selectedClient.payments || [];
  const pipelineHistory = selectedClient.pipeline_history || [];

  const totalPaidCents = payments
    .filter((p: any) => p.status === "succeeded")
    .reduce((sum: number, p: any) => sum + (p.amount_cents || 0), 0);
  const docsApproved = docs.filter(
    (d: any) => d.review_status === "approved",
  ).length;
  const docsPending = docs.filter(
    (d: any) => d.review_status === "pending",
  ).length;
  const docsRejected = docs.filter(
    (d: any) => d.review_status === "rejected",
  ).length;

  const onStage = async (s: PipelineStage) => {
    await dispatch(updateClientStage({ clientId: c.id, stage: s }));
    dispatch(fetchAdminClient({ id: c.id }));
  };

  return (
    <div className="space-y-6">
      <Link
        to="/admin/clients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to clients
      </Link>

      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {c.first_name} {c.last_name}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <LangBadge lang={c.preferred_language} />
              <StatusBadge status={c.status} />
              {c.contract_signed_at && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Contract signed
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Mail className="w-4 h-4" /> {c.email}
              </span>
              {c.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-4 h-4" /> {c.phone}
                </span>
              )}
              {c.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-4 h-4" /> {c.city}, {c.state}
                </span>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
              Pipeline stage
            </label>
            <select
              value={c.pipeline_stage}
              onChange={(e) => onStage(e.target.value as PipelineStage)}
              className="h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={<CalendarDays className="w-4 h-4" />}
          label="Member Since"
          value={new Date(c.created_at).toLocaleDateString()}
        />
        <StatTile
          icon={<Package className="w-4 h-4" />}
          label="Package"
          value={c.package_name || "—"}
          sub={
            c.package_price_cents
              ? `$${(c.package_price_cents / 100).toFixed(0)}/mo`
              : undefined
          }
        />
        <StatTile
          icon={<CreditCard className="w-4 h-4" />}
          label="Total Paid"
          value={`$${(totalPaidCents / 100).toFixed(2)}`}
          sub={`${payments.filter((p: any) => p.status === "succeeded").length} payment(s)`}
        />
        <StatTile
          icon={<FileText className="w-4 h-4" />}
          label="Documents"
          value={`${docs.length} total`}
          sub={`${docsApproved} approved · ${docsPending} pending · ${docsRejected} rejected`}
        />
      </div>

      {/* Admin notes */}
      {c.admin_notes && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-600 dark:text-yellow-400 mb-1">
            Admin Notes
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {c.admin_notes}
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={`Documents (${docs.length})`}>
          {docs.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No documents yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {docs.map((d: any) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-1 p-2 rounded-lg bg-muted/50 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-foreground">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      {d.doc_type} · {d.file_name}
                    </span>
                    <span
                      className={`text-xs uppercase px-2 py-0.5 rounded-full ${
                        d.review_status === "approved"
                          ? "bg-accent/20 text-accent"
                          : d.review_status === "rejected"
                            ? "bg-destructive/20 text-destructive"
                            : "bg-yellow-500/20 text-yellow-500"
                      }`}
                    >
                      {d.review_status}
                    </span>
                  </div>
                  {d.rejection_reason && (
                    <p className="text-xs text-destructive pl-6">
                      Rejected: {d.rejection_reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Payments">
          {payments.length === 0 ? (
            <div className="text-muted-foreground text-sm">No payments.</div>
          ) : (
            <>
              {totalPaidCents > 0 && (
                <div className="flex items-center justify-between px-3 py-2 mb-2 rounded-lg bg-accent/10 border border-accent/20">
                  <span className="text-sm font-semibold text-foreground">
                    Total Paid
                  </span>
                  <span className="text-sm font-bold text-accent">
                    ${(totalPaidCents / 100).toFixed(2)}
                  </span>
                </div>
              )}
              <ul className="space-y-2 text-sm">
                {payments.map((p: any) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                  >
                    <span className="font-medium text-foreground">
                      ${(p.amount_cents / 100).toFixed(2)}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {p.status}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card title="Round Reports">
        {reports.length === 0 ? (
          <div className="text-muted-foreground text-sm">No reports yet.</div>
        ) : (
          <div className="space-y-3 mt-3">
            {reports.map((r: any) => {
              const delta =
                r.score_before != null && r.score_after != null
                  ? r.score_after - r.score_before
                  : null;
              const pdfCount = Array.isArray(r.pdfs) ? r.pdfs.length : 0;
              return (
                <div
                  key={r.id}
                  className="p-4 rounded-lg bg-muted/50 border border-border"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        Round {r.round_number}
                      </span>
                      {pdfCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                          <FileText className="w-3 h-3" /> {pdfCount} PDF
                          {pdfCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {delta !== null && (
                        <span
                          className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full font-semibold ${
                            delta > 0
                              ? "bg-accent/10 text-accent"
                              : delta < 0
                                ? "bg-destructive/10 text-destructive"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {delta > 0 ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : delta < 0 ? (
                            <TrendingDown className="w-3 h-3" />
                          ) : (
                            <Minus className="w-3 h-3" />
                          )}
                          {delta > 0 ? `+${delta}` : delta} pts
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <Mini label="Removed" v={r.items_removed} />
                    <Mini label="Disputed" v={r.items_disputed} />
                    <Mini label="Before" v={r.score_before} />
                    <Mini label="After" v={r.score_after} />
                  </div>
                  {r.summary_md && (
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                      {r.summary_md}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Pipeline History */}
      <Card
        title="Pipeline History"
        right={<History className="w-4 h-4 text-muted-foreground" />}
      >
        {pipelineHistory.length === 0 ? (
          <div className="text-muted-foreground text-sm">No history yet.</div>
        ) : (
          <ol className="relative border-l border-border ml-3 space-y-5 mt-1">
            {pipelineHistory.map((h: any) => (
              <li key={h.id} className="ml-5">
                <span className="absolute w-2.5 h-2.5 bg-primary rounded-full -left-[5px] border-2 border-card mt-0.5" />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {h.from_stage ? (
                        <>
                          <span className="text-muted-foreground">
                            {h.from_stage.replace(/_/g, " ")}
                          </span>
                          {" → "}
                        </>
                      ) : null}
                      {h.to_stage.replace(/_/g, " ")}
                    </p>
                    {h.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {h.notes}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(h.created_at).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-base font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; icon: React.ReactNode }> = {
    active: {
      cls: "bg-accent/10 text-accent",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    pending_payment: {
      cls: "bg-yellow-500/10 text-yellow-500",
      icon: <Clock className="w-3 h-3" />,
    },
    paused: {
      cls: "bg-muted text-muted-foreground",
      icon: <Minus className="w-3 h-3" />,
    },
    onboarding: {
      cls: "bg-primary/10 text-primary",
      icon: <Clock className="w-3 h-3" />,
    },
    cancelled: {
      cls: "bg-destructive/10 text-destructive",
      icon: <AlertCircle className="w-3 h-3" />,
    },
  };
  const { cls, icon } = cfg[status] ?? {
    cls: "bg-muted text-muted-foreground",
    icon: null,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}
    >
      {icon}
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: any;
  right?: any;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Mini({ label, v }: { label: string; v: any }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold text-foreground">{v ?? "—"}</div>
    </div>
  );
}

function RoundReportForm({
  clientId,
  onDone,
}: {
  clientId: number;
  onDone: () => void;
}) {
  const dispatch = useAppDispatch();
  const form = useFormik({
    initialValues: {
      round_number: 1,
      score_before: "",
      score_after: "",
      items_removed: 0,
      items_disputed: 0,
      summary_md: "",
    },
    validationSchema: Yup.object({
      round_number: Yup.number().min(1).max(5).required(),
    }),
    onSubmit: async (v) => {
      await dispatch(
        createRoundReport({
          clientId,
          round_number: Number(v.round_number),
          score_before: v.score_before ? Number(v.score_before) : undefined,
          score_after: v.score_after ? Number(v.score_after) : undefined,
          items_removed: Number(v.items_removed),
          items_disputed: Number(v.items_disputed),
          summary_md: v.summary_md,
        }),
      );
      onDone();
      dispatch(fetchAdminClient({ id: clientId }));
    },
  });
  return (
    <form
      onSubmit={form.handleSubmit}
      className="grid sm:grid-cols-2 gap-3 p-4 mb-4 bg-muted/50 rounded-lg border border-border"
    >
      <Field f={form} name="round_number" label="Round #" type="number" />
      <Field f={form} name="score_before" label="Score Before" type="number" />
      <Field f={form} name="score_after" label="Score After" type="number" />
      <Field
        f={form}
        name="items_removed"
        label="Items Removed"
        type="number"
      />
      <Field
        f={form}
        name="items_disputed"
        label="Items Disputed"
        type="number"
      />
      <div className="sm:col-span-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
          Summary
        </label>
        <textarea
          rows={3}
          {...form.getFieldProps("summary_md")}
          className="w-full p-2 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <button
          type="button"
          onClick={onDone}
          className="h-9 px-4 rounded-lg border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Save &amp; notify
        </button>
      </div>
    </form>
  );
}

function Field({
  f,
  name,
  label,
  type = "text",
}: {
  f: any;
  name: string;
  label: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
        {label}
      </label>
      <input
        type={type}
        {...f.getFieldProps(name)}
        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}
