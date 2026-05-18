import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Image,
  Link2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createVideo,
  deleteVideo,
  fetchAdminVideos,
  updateVideo,
  uploadEducationalFile,
} from "@/store/slices/adminSlice";
import type { EducationalVideo } from "@shared/api";
import { logger } from "@/utils/logger";

type ContentType = "video" | "pdf" | "image" | "article";

const TYPE_META: Record<
  ContentType,
  { label: string; icon: React.ElementType; color: string; badge: string }
> = {
  video: {
    label: "Video",
    icon: Video,
    color: "text-primary",
    badge: "bg-primary/10 text-primary",
  },
  pdf: {
    label: "PDF",
    icon: FileText,
    color: "text-destructive",
    badge: "bg-destructive/10 text-destructive",
  },
  image: {
    label: "Image",
    icon: Image,
    color: "text-accent",
    badge: "bg-accent/10 text-accent",
  },
  article: {
    label: "Article",
    icon: BookOpen,
    color: "text-secondary-foreground",
    badge: "bg-secondary text-secondary-foreground",
  },
};

const CATEGORIES = [
  "Credit Basics",
  "Score Improvement",
  "Dispute Process",
  "Financial Health",
  "Legal Rights",
  "General",
];

const initialValues = {
  title: "",
  content_type: "video" as ContentType,
  description: "",
  video_url: "",
  thumbnail_url: "",
  category: "General",
  language: "en" as "en" | "es",
  is_published: 1,
  sort_order: 0,
};

