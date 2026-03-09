import type { ReactNode } from "react";
import { Button, Flex, Text } from "@radix-ui/themes";

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
    <Button
      className="compact-inline-action"
      variant={active ? "solid" : "soft"}
      color={active ? "cyan" : undefined}
      size="2"
      style={{
        cursor: onClick && !disabled ? "pointer" : "default",
        justifyContent: "flex-start",
        opacity: disabled ? 0.6 : 1,
      }}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
      disabled={disabled}
      title={description}
    >
      <Flex align="center" gap="2">
        {icon}
        <Text size="2" weight="bold">
          {title}
        </Text>
      </Flex>
    </Button>
  );
}
