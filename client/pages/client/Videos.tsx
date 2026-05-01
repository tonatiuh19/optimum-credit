import { useEffect } from "react";
import { PlayCircle } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchVideos } from "@/store/slices/portalSlice";

export default function Videos() {
  const dispatch = useAppDispatch();
  const { videos } = useAppSelector((s) => s.portal);

  useEffect(() => {
    dispatch(fetchVideos());
  }, [dispatch]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <PlayCircle className="w-7 h-7 text-primary" /> Education Center
        </h1>
        <p className="text-muted-foreground">
          Quick lessons to help you build credit smartly.
        </p>
      </div>

      {videos.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center text-muted-foreground">
          New videos coming soon.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v) => (
            <div
              key={v.id}
              className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              <a
                href={v.video_url}
                target="_blank"
                rel="noreferrer"
                className="block aspect-video bg-secondary relative"
                style={
                  v.thumbnail_url
                    ? {
                        backgroundImage: `url(${v.thumbnail_url})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              >
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors">
                  <PlayCircle className="w-12 h-12 text-white drop-shadow-lg" />
                </div>
              </a>
              <div className="p-4">
                <h3 className="font-semibold leading-tight">{v.title}</h3>
                {v.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {v.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
