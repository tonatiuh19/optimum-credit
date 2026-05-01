import { useLocation } from "react-router-dom";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="section-container flex items-center justify-center min-h-[70vh]">
      <div className="section-inner max-w-lg mx-auto">
        <div className="card-base p-8 md:p-12 text-center">
          <div className="mb-6">
            <div className="text-6xl font-bold gradient-text mb-2">404</div>
            <div className="w-12 h-1 bg-accent rounded-full mx-auto mb-6" />
          </div>

          <h1 className="text-2xl md:text-3xl font-bold mb-3 text-foreground">
            Page Not Found
          </h1>
          <p className="text-muted-foreground text-base mb-8">
            The page you're looking for doesn't exist yet. If you'd like us to
            create this page, feel free to{" "}
            <button className="text-primary font-semibold hover:underline">
              reach out
            </button>
            .
          </p>

          <Link to="/" className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
