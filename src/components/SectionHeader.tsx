import type { ReactNode } from "react";
import { Flex, Heading, Text } from "@radix-ui/themes";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <Flex align="center" justify="between" gap="3">
      <Flex direction="column" gap="1">
        <Heading size="3">{title}</Heading>
        {subtitle ? (
          <Text size="1" color="gray">
            {subtitle}
          </Text>
        ) : null}
      </Flex>
      {action ? <Flex align="center">{action}</Flex> : null}
    </Flex>
  );
}
