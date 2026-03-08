import type { ReactNode } from "react";
import { Card, Flex, Text } from "@radix-ui/themes";

type QuickActionProps = {
  title: string;
  description: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export function QuickAction({ title, description, icon, active = false, disabled = false, onClick }: QuickActionProps) {
  return (
    <Card
      className="section-card"
      style={{
        height: "100%",
        cursor: onClick && !disabled ? "pointer" : "default",
        boxShadow: active ? "inset 0 0 0 1px rgba(45, 212, 191, 0.6)" : undefined,
        opacity: disabled ? 0.6 : 1
      }}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
    >
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          {icon}
          <Text weight="bold">{title}</Text>
        </Flex>
        <Text size="2" color="gray">
          {description}
        </Text>
      </Flex>
    </Card>
  );
}
