# Sidenote user guide

English · [中文](usage.md) · [Back to the overview](../README_EN.md)

## Open a side chat

A side chat forks the current main session with a full history snapshot, without compressing it into a summary. It is a real, independent DSH session that supports further conversation.

Use the session header's **Side** button, the right-sidebar entry, or `/side` in the main composer. Side chats reuse the main conversation’s native composer, message flow, tools, model and reasoning controls, permissions, commands, file references and attachments. Answer approvals and questions in the panel. Completion notifications require a successful turn; stopping or failing is not completion.

With an image-capable model, focus the side composer and press `⌘V` / `Ctrl+V` to paste clipboard images, or use the attachment button to select them. Images appear above the input and can be removed before sending. Send images on their own or together with text.

Inherited history is collapsed by default. Click the inheritance card to expand it. Fold state and native drafts survive reloads; `Alt+S` switches focus between the main and side composers.

![An independent conversation in the native sidebar](assets/sidechat.jpg)

After closing a side chat, reopen the original child through the recently closed options in `/side`. Normal entries focus an existing tab. Native page kinds allow one tab per pane, with multiple panes through splitting. Only the two native hosts are maintained; outside-window hosts pin plugin 0.6.4; see the [compatibility policy](compatibility_EN.md).

### Session lists and recovery

Side chats stay out of the sidebar list and search results from creation, without briefly flashing into the list. Closing tabs or reloading does not put registered side chats back in the list. Saving as a regular session creates a visible copy.

On supported hosts, hidden side chats remain runnable. To find older side chats, enable **Settings → General → Show side chats in the session list**; the choice is local to this browser and DSH address. Historical 0.6.4 Releases retain their archive-based behavior. This setting does not recover deleted sessions or undo existing legacy archives; see the [compatibility policy](compatibility_EN.md).

## Select and annotate

1. Select a passage in a completed assistant reply.
2. Choose to add it to the main conversation or ask in a side chat, then write a note.
3. Click outside the editor or press `Enter` to save a new note; press `Esc` to cancel.
4. Preview notes above the composer, add more, remove individual notes or clear all, then send.

![Adding a focused question to a selected passage](assets/selection.jpg)

Quotes and notes stay complete without being inserted into the body draft. Send a quote on its own, or together with text, images, and `@` references. Repeated selections accumulate annotations; numbered badges at the source help you find each passage.

**Selections in the main conversation** can go to the main conversation or a side chat. Main-to-side handoff waits for the chosen tab's actual child session. Press `Esc` to cancel the wait; a failed handoff keeps the note open for retry.

**Selections in a side chat** go only to that side chat, including selections in its inherited history. Partial text, paragraphs, lists, and code are supported. Streaming replies, cross-message selections, reasoning, and interface controls are excluded.

Badges and highlights follow the source message and stay within its visible area. Folding the source keeps the annotation available above the composer.

### Sending and recovery

Submissions use the host's native input flow, retaining attachments, references, and queue / steer arbitration. Only a durable message or an authoritative queue occurrence in the target session marks the batch as sent and adds an annotation-count label to the message. An empty composer alone does not prove acceptance. With no body, click **Send annotations**; it uses the same native submission transaction. During a reply, queue new messages and manage the visible native queue. Ctrl/Cmd+Enter steers; the next send wakes work preserved by Stop.

- Failed sends retain annotations and body text. Notes added or edited during submission stay active for the next message.
- Saved annotations are isolated by target session and survive reload. A storage warning explains memory-only operation when persistence is unavailable.
- When the host restores a native tab, it rebinds the original child. If the sidebar is not restored, use **Reopen** in `/side` to recover that child and its annotations.
- A new fork has its own independent annotation list.

## Bring answers back to the main thread

Click **Send back to main session** below a side reply. Both the question and its answer appear above the main composer. Preview or remove entries, then include them in your next main-thread message.

Reflows are acknowledged individually after injection. Conclusions that were not injected travel with your next message. If that send is rejected, the draft and those pending conclusions remain available for retry; conclusions already acknowledged are not added to the message again.

**Reflow all** includes only completed final answers added after the fork, excluding inherited history, intermediate output, stopped and failed turns. Already-added answers do not duplicate; removing a pending entry enables adding it again. The main composer can also reference side chats with `@`. Use **Save as session** to create a visible copy of completed history. Saving is blocked while running, submitting, queued, or holding unsent text, attachments or annotations. Send or clear unsent content before saving.

![A side-chat finding ready to accompany the main-thread draft](assets/workflow.jpg)

## Installation and troubleshooting

See the [overview](../README_EN.md#install) and [compatibility policy](compatibility_EN.md) for installation and verified versions. Supported native hosts need no BS; outside-window hosts pin the last compatible plugin, 0.6.4. Engine ranges do not imply that every version inside them is verified.

Diagnostics are off by default. For troubleshooting, enable **Settings → General → dsh-sidenote diagnostic mode**, then use **Compatibility diagnostics** in the header to inspect, recheck, or manually export the status.

The choice is local to the current browser and DSH address and survives reload; when local saving is unavailable, it applies only to the current page. Disabling diagnostics preserves capability checks, input recovery, and content retention on failure, and does not change the host's global developer setting. Waiting services do not mean incompatibility. Unreadable host versions remain unknown. Exported reports exclude user text, credentials, and local paths.

## Local development

```bash
dsh plugin --profile web add link:<repo path>
```

Client changes hot-reload; host changes require restarting `dsh web`. See the [contributing guide](../CONTRIBUTING_EN.md) for setup, architecture gates, typechecking, build and test order, and host validation.
