import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { redeemOnboardingToken } from "@/store/slices/clientAuthSlice";
import { Shield, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Onboarding() {
  const { token } = useParams<{ token: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loading, error, user } = useAppSelector((s) => s.clientAuth);

  useEffect(() => {
    if (!token) {
      navigate("/portal/login", { replace: true });
      return;
    }
    dispatch(redeemOnboardingToken(token));
  }, [token, dispatch, navigate]);

  useEffect(() => {
    if (user && !loading && !error) {
      // Small delay so the success state is visible
      const t = setTimeout(
        () => navigate("/portal/documents", { replace: true }),
        1200,
      );
      return () => clearTimeout(t);
    }
  }, [user, loading, error, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-6">
        {/* Logo + brand */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Optimum Credit
            </h1>
            <p className="text-sm text-muted-foreground">
              Secure onboarding link
            </p>
          </div>
        </div>

        {/* Status card */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          {loading && (
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              </div>
              <p className="text-sm font-medium text-foreground">
                Verifying your secure link&hellip;
              </p>
              <p className="text-xs text-muted-foreground">
                This only takes a moment
              </p>
            </div>
          )}

          {!loading && user && !error && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Welcome, {user.first_name}!
              </p>
              <p className="text-xs text-muted-foreground">
                Redirecting you to document upload&hellip;
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-amber-500" />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-sm font-semibold text-foreground">
                  This link has expired
                </p>
                <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                  Onboarding links are valid for 72 hours and can only be used
                  once. Sign in to your portal to upload your documents and get
                  started.
                </p>
              </div>
              <button
                onClick={() =>
                  navigate("/portal/login", {
                    replace: true,
                    state: { expiredOnboarding: true },
                  })
                }
                className="w-full btn-primary rounded-xl text-sm py-2.5"
              >
                Sign in to upload documents
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground px-4">
          This secure link is valid for 72 hours and can only be used once. Your
          documents are encrypted with AES-256.
        </p>
      </div>
    </div>
  );
}