export default function AdminVideos() {
  const dispatch = useAppDispatch();
  const { videos } = useAppSelector((s) => s.admin);
  const [filter, setFilter] = useState<ContentType | "all">("all");
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<EducationalVideo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dispatch(fetchAdminVideos());
  }, [dispatch]);

  const openCreate = () => {
    setEditing(null);
    setUploadedUrl(null);
    form.resetForm({ values: initialValues });
    setShowDialog(true);
  };

  const openEdit = (v: EducationalVideo) => {
    setEditing(v);
    setUploadedUrl(v.file_url ?? null);
    form.resetForm({
      values: {
        title: v.title,
        content_type: (v.content_type as ContentType) ?? "video",
        description: v.description ?? "",
        video_url: v.video_url ?? "",
        thumbnail_url: v.thumbnail_url ?? "",
        category: v.category ?? "General",
        language: (v.language as "en" | "es") ?? "en",
        is_published: v.is_published ?? 1,
        sort_order: v.sort_order ?? 0,
      },
    });
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditing(null);
    setUploadedUrl(null);
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const r = await dispatch(uploadEducationalFile(file));
      if (uploadEducationalFile.fulfilled.match(r)) {
        setUploadedUrl(r.payload.url);
        form.setFieldValue("video_url", "");
      }
    } catch (err) {
      logger.error("Educational file upload failed", err);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const form = useFormik({
    initialValues,
    validationSchema: Yup.object({
      title: Yup.string().required("Title is required"),
      content_type: Yup.string().required(),
    }),
    onSubmit: async (values, { resetForm }) => {
      const payload: Partial<EducationalVideo> = {
        ...values,
        file_url: uploadedUrl || undefined,
        video_url: values.video_url || undefined,
      };
      let result;
      if (editing) {
        result = await dispatch(updateVideo({ id: editing.id, ...payload }));
      } else {
        result = await dispatch(createVideo(payload));
      }
      const matched =
        (editing && updateVideo.fulfilled.match(result)) ||
        (!editing && createVideo.fulfilled.match(result));
      if (matched) {
        resetForm();
        closeDialog();
        dispatch(fetchAdminVideos());
      }
    },
  });

  const togglePublish = async (v: EducationalVideo) => {
    await dispatch(
      updateVideo({
        id: v.id,
        title: v.title,
        content_type: v.content_type,
        description: v.description,
        video_url: v.video_url,
        file_url: v.file_url,
        thumbnail_url: v.thumbnail_url,
        duration_seconds: v.duration_seconds,
        category: v.category,
        language: v.language,
        is_published: v.is_published ? 0 : 1,
        sort_order: v.sort_order,
      }),
    );
    dispatch(fetchAdminVideos());
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this content item?")) return;
    await dispatch(deleteVideo({ id }));
    dispatch(fetchAdminVideos());
  };

  const filtered =
    filter === "all" ? videos : videos.filter((v) => v.content_type === filter);

  const contentType = form.values.content_type as ContentType;
  const needsFile = contentType !== "article";
  const TypeIcon = TYPE_META[contentType]?.icon ?? Video;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={BookOpen}
        title="Education Center"
        description="Manage educational content for clients — videos, PDFs, images and articles."
        actions={
          <button
            onClick={openCreate}
            className="btn-primary inline-flex items-center gap-1.5 text-sm"
          >
            <Plus className="w-4 h-4" /> Add Content
          </button>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "video", "pdf", "image", "article"] as const).map((t) => {
          const meta =
            t === "all"
              ? { label: "All", icon: null }
              : TYPE_META[t as ContentType];
          const Icon = t !== "all" ? (meta as any).icon : null;
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all border ${
                filter === t
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {meta.label}
              {t !== "all" && (
                <span className="ml-0.5 text-xs opacity-60">
                  ({videos.filter((v) => v.content_type === t).length})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BookOpen className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-medium">No content yet</p>
          <p className="text-sm mt-1">
            Add videos, PDFs, images or articles above.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((v) => {
            const meta = TYPE_META[(v.content_type as ContentType) ?? "video"];
            const Icon = meta?.icon ?? Video;
            const previewUrl = v.file_url ?? v.video_url ?? "";
            return (
              <div
                key={v.id}
                className={`bg-card rounded-2xl border overflow-hidden group transition-all hover:shadow-md ${
                  v.is_published
                    ? "border-border"
                    : "border-dashed border-muted-foreground/30 opacity-70"
                }`}
              >
                {/* Thumbnail / Preview */}
                <div className="relative aspect-video bg-muted/40 overflow-hidden">
                  {v.content_type === "image" && previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : v.thumbnail_url ? (
                    <img
                      src={v.thumbnail_url}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon
                        className={`w-12 h-12 opacity-20 ${meta?.color ?? ""}`}
                      />
                    </div>
                  )}
                  {/* type badge */}
                  <span
                    className={`absolute top-2 left-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${meta?.badge ?? ""}`}
                  >
                    <Icon className="w-3 h-3" />
                    {meta?.label}
                  </span>
                  {!v.is_published && (
                    <span className="absolute top-2 right-2 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                      Draft
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <h3 className="font-semibold text-sm leading-snug line-clamp-2">
                    {v.title}
                  </h3>
                  {v.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {v.description}
                    </p>
                  )}
                  {v.category && (
                    <span className="inline-block mt-2 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {v.category}
                    </span>
                  )}

                  <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                    {/* Preview */}
                    {previewUrl && (
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 h-8 rounded-lg bg-muted hover:bg-muted/80 text-xs inline-flex items-center justify-center gap-1 text-muted-foreground transition-colors"
                      >
                        <Link2 className="w-3 h-3" /> Preview
                      </a>
                    )}
                    {/* Publish toggle */}
                    <button
                      onClick={() => togglePublish(v)}
                      className="h-8 px-2.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                      title={v.is_published ? "Unpublish" : "Publish"}
                    >
                      {v.is_published ? (
                        <Eye className="w-3.5 h-3.5" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => openEdit(v)}
                      className="h-8 px-2.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => remove(v.id)}
                      className="h-8 px-2.5 rounded-lg bg-muted hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeDialog}
          />
          <div className="relative w-full max-w-xl bg-card rounded-2xl border border-border shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-primary" />
                </div>
                <h2 className="font-semibold text-foreground">
                  {editing ? "Edit Content" : "Add New Content"}
                </h2>
              </div>
              <button
                onClick={closeDialog}
                className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={form.handleSubmit}
              className="p-6 space-y-4 max-h-[80vh] overflow-y-auto"
            >
              {/* Content type selector */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-2">
                  CONTENT TYPE
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["video", "pdf", "image", "article"] as ContentType[]).map(
                    (t) => {
                      const m = TYPE_META[t];
                      const TIcon = m.icon;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            form.setFieldValue("content_type", t);
                            setUploadedUrl(null);
                          }}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-xs font-medium transition-all ${
                            contentType === t
                              ? `border-primary bg-primary/5 text-primary`
                              : "border-border text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          <TIcon className="w-5 h-5" />
                          {m.label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                  TITLE *
                </label>
                <input
                  placeholder={`${TYPE_META[contentType]?.label ?? "Content"} title`}
                  {...form.getFieldProps("title")}
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {form.touched.title && form.errors.title && (
                  <p className="text-destructive text-xs mt-1">
                    {form.errors.title}
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                  DESCRIPTION
                </label>
                <textarea
                  placeholder="Optional description..."
                  rows={2}
                  {...form.getFieldProps("description")}
                  className="w-full p-3 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* File upload or URL */}
              {needsFile && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    {contentType === "video"
                      ? "VIDEO FILE OR EXTERNAL URL"
                      : `${TYPE_META[contentType].label.toUpperCase()} FILE`}
                  </label>

                  {uploadedUrl ? (
                    <div className="flex items-center gap-2 p-3 bg-accent/10 border border-accent/30 rounded-lg">
                      <TypeIcon className="w-4 h-4 text-accent shrink-0" />
                      <span className="text-xs text-accent flex-1 truncate">
                        Uploaded successfully
                      </span>
                      <button
                        type="button"
                        onClick={() => setUploadedUrl(null)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Drop zone */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                          dragOver
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40 hover:bg-muted/30"
                        }`}
                      >
                        {uploading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            Uploading...
                          </div>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-muted-foreground" />
                            <div className="text-center">
                              <p className="text-sm font-medium text-foreground">
                                Drop file here or click to browse
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {contentType === "video"
                                  ? "MP4, WebM, MOV"
                                  : contentType === "pdf"
                                    ? "PDF"
                                    : "JPG, PNG, WebP, GIF"}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept={
                          contentType === "video"
                            ? "video/*"
                            : contentType === "pdf"
                              ? ".pdf"
                              : "image/*"
                        }
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f);
                        }}
                      />
                      {/* URL fallback for video */}
                      {contentType === "video" && (
                        <div className="relative">
                          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                            <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <input
                            placeholder="Or paste YouTube / Vimeo / MP4 URL"
                            {...form.getFieldProps("video_url")}
                            className="w-full h-9 pl-9 pr-3 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Thumbnail (optional) */}
              {(contentType === "video" || contentType === "article") && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    THUMBNAIL URL (optional)
                  </label>
                  <input
                    placeholder="https://..."
                    {...form.getFieldProps("thumbnail_url")}
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {/* Article URL for articles */}
              {contentType === "article" && (
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    ARTICLE URL *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <input
                      placeholder="https://..."
                      {...form.getFieldProps("video_url")}
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}

              {/* Category + Language row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    CATEGORY
                  </label>
                  <div className="relative">
                    <select
                      {...form.getFieldProps("category")}
                      className="w-full h-10 px-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                    LANGUAGE
                  </label>
                  <div className="relative">
                    <select
                      {...form.getFieldProps("language")}
                      className="w-full h-10 px-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="en">English</option>
                      <option value="es">Español</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Published toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  onClick={() =>
                    form.setFieldValue(
                      "is_published",
                      form.values.is_published ? 0 : 1,
                    )
                  }
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    form.values.is_published ? "bg-accent" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                      form.values.is_published ? "left-5" : "left-1"
                    }`}
                  />
                </div>
                <span className="text-sm text-foreground">
                  {form.values.is_published
                    ? "Published — visible to clients"
                    : "Draft — hidden from clients"}
                </span>
              </label>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={form.isSubmitting || uploading}
                  className="flex-1 h-10 rounded-xl btn-primary text-sm font-semibold disabled:opacity-60 transition-opacity"
                >
                  {form.isSubmitting
                    ? "Saving..."
                    : editing
                      ? "Update"
                      : "Add Content"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
