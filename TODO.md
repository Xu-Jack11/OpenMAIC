# TODO

## 待开发功能

### 1. 导出课堂讲义

基于已生成的课堂场景（slides、quiz、interactive、pbl），将完整课堂内容导出为结构化讲义文档。

- [ ] 设计讲义数据结构，整合多场景内容（幻灯片文本、Quiz 题目与答案、互动模拟说明、PBL 任务描述）
- [ ] 实现讲义生成逻辑，利用 LLM 对原始场景内容进行整理和润色
- [ ] 支持导出格式：PDF、DOCX、Markdown
- [ ] 在课堂页面添加「导出讲义」入口
- [ ] i18n：添加 zh-CN / en-US 翻译

### 2. 根据课堂内容设计实验并支持导出

根据课堂主题和内容，由 LLM 生成配套实验方案，包含实验目的、材料、步骤、预期结果等。

- [ ] 定义实验方案数据结构（目的、材料清单、步骤、安全注意事项、预期结果、思考题）
- [ ] 编写实验生成 Prompt 模板（`lib/generation/prompts/templates/experiment/`）
- [ ] 实现实验生成 API（`/api/generate/experiment`）
- [ ] 实现实验预览 UI 组件
- [ ] 支持导出格式：PDF、DOCX
- [ ] 在课堂页面添加「生成实验方案」入口
- [ ] i18n：添加 zh-CN / en-US 翻译

### 3. 根据课堂内容生成课外阅读内容并支持导出

根据课堂主题，由 LLM 生成拓展阅读材料，包含延伸知识、推荐资源、阅读引导问题等。

- [ ] 定义课外阅读数据结构（主题概述、延伸知识点、推荐资源列表、引导问题）
- [ ] 编写课外阅读生成 Prompt 模板（`lib/generation/prompts/templates/reading/`）
- [ ] 实现课外阅读生成 API（`/api/generate/reading`）
- [ ] 实现课外阅读预览 UI 组件
- [ ] 支持导出格式：PDF、DOCX、Markdown
- [ ] 在课堂页面添加「生成课外阅读」入口
- [ ] i18n：添加 zh-CN / en-US 翻译
