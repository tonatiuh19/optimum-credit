import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

interface ClientPageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}

export default function ClientPageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: ClientPageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          {Icon && <Icon className="w-7 h-7 text-primary shrink-0" />}
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2.5 shrink-0">{actions}</div>
      )}
    </div>
  );
}
