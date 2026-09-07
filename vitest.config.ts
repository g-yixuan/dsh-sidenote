import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    environment: 'node',
    server: {
      deps: {
        // ToolCard 冒烟测（renderToString）需要真实 primitives；内联进
        // vitest 管道使 .css import 变空模块（node ESM 直加载会崩）。
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
  },
})
