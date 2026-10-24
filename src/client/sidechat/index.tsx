/** Native side-chat registration and plugin-owned lifecycle extensions. */
import type { Context } from '../host/contracts.ts'
import { sideChatBridge } from '../bridge.ts'
import type { ReflowStore } from '../reflow.ts'
import type { AnnotationStore } from '../annotations/model.ts'
import { registerNativeConversation } from './NativeConversation.tsx'
import { registerNativeSideChatTab } from './native-tab.tsx'
import { captureSideChatTarget } from './target.ts'
import { t } from '../locales.ts'
import { registerHeaderEntry } from './header.tsx'
import { registerSideCommand } from './slash.ts'
import { registerSideChatReferenceSource } from './referenceSource.ts'
import { registerToastHost } from './toast.tsx'
import { registerCompletionNotify } from './notify.ts'

export function registerSideChat(ctx: Context, reflow: ReflowStore, annotations: AnnotationStore): void {
  // Both admitted hosts share the native Conversation and sidebar registration.
  registerNativeConversation(ctx)
  registerNativeSideChatTab(ctx, reflow, annotations)
  // annotate 桥：「在侧边聊天中提问」= 新建或聚焦一个侧边聊天 Tab 并写入草稿。
  ctx.effect(() => {
    const impl = {
      captureTarget: (sessionId: string) => captureSideChatTarget(ctx, sessionId),
    }
    sideChatBridge.current = impl
    return () => {
      if (sideChatBridge.current === impl) sideChatBridge.current = null
    }
  }, 'dsh-sidenote: annotate bridge')

  registerSideCommand(ctx)
  // WI-04：主输入框 @ 引用侧边聊天（触发源 + codec 序列化）。
  registerSideChatReferenceSource(ctx)
  // 顶栏「侧边」入口（发现性）：会话头部右上角常驻按钮。
  registerHeaderEntry(ctx)
  // 全局瞬态通知宿主（P4：转正确认等跨 Tab 寿命的反馈）。
  registerToastHost(ctx)
  // 完成通知（WI-03）：侧聊 running 翻转 → toast。
  registerCompletionNotify(ctx)
}
