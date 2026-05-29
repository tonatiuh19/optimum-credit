import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, CreditCard } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createTradelineProduct,
  deleteTradelineProduct,
  fetchAdminTradelineProducts,
  updateTradelineProduct,
} from "@/store/slices/adminSlice";
import type { TradelineProduct, TradelineProductInput } from "@shared/api";
import { formatPackageDollars } from "@/lib/packageDisplay";

const emptyForm: TradelineProductInput = {
  slug: "",
  name: "",
  details: "",
  price_cents: 0,
  compare_price_cents: null,
  is_active: true,
  sort_order: 0,
};

export default function AdminTradelines() {
  const dispatch = useAppDispatch();
  const { tradelineProducts, tradelineProductsSaving } = useAppSelector(
    (s) => s.admin,
  );
  const [editing, setEditing] = useState<TradelineProduct | null>(null);
  const [form, setForm] = useState<TradelineProductInput>(emptyForm);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    dispatch(fetchAdminTradelineProducts());
  }, [dispatch]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, sort_order: tradelineProducts.length + 1 });
    setShowForm(true);
  };

  const openEdit = (p: TradelineProduct) => {
    setEditing(p);
    setForm({
      slug: p.slug,
      name: p.name,
      details: p.details,
      price_cents: p.price_cents,
      compare_price_cents: p.compare_price_cents ?? null,
      is_active: p.is_active !== 0 && p.is_active !== false,
      sort_order: p.sort_order,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.slug.trim() || !form.name.trim() || !form.details.trim()) return;
    if (editing) {
      await dispatch(updateTradelineProduct({ id: editing.id, ...form }));
    } else {
      await dispatch(createTradelineProduct(form));
    }
    setShowForm(false);
    dispatch(fetchAdminTradelineProducts());
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this tradeline product?")) return;
    await dispatch(deleteTradelineProduct(id));
    dispatch(fetchAdminTradelineProducts());
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={CreditCard}
        title="Tradeline catalog"
        description="Manage authorized-user tradelines shown during registration checkout."
        actions={
          <button type="button" onClick={openNew} className="btn-primary text-sm">
            <Plus className="w-4 h-4 mr-1" /> Add tradeline
          </button>
        }
      />

      {showForm && (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold">
            {editing ? "Edit tradeline" : "New tradeline"}
          </h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="font-medium">Slug</span>
              <input
                className="mt-1 w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                disabled={!!editing}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Name</span>
              <input
                className="mt-1 w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium">Details</span>
              <textarea
                className="mt-1 w-full min-h-[72px] p-3 rounded-lg border border-input bg-background text-sm"
                value={form.details}
                onChange={(e) =>
                  setForm({ ...form, details: e.target.value })
                }
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Price ($)</span>
              <input
                type="number"
                className="mt-1 w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={form.price_cents / 100}
                onChange={(e) =>
                  setForm({
                    ...form,
                    price_cents: Math.round(Number(e.target.value) * 100),
                  })
                }
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Compare price ($)</span>
              <input
                type="number"
                className="mt-1 w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={
                  form.compare_price_cents != null
                    ? form.compare_price_cents / 100
                    : ""
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    compare_price_cents: e.target.value
                      ? Math.round(Number(e.target.value) * 100)
                      : null,
                  })
                }
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Sort order</span>
              <input
                type="number"
                className="mt-1 w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={form.sort_order ?? 0}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={!!form.is_active}
                onChange={(e) =>
                  setForm({ ...form, is_active: e.target.checked })
                }
              />
              Active (visible at checkout)
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={tradelineProductsSaving}
              className="btn-primary text-sm"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="table-scroll">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left p-3 font-semibold">Name</th>
              <th className="text-left p-3 font-semibold">Details</th>
              <th className="text-left p-3 font-semibold">Price</th>
              <th className="text-left p-3 font-semibold">Active</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {tradelineProducts.map((p) => (
              <tr key={p.id} className="border-b border-border/60">
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3 text-muted-foreground max-w-xs truncate">
                  {p.details}
                </td>
                <td className="p-3">
                  {p.compare_price_cents != null &&
                    p.compare_price_cents > p.price_cents && (
                      <span className="text-muted-foreground line-through mr-2">
                        ${formatPackageDollars(p.compare_price_cents)}
                      </span>
                    )}
                  <span className="font-semibold">
                    ${formatPackageDollars(p.price_cents)}
                  </span>
                </td>
                <td className="p-3">
                  {p.is_active !== 0 && p.is_active !== false ? (
                    <span className="text-accent font-medium">Yes</span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="p-2 hover:bg-muted rounded-lg"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="p-2 hover:bg-destructive/10 text-destructive rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
