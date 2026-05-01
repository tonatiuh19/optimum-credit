import { useState } from "react";
import { CheckCircle2, Mail, Phone, User } from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { submitSmartCredit } from "@/store/slices/portalSlice";
import { fetchClientMe } from "@/store/slices/clientAuthSlice";

export default function Profile() {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((s) => s.clientAuth);
  const [saved, setSaved] = useState(false);

  const form = useFormik({
    initialValues: { smart_credit_email: "" },
    validationSchema: Yup.object({
      smart_credit_email: Yup.string()
        .email("Invalid email")
        .required("Required"),
    }),
    onSubmit: async (values) => {
      const r = await dispatch(submitSmartCredit(values));
      if (submitSmartCredit.fulfilled.match(r)) {
        setSaved(true);
        dispatch(fetchClientMe());
      }
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My Profile</h1>
        <p className="text-muted-foreground">
          Account info and credit-monitoring connection.
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Account</h2>
        <div className="space-y-3 text-sm">
          <Row
            icon={User}
            label="Name"
            value={`${user?.first_name || ""} ${user?.last_name || ""}`}
          />
          <Row icon={Mail} label="Email" value={user?.email || "—"} />
          <Row icon={Phone} label="Phone" value={user?.phone || "—"} />
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <h2 className="font-semibold mb-1">Smart Credit Monitoring</h2>
        <p className="text-sm text-muted-foreground mb-4">
          We use Smart Credit to pull your three-bureau report and track score
          changes after every dispute.
        </p>
        {user?.smart_credit_connected_at ? (
          <div className="flex items-center gap-2 text-accent text-sm">
            <CheckCircle2 className="w-5 h-5" /> Connected
          </div>
        ) : (
          <form onSubmit={form.handleSubmit} className="space-y-3">
            <input
              {...form.getFieldProps("smart_credit_email")}
              type="email"
              placeholder="Smart Credit account email"
              className="w-full h-11 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {form.touched.smart_credit_email &&
              form.errors.smart_credit_email && (
                <p className="text-xs text-destructive">
                  {form.errors.smart_credit_email}
                </p>
              )}
            <button type="submit" className="btn-primary">
              Connect
            </button>
            {saved && (
              <p className="text-sm text-accent flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Saved
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span className="text-muted-foreground w-24">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
