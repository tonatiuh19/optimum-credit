import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Ban,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import {
  markSplitPaid,
  updateCaseSplit,
  deleteCaseSplit,
} from "@/store/slices/adminSlice";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { CalendarSplit, PaymentSplit, PaymentSplitStatus } from "@shared/api";

type SplitLike = Pick<
  PaymentSplit,
  "id" | "case_id" | "label" | "amount_cents" | "due_date" | "status"
> &
  Partial<
    Pick<PaymentSplit, "send_payment_link" | "payment_link" | "payment_token">
  >;

function effectiveStatus(s: SplitLike): PaymentSplitStatus | "overdue" {
  if (s.status === "pending" && new Date(s.due_date) < new Date())
    return "overdue";
  return s.status;
}

function centsToDollarsInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(raw: string): number | null {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function resolvePayLink(split: SplitLike): string | null {
  if (split.payment_link) return split.payment_link;
  if (split.payment_token) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/pay/${split.payment_token}`;
    }
    return `/pay/${split.payment_token}`;
  }
  return null;
}

interface AdminSplitActionsProps {
  split: SplitLike | CalendarSplit;
  /** Called after a successful mutation so the parent can refetch / refresh UI. */
  onDone?: () => void;
  /** Compact trigger for dense tables; default is icon menu. */
  compact?: boolean;
}

/**
 * Shared installment actions used by Admin Payments, Calendar, and client panel.
 * Mark paid / cancel / edit / delete / copy or generate payment link.
 */
export default function AdminSplitActions({
  split,
  onDone,
  compact = true,
}: AdminSplitActionsProps) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { t } = useTranslation();
  const eff = effectiveStatus(split);
  const actionable = eff === "pending" || eff === "overdue";
  const payLink = resolvePayLink(split);

  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [label, setLabel] = useState(split.label);
  const [amount, setAmount] = useState(centsToDollarsInput(split.amount_cents));
  const [dueDate, setDueDate] = useState(split.due_date.slice(0, 10));
  const [sendLink, setSendLink] = useState(!!split.send_payment_link);

  if (!actionable && !payLink) return null;

  const openEdit = () => {
    setLabel(split.label);
    setAmount(centsToDollarsInput(split.amount_cents));
    setDueDate(split.due_date.slice(0, 10));
    setSendLink(!!split.send_payment_link || !!payLink);
    setEditOpen(true);
  };

  const run = async (fn: () => Promise<void>, okTitle: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: okTitle });
      onDone?.();
    } catch {
      toast({
        title: "Error",
        description: "Could not update installment",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const url = resolvePayLink(split);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t("adminPipeline.linkCopied") });
    } catch {
      toast({
        title: "Error",
        description: "Could not copy link",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className={compact ? "h-7 px-2" : "h-8"}
            disabled={busy}
            aria-label="Installment actions"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : compact ? (
              <MoreHorizontal className="w-3.5 h-3.5" />
            ) : (
              <span className="text-xs font-semibold">Actions</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {payLink && (
            <DropdownMenuItem onClick={copyLink}>
              <Copy className="w-3.5 h-3.5 mr-2" />
              {t("adminPipeline.copyPayLink")}
            </DropdownMenuItem>
          )}
          {actionable && !payLink && (
            <DropdownMenuItem
              onClick={() =>
                run(async () => {
                  await dispatch(
                    updateCaseSplit({
                      caseId: split.case_id,
                      splitId: split.id,
                      updates: { send_payment_link: true },
                    }),
                  ).unwrap();
                }, t("adminPipeline.generatePayLink"))
              }
            >
              <Link2 className="w-3.5 h-3.5 mr-2 text-primary" />
              {t("adminPipeline.generatePayLink")}
            </DropdownMenuItem>
          )}
          {actionable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  run(
                    async () => {
                      await dispatch(
                        markSplitPaid({
                          caseId: split.case_id,
                          splitId: split.id,
                        }),
                      ).unwrap();
                    },
                    "Marked as paid",
                  )
                }
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-accent" />
                Mark Paid
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openEdit}>
                <Pencil className="w-3.5 h-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCancelOpen(true)}>
                <Ban className="w-3.5 h-3.5 mr-2" />
                Cancel
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit installment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Label
              </label>
              <input
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Amount (USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Due date
                </label>
                <input
                  type="date"
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
              <Checkbox
                checked={sendLink}
                onCheckedChange={(v) => setSendLink(v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{t("adminPipeline.modeLink")}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {t("adminPipeline.modeLinkHint")}
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Close
            </Button>
            <Button
              disabled={busy || !label.trim() || !dueDate}
              onClick={() => {
                const cents = dollarsToCents(amount);
                if (cents == null) {
                  toast({
                    title: "Invalid amount",
                    variant: "destructive",
                  });
                  return;
                }
                setEditOpen(false);
                run(async () => {
                  await dispatch(
                    updateCaseSplit({
                      caseId: split.case_id,
                      splitId: split.id,
                      updates: {
                        label: label.trim(),
                        amount_cents: cents,
                        due_date: dueDate,
                        send_payment_link: sendLink,
                      },
                    }),
                  ).unwrap();
                }, "Installment updated");
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this installment?</AlertDialogTitle>
            <AlertDialogDescription>
              “{split.label}” will be marked cancelled. The client payment link
              will no longer be valid. {t("adminHelpers.splitCancelNoNotify")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                run(async () => {
                  await dispatch(
                    updateCaseSplit({
                      caseId: split.case_id,
                      splitId: split.id,
                      updates: { status: "cancelled" },
                    }),
                  ).unwrap();
                }, "Installment cancelled")
              }
            >
              Cancel installment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this installment?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes “{split.label}” from the schedule. This
              cannot be undone. {t("adminHelpers.splitDeleteNoNotify")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                run(async () => {
                  await dispatch(
                    deleteCaseSplit({
                      caseId: split.case_id,
                      splitId: split.id,
                    }),
                  ).unwrap();
                }, "Installment deleted")
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
