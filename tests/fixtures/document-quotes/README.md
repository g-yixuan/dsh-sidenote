这些小文件仅用于真实宿主的文件预览验收，不含个人数据：

- `paper.pdf`：两页最小 PDF，包含可选中文字和明确页码，用于单页及跨页摘录。
- `notes.docx`：两页 Word，第一页为 `Office excerpt marker`，用于验证官方 Office → PDF 通路及原始文件来源。
- `slides.pptx`：一页演示文稿，包含 `Slide excerpt marker`，用于验证幻灯片预览的文字摘录。

Office 样例使用 python-docx／python-pptx 创建，作者统一为 dsh-sidenote；这些工具不属于插件或测试运行时依赖。测试将样例复制到隔离的临时工作区，不访问用户真实文档。
