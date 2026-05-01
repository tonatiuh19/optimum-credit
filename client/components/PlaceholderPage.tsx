import { HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export default function PlaceholderPage({
  title,
  description = "This page is coming soon. We're building something great here!",
}: PlaceholderPageProps) {
  return (
    <div className="section-container flex items-center justify-center min-h-[70vh]">
      <div className="section-inner max-w-lg mx-auto">
        <div className="card-base p-8 md:p-12 text-center">
          <div className="mb-6 flex justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <HelpCircle className="w-8 h-8" />
            </div>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold mb-3 text-foreground">
            {title}
          </h1>
          <p className="text-muted-foreground text-base mb-8">{description}</p>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              In the meantime, explore our homepage to learn more about our
              credit repair services.
            </p>
            <Link to="/" className="btn-primary inline-block">
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
