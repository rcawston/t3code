# Message another thread

Agents working in the same project can see other active threads and send them a short text
message. This is useful when two conversations need to hand off a question, a finding, or a
warning without you copying it by hand.

The agent lists siblings in the current project, then sends to one of them by its stable thread
id. Titles are only labels. The receiving thread shows the message as a user turn, attributed to
the sending thread, and starts or continues work in the usual way.

Messages stay inside one project on one T3 Code environment. An agent cannot read another
thread's transcript, wait for that thread to finish, or message a thread in a different project.
Archived threads do not appear in the list and cannot be used as a target.

If the target thread is idle or stopped, T3 Code starts it. If it is already working, the message
follows the same steering path as a message you send from the composer.
