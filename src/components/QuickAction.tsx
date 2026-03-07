import type { ReactNode } from "react";
import { Card, Flex, Text } from "@radix-ui/themes";

type QuickActionProps = {
  title: string;
  description: string;
  icon: ReactNode;
};

export function QuickAction({ title, description, icon }: QuickActionProps) {
  return (
    <Card className="section-card" style={{ height: "100%" }}>
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
