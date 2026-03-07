import { Badge } from "@radix-ui/themes";

type Status = "live" | "idle" | "muted";

type StatusChipProps = {
  status: Status;
  label: string;
};

const STATUS_MAP: Record<Status, { color: "green" | "orange" | "red"; variant: "solid" | "soft" }> = {
  live: { color: "green", variant: "solid" },
  idle: { color: "orange", variant: "soft" },
  muted: { color: "red", variant: "solid" }
};

export function StatusChip({ status, label }: StatusChipProps) {
  const { color, variant } = STATUS_MAP[status];

  return (
    <Badge color={color} variant={variant} size="2">
      {label}
    </Badge>
  );
}
