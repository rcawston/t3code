import type { EnvironmentId, OrchestrationProposedThread } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

function firstMessagePreview(message: string, max: number): string {
  const bodyStart = message.indexOf("\n\n");
  const body = (bodyStart === -1 ? message : message.slice(bodyStart + 2)).trim();
  if (body.length <= max) {
    return body;
  }
  return `${body.slice(0, max - 1).trimEnd()}…`;
}

export function ProposedThreadCard(props: {
  readonly environmentId: EnvironmentId;
  readonly proposal: OrchestrationProposedThread;
}) {
  const respond = useAtomCommand(threadEnvironment.respondToProposal, {
    reportFailure: false,
  });
  const preview = firstMessagePreview(props.proposal.message, 160);

  return (
    <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Text className="text-xs font-medium uppercase text-foreground-muted">Proposed thread</Text>
      <Text className="text-base font-medium text-foreground">{props.proposal.title}</Text>
      <Text className="text-sm text-foreground-muted">From {props.proposal.sourceTitle}</Text>
      <Text className="text-sm text-foreground">{preview}</Text>
      <View className="mt-1 flex-row gap-2">
        <Pressable
          className="rounded-lg bg-primary px-3 py-1.5"
          onPress={() =>
            void respond({
              environmentId: props.environmentId,
              input: { threadId: props.proposal.threadId, decision: "confirm" },
            })
          }
        >
          <Text className="text-sm font-medium text-primary-foreground">Confirm</Text>
        </Pressable>
        <Pressable
          className="rounded-lg px-3 py-1.5"
          onPress={() =>
            void respond({
              environmentId: props.environmentId,
              input: { threadId: props.proposal.threadId, decision: "dismiss" },
            })
          }
        >
          <Text className="text-sm font-medium text-foreground">Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
