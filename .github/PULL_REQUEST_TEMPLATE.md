## 这个 PR 做了什么

<!-- 一句话说清「为什么」，而不只是「改了什么」 -->

## 改动类型

- [ ] 修复（不改行为的 bug fix）
- [ ] 新能力（新工具 / 新 DSL 能力 / 渲染保真度）
- [ ] 新宿主适配（adapter）
- [ ] 重构（行为不变）
- [ ] 文档 / 示例 / 翻译
- [ ] 构建 / CI / 依赖

## 验证方式（**必填**）

贴出你实际跑过的命令与结果。CI 会跑同一套：

```bash
(cd mcp-server     && npm test)                          # 预期 716 例
(cd plugin-mastergo && yarn typecheck && yarn test)      # 预期 374 例
(cd plugin-penpot   && yarn typecheck && yarn test)      # 预期 592 例
npm run build:server && npm run build:plugin && npm run build:penpot
npm run license:check && npm run docs:check && npm run skill:check
```

- [ ] 上述命令全部通过（贴关键输出）
- [ ] 若改了渲染/DSL 映射：附**改动前后**的画布截图或导出 DSL 对照
- [ ] 若改了插件 UI：附截图

## 设计约束自查

- [ ] **不静默降级**：宿主表达不了的能力已在响应里**显式上报**（`skipped` / `available:false` / `unresolvedClasses`），没有悄悄丢字段
- [ ] **宿主无关**：没有把某一宿主的专有概念写进核心路径（宿主差异收敛在 adapter / `plugin-*` 层）
- [ ] **单一事实来源**：没有在第二处复制版本号、包名、路径清单或能力清单
- [ ] **命名契约**：改了组件 / 图层命名的话，已同步 `skills/design/rules/16-component-catalog.md` 与相关门禁

## 关联

Closes #
<!-- 影响接口 / 协议的话，请同时提 ADR（docs/decisions/） -->
