# Sidenote user guide

English · [中文](usage.md) · [Back to the overview](../README_EN.md)

## Open a side chat

A side chat forks the current main session with a full history snapshot, without compressing it into a summary. It is a real, independent DSH session that supports further conversation.

Use the session header's **Side** button, the right-sidebar entry, or `/side` in the main composer. Side chats support tool cards, thinking previews, task cards, model and permission switching, `@` references, and image attachments. Answer approvals and questions directly in the panel; a notification announces completion.

Inherited history is collapsed by default. Click the inheritance card to expand it. Fold state and scroll position survive reloads; `Alt+J` switches focus between the main and side composers.

![An independent conversation in the native sidebar](assets/sidechat.jpg)

After closing a side chat, reopen the original child through the recently closed options in `/side`. Normal entries focus an existing tab. Native page kinds allow one tab per pane, with multiple panes through splitting. Other BS coexistence combinations and future `multiple` behavior require separate validation; see the [compatibility policy](compatibility_EN.md).

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

Submissions use the host's native input flow, retaining attachments, references, and queue / steer arbitration. Only a durable message or an authoritative queue occurrence in the target session marks the batch as sent and adds an annotation-count label to the message. An empty composer alone does not prove acceptance.

- Failed sends retain annotations and body text. Notes added or edited during submission stay active for the next message.
- Saved annotations are isolated by target session and survive reload. A storage warning explains memory-only operation when persistence is unavailable.
- When the host restores a native tab, it rebinds the original child. If the sidebar is not restored, use **Reopen** in `/side` to recover that child and its annotations.
- A new fork has its own independent annotation list.

## Bring answers back to the main thread

Click **Send back to main session** below a side reply. Both the question and its answer appear above the main composer. Preview or remove entries, then include them in your next main-thread message.

**Reflow all** brings back every question-and-answer pair in the side chat. The main composer can also reference side chats with `@`. Use **Save as session** to keep a discussion in the regular session list.

![A side-chat finding ready to accompany the main-thread draft](assets/workflow.jpg)

## Installation and troubleshooting

See the [overview](../README_EN.md#install) and [compatibility policy](compatibility_EN.md) for installation and verified versions. Native sidebar hosts need no BS; older hosts require the listed combinations. Engine ranges do not imply that every version inside them is verified.

Diagnostics are off by default. For troubleshooting, enable **Settings → General → dsh-sidenote diagnostic mode**, then use **Compatibility diagnostics** in the header to inspect, recheck, or manually export the status.

The choice is local to the current browser and DSH address and survives reload; when local saving is unavailable, it applies only to the current page. Disabling diagnostics preserves capability checks, input recovery, and content retention on failure, and does not change the host's global developer setting. Waiting services do not mean incompatibility. Unreadable host versions remain unknown. Exported reports exclude user text, credentials, and local paths.

## Local development

```bash
dsh plugin --profile web add link:<repo path>
```

Client changes hot-reload; host changes require restarting `dsh web`. See the [contributing guide](../CONTRIBUTING_EN.md) for setup, architecture gates, typechecking, build and test order, and host validation.
