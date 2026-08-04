import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { submitProspectLead, clearLeadState } from "@/store/slices/creditAnalysisSlice";
import { getAffiliateRef } from "@/lib/affiliateAttribution";

const leadSchema = Yup.object({
  name: Yup.string().trim().required(),
  email: Yup.string().email().required(),
  phone: Yup.string().trim().required(),
});

/** Lightweight name/email/phone lead capture — used on the marketing home page. */
export default function CreditAnalysisLeadForm({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { leadSubmitting, leadError, leadSubmitted } = useAppSelector(
    (s) => s.creditAnalysis,
  );

  const form = useFormik({
    initialValues: { name: "", email: "", phone: "" },
    validationSchema: leadSchema,
    onSubmit: async (values, helpers) => {
      const [first_name, ...rest] = values.name.trim().split(/\s+/);
      const res = await dispatch(
        submitProspectLead({
          first_name: first_name || values.name,
          last_name: rest.join(" ") || "-",
          email: values.email,
          phone: values.phone,
          source_label: "web_analysis",
          lead_source: "get_started",
          affiliate_code: getAffiliateRef(),
        }),
      );
      if (submitProspectLead.fulfilled.match(res)) {
        helpers.resetForm();
      }
    },
  });

  if (leadSubmitted) {
    return (
      <div
        className={`flex items-center gap-2 text-accent bg-accent/10 border border-accent/25 rounded-xl px-4 py-3 text-sm font-medium ${className}`}
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        {t("creditAnalysisCta.leadSuccess")}
        <button
          type="button"
          onClick={() => dispatch(clearLeadState())}
          className="ml-auto text-xs underline text-accent/70 hover:text-accent"
        >
          {t("creditAnalysis.startOver")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit} className={`space-y-2.5 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <input
          placeholder={t("creditAnalysisCta.leadName")}
          className="h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          {...form.getFieldProps("name")}
        />
        <input
          type="email"
          placeholder={t("creditAnalysisCta.leadEmail")}
          className="h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          {...form.getFieldProps("email")}
        />
        <input
          type="tel"
          placeholder={t("creditAnalysisCta.leadPhone")}
          className="h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          {...form.getFieldProps("phone")}
        />
      </div>
      {leadError && <p className="text-xs text-destructive">{leadError}</p>}
      <button
        type="submit"
        disabled={leadSubmitting || !form.isValid || !form.dirty}
        className="btn-secondary w-full sm:w-auto h-11 px-6 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {leadSubmitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
        {t("creditAnalysisCta.leadSubmit")}
      </button>
    </form>
  );
}
