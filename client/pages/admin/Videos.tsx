import { useEffect, useState } from "react";
import { Plus, PlayCircle, Trash2 } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createVideo,
  deleteVideo,
  fetchAdminVideos,
} from "@/store/slices/adminSlice";

export default function AdminVideos() {
  const dispatch = useAppDispatch();
  const { videos } = useAppSelector((s) => s.admin);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    dispatch(fetchAdminVideos());
  }, [dispatch]);

  const form = useFormik({
    initialValues: {
      title: "",
      description: "",
      video_url: "",
      thumbnail_url: "",
      category: "general",
      is_published: true,
    },
    validationSchema: Yup.object({
      title: Yup.string().required("Required"),
      video_url: Yup.string().url("URL").required("Required"),
    }),
    onSubmit: async (values, { resetForm }) => {
      const r = await dispatch(createVideo(values));
      if (createVideo.fulfilled.match(r)) {
        resetForm();
        setShowForm(false);
        dispatch(fetchAdminVideos());
      }
    },
  });

  const remove = async (id: number) => {
    if (!confirm("Delete this video?")) return;
    await dispatch(deleteVideo({ id }));
    dispatch(fetchAdminVideos());
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={PlayCircle}
        title="Videos"
        description="Manage the client education center."
        actions={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn-primary inline-flex items-center gap-1.5 text-sm"
          >
            <Plus className="w-4 h-4" /> New video
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={form.handleSubmit}
          className="bg-card rounded-2xl border border-border p-6 space-y-3"
        >
          <input
            placeholder="Title"
            {...form.getFieldProps("title")}
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
          />
          <textarea
            placeholder="Description"
            rows={2}
            {...form.getFieldProps("description")}
            className="w-full p-3 rounded-lg border border-input bg-background text-sm text-foreground"
          />
          <input
            placeholder="Video URL (YouTube, Vimeo, MP4)"
            {...form.getFieldProps("video_url")}
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
          />
          <input
            placeholder="Thumbnail URL (optional)"
            {...form.getFieldProps("thumbnail_url")}
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
          />
          <button type="submit" className="btn-primary text-sm">
            Save
          </button>
        </form>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {videos.map((v) => (
          <div
            key={v.id}
            className="bg-card rounded-2xl border border-border overflow-hidden"
          >
            <div className="aspect-video bg-muted/50">
              {v.thumbnail_url && (
                <img
                  src={v.thumbnail_url}
                  alt={v.title}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="p-4">
              <h3 className="font-semibold">{v.title}</h3>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {v.description}
              </p>
              <div className="flex gap-2 mt-3">
                <a
                  href={v.video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 h-9 rounded-lg bg-muted hover:bg-muted/80 text-sm inline-flex items-center justify-center gap-1.5"
                >
                  Open
                </a>
                <button
                  onClick={() => remove(v.id)}
                  className="h-9 px-3 rounded-lg bg-muted hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
