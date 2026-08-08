import { useEffect, useState } from "react";
import { Loader2, Sparkles, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import FieldHint from "@/components/admin/FieldHint";
import ProspectConvertFields, {
  buildConvertProspectBody,
  emptyProspectConvertFormValues,
  type ProspectConvertFormValues,
} from "@/components/admin/ProspectConvertFields";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { convertProspect } from "@/store/slices/prospectsSlice";
import { fetchPackages } from "@/store/slices/packagesSlice";
import { fetchCaseRoundSchedule } from "@/store/slices/adminSlice";
import { useToast } from "@/hooks/use-toast";
import type { ConvertProspectPayload, Prospect } from "@shared/api";

interface ConvertProspectDialogProps {
  prospect: Prospect | null;
  onClose: () => void;
  onConverted: () => void;
  /** Test / alternate submit hook — defaults to Redux convertProspect. */
  onConvert?: (payload: ConvertProspectPayload) => Promise<void>;
}

/** Confirmation + form when converting a prospect (drag to New Client or panel CTA). */
export default function ConvertProspectDialog({
  prospect,
  onClose,
  onConverted,
  onConvert,
}: ConvertProspectDialogProps) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { packages } = useAppSelector((s) => s.packages);
  const [values, setValues] = useState<ProspectConvertFormValues>(
    emptyProspectConvertFormValues(),
  );
  const [loading, setLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  useEffect(() => {
    if (!prospect) return;
    let cancelled = false;
    (async () => {
      setScheduleLoading(!!prospect.case_id);
      let next = emptyProspectConvertFormValues();
      if (prospect.case_id) {
        try {
          const res = await dispatch(fetchCaseRoundSchedule(prospect.case_id));
          if (
            !cancelled &&
            fetchCaseRoundSchedule.fulfilled.match(res) &&
            res.payload
          ) {
            const s = res.payload;
            next = {
              ...next,
              roundSchedule: {
                round_1_date: s.round_1_date,
                round_2_date: s.round_2_date,
                round_3_date: s.round_3_date,
                round_4_date: s.round_4_date,
                round_5_date: s.round_5_date,
                interval_days: s.interval_days,
                send_calendar: false,
              },
            };
          }
        } catch {
          /* keep defaults */
        }
      }
      if (!cancelled) {
        setValues(next);
        setScheduleLoading(false);
      }
      if (packages.length === 0) dispatch(fetchPackages());
    })();
    return () => {
      cancelled = true;
    };
  }, [prospect, dispatch, packages.length]);

  if (!prospect) return null;

  const handleConfirm = async () => {
    setLoading(true);
    const body = buildConvertProspectBody(values);
    const payload: ConvertProspectPayload = { id: prospect.id, ...body };
    try {
      if (onConvert) {
        await onConvert(payload);
      } else {
        await dispatch(convertProspect(payload)).unwrap();
      }
      toast({
        title: t("adminPipeline.convertSuccessTitle"),
        description: t("adminPipeline.convertSuccessBody", {
          name: `${prospect.first_name} ${prospect.last_name}`,
        }),
      });
      onConverted();
    } catch (e: any) {
      toast({
        title: t("adminPipeline.convertErrorTitle"),
        description: e?.message ?? e ?? t("adminPipeline.convertErrorBody"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!prospect} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-md w-full bg-card border-border p-0 gap-0 overflow-hidden [&>button:last-child]:hidden"
        data-testid="convert-prospect-dialog"
      >
        <DialogTitle className="px-6 pt-6 pb-4 text-base font-bold text-foreground border-b border-border flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-accent" />{" "}
          {t("adminPipeline.convertTitle")}
        </DialogTitle>
        <div className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
          <p className="text-sm text-muted-foreground">
            {t("adminPipeline.convertIntro", {
              name: `${prospect.first_name} ${prospect.last_name}`,
            })}
          </p>

          <FieldHint tone="accent">{t("adminPipeline.convertDropHint")}</FieldHint>

          {scheduleLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ProspectConvertFields
              values={values}
              onChange={setValues}
              packages={packages}
              disabled={loading}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            data-testid="convert-prospect-cancel"
          >
            {t("adminPipeline.convertCancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || scheduleLoading}
            data-testid="convert-prospect-confirm"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {t("adminPipeline.convertConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
