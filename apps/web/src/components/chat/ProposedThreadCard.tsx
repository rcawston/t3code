import type { EnvironmentId, OrchestrationProposedThread } from "@t3tools/contracts";
import { memo } from "react";

import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";

function firstMessagePreview(message: string, max: number): string {
  const bodyStart = message.indexOf("\n\n");
  const body = (bodyStart === -1 ? message : message.slice(bodyStart + 2)).trim();
  if (body.length <= max) {
    return body;
  }
  return `${body.slice(0, max - 1).trimEnd()}…`;
}

export const ProposedThreadCard = memo(function ProposedThreadCard(props: {
  readonly environmentId: EnvironmentId;
  readonly proposal: OrchestrationProposedThread;
}) {
  const respond = useAtomCommand(threadEnvironment.respondToProposal, {
    reportFailure: false,
  });
  const preview = firstMessagePreview(props.proposal.message, 180);

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Proposed thread
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{props.proposal.title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">From {props.proposal.sourceTitle}</div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{preview}</p>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            void respond({
              environmentId: props.environmentId,
              input: { threadId: props.proposal.threadId, decision: "confirm" },
            })
          }
        >
          Confirm
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void respond({
              environmentId: props.environmentId,
              input: { threadId: props.proposal.threadId, decision: "dismiss" },
            })
          }
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
});
