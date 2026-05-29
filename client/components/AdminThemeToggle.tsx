import ThemeToggle from "@/components/ThemeToggle";

interface Props {
  collapsed?: boolean;
  compact?: boolean;
  className?: string;
}

export default function AdminThemeToggle(props: Props) {
  return <ThemeToggle zone="admin" {...props} />;
}
