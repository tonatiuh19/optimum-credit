import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, FileText, Mail, Phone, MapPin, Plus } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createRoundReport,
  fetchAdminClient,
  updateClientStage,
} from "@/store/slices/adminSlice";
import { useFormik } from "formik";
import * as Yup from "yup";
import type { PipelineStage } from "@shared/api";

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
  const [showRound, setShowRound] = useState(false);

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

  const onStage = async (s: PipelineStage) => {
    await dispatch(updateClientStage({ clientId: c.id, stage: s }));
    dispatch(fetchAdminClient({ id: c.id }));
  };

  return (
    <div className="space-y-6">
      <Link
        to="/admin/clients"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" /> Back to clients
      </Link>

      <div className="bg-[#0f1530] rounded-2xl border border-white/10 p-6">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {c.first_name} {c.last_name}
            </h1>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-400">
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
            <label className="text-xs uppercase text-slate-400 block mb-1">
              Pipeline stage
            </label>
            <select
              value={c.pipeline_stage}
              onChange={(e) => onStage(e.target.value as PipelineStage)}
              className="h-10 px-3 rounded-lg border border-white/10 bg-white/5 text-sm text-white"
            >
              {STAGES.map((s) => (
                <option key={s} value={s} className="bg-[#0f1530]">
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Documents">
          {docs.length === 0 ? (
            <div className="text-slate-400 text-sm">No documents yet.</div>
          ) : (
            <ul className="space-y-2">
              {docs.map((d: any) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-white/5 text-sm"
                >
                  <span className="inline-flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    {d.doc_type} · {d.file_name}
                  </span>
                  <span
                    className={`text-xs uppercase px-2 py-0.5 rounded-full ${
                      d.review_status === "approved"
                        ? "bg-accent/20 text-accent"
                        : d.review_status === "rejected"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-yellow-500/20 text-yellow-300"
                    }`}
                  >
                    {d.review_status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Payments">
          {payments.length === 0 ? (
            <div className="text-slate-400 text-sm">No payments.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {payments.map((p: any) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-white/5"
                >
                  <span>${(p.amount_cents / 100).toFixed(2)}</span>
                  <span className="text-xs uppercase">{p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Round reports"
        right={
          <button
            onClick={() => setShowRound((v) => !v)}
            className="text-sm text-primary inline-flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add report
          </button>
        }
      >
        {showRound && (
          <RoundReportForm clientId={c.id} onDone={() => setShowRound(false)} />
        )}
        {reports.length === 0 ? (
          <div className="text-slate-400 text-sm">No reports yet.</div>
        ) : (
          <div className="space-y-3 mt-3">
            {reports.map((r: any) => (
              <div key={r.id} className="p-4 rounded-lg bg-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold">Round {r.round_number}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <Mini label="Removed" v={r.items_removed} />
                  <Mini label="Disputed" v={r.items_disputed} />
                  <Mini label="Before" v={r.score_before} />
                  <Mini label="After" v={r.score_after} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
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
    <div className="bg-[#0f1530] rounded-2xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Mini({ label, v }: { label: string; v: any }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-bold">{v ?? "—"}</div>
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
      className="grid sm:grid-cols-2 gap-3 p-4 mb-4 bg-white/5 rounded-lg"
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
        <label className="text-xs uppercase text-slate-400 block mb-1">
          Summary
        </label>
        <textarea
          rows={3}
          {...form.getFieldProps("summary_md")}
          className="w-full p-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white"
        />
      </div>
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <button
          type="button"
          onClick={onDone}
          className="btn-secondary text-sm"
        >
          Cancel
        </button>
        <button type="submit" className="btn-primary text-sm">
          Save & notify
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
      <label className="text-xs uppercase text-slate-400 block mb-1">
        {label}
      </label>
      <input
        type={type}
        {...f.getFieldProps(name)}
        className="w-full h-10 px-3 rounded-lg border border-white/10 bg-white/5 text-sm text-white"
      />
    </div>
  );
}
