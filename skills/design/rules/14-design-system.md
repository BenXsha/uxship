# 设计系统创建工作流

## 概述

通过 MasterGo MCP 工具链，在画布上建立完整的视觉设计系统，包括设计令牌（Token）参考页和可复用的 Component Master 资产库。一次创建，后续所有设计统一引用。

---

## 第一阶段：设计令牌参考页

### 0.1 页面创建

在开始任何渲染前，先创建专用页面并切换过去，确保所有设计系统资产集中管理：

```
task_plan([{id:"page", label:"准备设计系统页面"}, {id:"tokens", label:"生成令牌面板"}, {id:"components", label:"生成组件库"}, {id:"icons", label:"生成图标集"}])

task_step("page", "running")
page_create("设计系统")
page_switch("设计系统")
task_step("page", "completed")
```

后续所有 token 面板、组件、图标都渲染在此页面，同页面内通过坐标错开位置防止重叠。

### 1.1 色彩令牌（渲染在页面左上角 x=50, y=50）

使用 HTML+Tailwind 生成色板网格，通过 `code_to_design` 渲染到画布。

色板按角色后缀命名（Text/Hover/Bg/Border），便于后续 `design_to_code` 的 token 导出工具识别。

```html
<section class="flex flex-col gap-6 p-8" data-name="Color Tokens">
  <!-- Brand Colors -->
  <section class="flex flex-col gap-3" data-name="Brand Colors">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Section Label">BRAND</p>
    <section class="flex flex-row gap-4" data-name="Swatches">
      <section class="flex flex-col items-center gap-2" data-name="Brand Text">
        <section class="w-16 h-16 rounded-lg" style="background:#4340EA" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Text<br/>#4340EA</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Brand Hover">
        <section class="w-16 h-16 rounded-lg" style="background:#3533C4" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Hover<br/>#3533C4</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Brand Bg">
        <section class="w-16 h-16 rounded-lg" style="background:#EEEDFE" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Bg<br/>#EEEDFE</p>
      </section>
    </section>
  </section>

  <!-- Neutral Colors -->
  <section class="flex flex-col gap-3" data-name="Neutral Colors">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Section Label">NEUTRAL</p>
    <section class="flex flex-row gap-4" data-name="Swatches">
      <section class="flex flex-col items-center gap-2" data-name="Neutral Bg">
        <section class="w-16 h-16 rounded-lg border" style="background:#FFFFFF" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Bg<br/>#FFFFFF</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Neutral Bg Hover">
        <section class="w-16 h-16 rounded-lg" style="background:#F9FAFB" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Bg Hover<br/>#F9FAFB</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Neutral Bg Active">
        <section class="w-16 h-16 rounded-lg" style="background:#F3F4F6" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Bg Active<br/>#F3F4F6</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Neutral Border">
        <section class="w-16 h-16 rounded-lg" style="background:#E5E7EB" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Border<br/>#E5E7EB</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Neutral Border Hover">
        <section class="w-16 h-16 rounded-lg" style="background:#9CA3AF" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Border Hover<br/>#9CA3AF</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Neutral Text Secondary">
        <section class="w-16 h-16 rounded-lg" style="background:#6B7280" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Text Secondary<br/>#6B7280</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Neutral Text">
        <section class="w-16 h-16 rounded-lg" style="background:#111827" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Text<br/>#111827</p>
      </section>
    </section>
  </section>

  <!-- Semantic Colors -->
  <section class="flex flex-col gap-3" data-name="Semantic Colors">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Section Label">SEMANTIC</p>
    <section class="flex flex-row gap-4" data-name="Swatches">
      <section class="flex flex-col items-center gap-2" data-name="Success">
        <section class="w-16 h-16 rounded-lg" style="background:#22C55E" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Success<br/>#22C55E</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Warning">
        <section class="w-16 h-16 rounded-lg" style="background:#F59E0B" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Warning<br/>#F59E0B</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Error">
        <section class="w-16 h-16 rounded-lg" style="background:#EF4444" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Error<br/>#EF4444</p>
      </section>
      <section class="flex flex-col items-center gap-2" data-name="Info">
        <section class="w-16 h-16 rounded-lg" style="background:#3B82F6" data-name="Swatch"></section>
        <p class="text-xs text-center" data-name="Label">Info<br/>#3B82F6</p>
      </section>
    </section>
  </section>
</section>
```

### 1.2 字阶令牌

字阶按语义分类（Headings / Labels / Copy / Button），增加 Mono 配对变体和 13px 中间档。Labels 用于单行紧凑 + 图标对齐，Copy 用于多行阅读。

```html
<section class="flex flex-col gap-6 p-8" data-name="Typography Tokens">
  <p class="text-base font-bold" data-name="Section Label">Typography Scale</p>

  <!-- Headings -->
  <section class="flex flex-col gap-2" data-name="Headings">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">HEADINGS</p>
    <p class="text-4xl font-bold" data-name="H1">H1 — 36px Bold — 页面标题</p>
    <p class="text-2xl font-bold" data-name="H2">H2 — 24px Bold — 区块标题</p>
    <p class="text-xl font-semibold" data-name="H3">H3 — 20px Semibold — 卡片标题</p>
    <p class="text-base font-semibold" data-name="H4">H4 — 16px Semibold — 组标题</p>
  </section>

  <!-- Labels (single-line, compact, icon-aligned) -->
  <section class="flex flex-col gap-2" data-name="Labels">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">LABELS</p>
    <p class="text-base font-semibold" data-name="Label 16">Label 16 Strong — 列表标题</p>
    <p class="text-sm font-semibold" data-name="Label 14">Label 14 Strong — 菜单/导航</p>
    <p class="text-sm font-mono" data-name="Label 14 Mono">Label 14 Mono — 技术标签</p>
    <p class="text-sm" data-name="Label 13">Label 13 — 次级信息</p>
    <p class="text-sm font-mono" data-name="Label 13 Mono">Label 13 Mono — 内联代码</p>
    <p class="text-xs" data-name="Label 12">Label 12 — 辅助标注</p>
  </section>

  <!-- Copy (multi-line, spacious, reading) -->
  <section class="flex flex-col gap-2" data-name="Copy">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">COPY</p>
    <p class="text-base" data-name="Copy 16">Copy 16 — 正文段落</p>
    <p class="text-sm" data-name="Copy 14">Copy 14 — 紧凑正文</p>
    <p class="text-sm" data-name="Copy 13">Copy 13 — 次级正文</p>
    <p class="text-sm font-mono" data-name="Copy 13 Mono">Copy 13 Mono — 代码段落</p>
  </section>

  <!-- Button (dedicated sizes) -->
  <section class="flex flex-col gap-2" data-name="Buttons">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">BUTTON</p>
    <p class="text-base" data-name="Button 16">Button 16 — 大按钮</p>
    <p class="text-sm" data-name="Button 14">Button 14 — 默认按钮</p>
    <p class="text-xs" data-name="Button 12">Button 12 — 紧凑按钮</p>
  </section>
</section>
```

### 1.3 间距令牌

移除 20px（冗余），新增 6px（紧凑 UI 刚需）和 40px/48px（大间距场景）。

```html
<section class="flex flex-col gap-6 p-8" data-name="Spacing Tokens">
  <p class="text-base font-bold" data-name="Section Label">Spacing Scale</p>
  <section class="flex flex-col gap-3" data-name="Scale">
    <section class="flex flex-row items-center gap-4" data-name="Space 4">
      <section class="h-8" style="width:4px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">4px — 最小间距</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 6">
      <section class="h-8" style="width:6px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">6px — 紧凑 UI</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 8">
      <section class="h-8" style="width:8px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">8px — 元素间隙</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 12">
      <section class="h-8" style="width:12px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">12px — 紧凑间距</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 16">
      <section class="h-8" style="width:16px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">16px — 标准间距</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 24">
      <section class="h-8" style="width:24px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">24px — 区块间距</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 32">
      <section class="h-8" style="width:32px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">32px — 大区块间距</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 40">
      <section class="h-8" style="width:40px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">40px — 章节间距</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 48">
      <section class="h-8" style="width:48px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">48px — 大章节间距</p>
    </section>
    <section class="flex flex-row items-center gap-4" data-name="Space 64">
      <section class="h-8" style="width:64px;background:#4340EA;border-radius:2px" data-name="Bar"></section>
      <p class="text-sm" data-name="Label">64px — 页面间距</p>
    </section>
  </section>
</section>
```

### 1.4 阴影令牌

```html
<section class="flex flex-col gap-6 p-8" data-name="Shadow Tokens">
  <p class="text-base font-bold" data-name="Section Label">Shadow Elevations</p>
  <section class="flex flex-row gap-6" data-name="Cards">
    <section class="flex flex-col items-center gap-2 w-24 h-24 rounded-lg bg-white" style="box-shadow:0 1px 2px rgba(0,0,0,0.05)" data-name="Shadow SM">
      <p class="text-xs mt-8" data-name="Label">Shadow SM<br/>卡片悬浮</p>
    </section>
    <section class="flex flex-col items-center gap-2 w-24 h-24 rounded-lg bg-white" style="box-shadow:0 4px 6px rgba(0,0,0,0.07)" data-name="Shadow MD">
      <p class="text-xs mt-8" data-name="Label">Shadow MD<br/>下拉菜单</p>
    </section>
    <section class="flex flex-col items-center gap-2 w-24 h-24 rounded-lg bg-white" style="box-shadow:0 10px 15px rgba(0,0,0,0.1)" data-name="Shadow LG">
      <p class="text-xs mt-8" data-name="Label">Shadow LG<br/>模态框</p>
    </section>
    <section class="flex flex-col items-center gap-2 w-24 h-24 rounded-lg bg-white" style="box-shadow:0 20px 25px rgba(0,0,0,0.15)" data-name="Shadow XL">
      <p class="text-xs mt-8" data-name="Label">Shadow XL<br/>通知/提示</p>
    </section>
  </section>
</section>
```

### 1.5 材质令牌（Material Tokens）

借鉴 Geist 的 Surface/Floating 概念，用背景色和阴影组合定义 UI 表面层级。

```html
<section class="flex flex-col gap-6 p-8" data-name="Material Tokens">
  <p class="text-base font-bold" data-name="Section Label">Material Layers</p>

  <!-- Surface (平面层级：按钮、卡片、面板) -->
  <section class="flex flex-col gap-3" data-name="Surface">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">SURFACE</p>
    <section class="flex flex-row gap-4" data-name="Cards">
      <section class="flex flex-col items-center justify-center w-24 h-24 rounded-lg" style="background:#FFFFFF;border:1px solid #E5E7EB" data-name="Surface Material 1">
        <p class="text-xs text-center" data-name="Label">Surface 1<br/>默认面板</p>
      </section>
      <section class="flex flex-col items-center justify-center w-24 h-24 rounded-lg" style="background:#F9FAFB;border:1px solid #E5E7EB" data-name="Surface Material 2">
        <p class="text-xs text-center" data-name="Label">Surface 2<br/>hover/二级</p>
      </section>
    </section>
  </section>

  <!-- Floating (浮动层级：弹窗、下拉、模态) -->
  <section class="flex flex-col gap-3" data-name="Floating">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">FLOATING</p>
    <section class="flex flex-row gap-4" data-name="Cards">
      <section class="flex flex-col items-center justify-center w-24 h-24 rounded-lg" style="background:#FFFFFF;box-shadow:0 4px 12px rgba(0,0,0,0.08)" data-name="Floating Material 1">
        <p class="text-xs text-center" data-name="Label">Floating 1<br/>下拉菜单</p>
      </section>
      <section class="flex flex-col items-center justify-center w-24 h-24 rounded-lg" style="background:#FFFFFF;box-shadow:0 12px 24px rgba(0,0,0,0.12)" data-name="Floating Material 2">
        <p class="text-xs text-center" data-name="Label">Floating 2<br/>模态框/通知</p>
      </section>
    </section>
  </section>
</section>
```

### 1.6 透明度令牌

```html
<section class="flex flex-col gap-5 p-8" data-name="Opacity Tokens">
  <p class="text-base font-bold" data-name="Section Label">Opacity Scale</p>
  <section class="flex flex-row gap-4 items-end" data-name="Samples">
    <section class="flex flex-col items-center gap-1" data-name="Opacity 100"><section class="w-12 h-12 rounded-lg bg-[#1A1A1A]" data-name="Swatch"></section><p class="text-xs" style="color:#9CA0AF" data-name="Label">100%</p></section>
    <section class="flex flex-col items-center gap-1" data-name="Opacity 80"><section class="w-12 h-12 rounded-lg" style="background:rgba(26,26,26,0.8)" data-name="Swatch"></section><p class="text-xs" style="color:#9CA0AF" data-name="Label">80% — Hover</p></section>
    <section class="flex flex-col items-center gap-1" data-name="Opacity 60"><section class="w-12 h-12 rounded-lg" style="background:rgba(26,26,26,0.6)" data-name="Swatch"></section><p class="text-xs" style="color:#9CA0AF" data-name="Label">60% — Loading</p></section>
    <section class="flex flex-col items-center gap-1" data-name="Opacity 38"><section class="w-12 h-12 rounded-lg" style="background:rgba(26,26,26,0.38)" data-name="Swatch"></section><p class="text-xs" style="color:#9CA0AF" data-name="Label">38% — Disabled</p></section>
  </section>
</section>
```

### 1.7 Z-Index 令牌

```html
<section class="flex flex-col gap-5 p-8" data-name="ZIndex Tokens">
  <p class="text-base font-bold" data-name="Section Label">Z-Index Scale</p>
  <section class="flex flex-row gap-6 items-end" data-name="Samples">
    <section class="flex flex-col items-center gap-2" data-name="ZIndex Dropdown"><section class="flex items-center justify-center w-20 h-12 rounded border text-xs" style="background:#FFFFFF;border-color:#D0D5DD;z-index:100" data-name="Card">Dropdown (100)</section></section>
    <section class="flex flex-col items-center gap-2" data-name="ZIndex Modal"><section class="flex items-center justify-center w-20 h-12 rounded border text-xs" style="background:#FFFFFF;border-color:#D0D5DD;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:1000" data-name="Card">Modal (1000)</section></section>
    <section class="flex flex-col items-center gap-2" data-name="ZIndex Tooltip"><section class="flex items-center justify-center w-20 h-12 rounded border text-xs" style="background:#FFFFFF;border-color:#D0D5DD;box-shadow:0 4px 12px rgba(0,0,0,0.08);z-index:2000" data-name="Card">Tooltip (2000)</section></section>
  </section>
</section>
```

### 1.8 动效令牌

```html
<section class="flex flex-col gap-5 p-8" data-name="Motion Tokens">
  <p class="text-base font-bold" data-name="Section Label">Motion & Timing</p>
  <section class="flex flex-col gap-3" data-name="Duration">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">Duration (ms)</p>
    <section class="flex flex-row gap-4 items-center" data-name="Samples">
      <section class="flex items-center justify-center h-8 px-4 rounded text-xs" style="background:#F4F3FF" data-name="Duration Fast">150ms — Fast</section>
      <section class="flex items-center justify-center h-8 px-4 rounded text-xs" style="background:#EEEEFF" data-name="Duration Normal">250ms — Normal</section>
      <section class="flex items-center justify-center h-8 px-4 rounded text-xs" style="background:#E8E8FF" data-name="Duration Slow">400ms — Slow</section>
    </section>
  </section>
  <section class="flex flex-col gap-3" data-name="Easing">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">Easing Functions</p>
    <section class="flex flex-row gap-4 items-center" data-name="Samples">
      <section class="flex items-center justify-center h-8 px-4 rounded text-xs" style="background:#F9FAFB" data-name="Easing In">ease-in</section>
      <section class="flex items-center justify-center h-8 px-4 rounded text-xs" style="background:#F3F4F6" data-name="Easing Out">ease-out</section>
      <section class="flex items-center justify-center h-8 px-4 rounded text-xs" style="background:#E5E7EB" data-name="Easing InOut">ease-in-out</section>
    </section>
  </section>
</section>
```

### 1.9 网格与断点令牌（Grid & Breakpoints）

定义容器宽度和响应式断点，是页面布局的骨架。

```html
<section class="flex flex-col gap-6 p-8" data-name="Grid & Breakpoints">
  <p class="text-base font-bold" data-name="Section Label">Grid & Breakpoints</p>

  <!-- Containers -->
  <section class="flex flex-col gap-3" data-name="Containers">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">CONTAINER WIDTHS</p>
    <section class="flex flex-col gap-2" data-name="Samples">
      <section class="flex items-center h-8 px-3 rounded" style="background:#F0F4E8;width:480px"><p class="text-xs" style="color:#6B7280">480px — SM (mobile)</p></section>
      <section class="flex items-center h-8 px-3 rounded" style="background:#E8EDD8;width:768px"><p class="text-xs" style="color:#6B7280">768px — MD (tablet)</p></section>
      <section class="flex items-center h-8 px-3 rounded" style="background:#D4E0B0;width:1024px"><p class="text-xs" style="color:#6B7280">1024px — LG (desktop)</p></section>
      <section class="flex items-center h-8 px-3 rounded" style="background:#BBC99A;width:1280px"><p class="text-xs" style="color:#4A5A23">1280px — XL (wide)</p></section>
    </section>
  </section>

  <!-- 12-column Grid -->
  <section class="flex flex-col gap-3" data-name="Column Grid">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">12-COLUMN GRID (gutter 16px)</p>
    <section class="flex flex-row gap-[16px]" data-name="Grid Demo">
      <section class="h-10 rounded" style="background:#7C8D3E;flex:1"></section>
      <section class="h-10 rounded" style="background:#6A7D32;flex:1"></section>
      <section class="h-10 rounded" style="background:#7C8D3E;flex:1"></section>
      <section class="h-10 rounded" style="background:#6A7D32;flex:1"></section>
    </section>
    <section class="flex flex-row gap-[16px]" data-name="Grid Demo 2">
      <section class="h-8 rounded" style="background:#4A5A23;flex:3"></section>
      <section class="h-8 rounded" style="background:#7C8D3E;flex:9"></section>
    </section>
    <p class="text-xs" style="color:#9CA3AF">Top: 4 equal columns · Bottom: 3:9 split</p>
  </section>
</section>
```

### 1.10 交互与表单令牌

定义输入/按钮/焦点环等交互元素的尺寸和状态 Token。这些值抽象为语义层级（sm/md/lg），通过 `component_render` 的 `theme` 参数统一控制。

```html
<section class="flex flex-col gap-6 p-8" data-name="Interaction Tokens">
  <p class="text-base font-bold" data-name="Section Label">Interaction & Form Tokens</p>

  <!-- Focus Ring -->
  <section class="flex flex-col gap-3" data-name="Focus Ring">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">FOCUS RING</p>
    <section class="flex flex-row gap-4 items-center" data-name="Samples">
      <section class="flex items-center justify-center h-9 px-4 rounded-md" style="outline:2px solid #7C8D3E;outline-offset:2px;font-size:13px">Focus 2px brand</section>
      <section class="flex items-center justify-center h-9 px-4 rounded-md" style="outline:1px solid #9CA3AF;outline-offset:1px;font-size:13px">Focus 1px neutral</section>
    </section>
  </section>

  <!-- Input Heights -->
  <section class="flex flex-col gap-3" data-name="Input Heights">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">INPUT / BUTTON HEIGHTS</p>
    <section class="flex flex-row items-center gap-4" data-name="Samples">
      <section class="flex items-center h-8 px-3 rounded-md border" style="border-color:#D1D5CC;background:#FFFFFF;font-size:12px">sm — 32px</section>
      <section class="flex items-center h-[36px] px-3 rounded-md border" style="border-color:#D1D5CC;background:#FFFFFF;font-size:14px">md — 36px</section>
      <section class="flex items-center h-11 px-4 rounded-lg border" style="border-color:#D1D5CC;background:#FFFFFF;font-size:16px">lg — 44px</section>
    </section>
  </section>
</section>
```

### 1.11 组件尺寸参考

```html
<section class="flex flex-col gap-6 p-8" data-name="Component Sizing">
  <p class="text-base font-bold" data-name="Section Label">Component Sizing Guide</p>

  <!-- Buttons -->
  <section class="flex flex-col gap-3" data-name="Button Sizes">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">BUTTON (36px default, 6px radius)</p>
    <section class="flex flex-row items-center gap-4" data-name="Samples">
      <section class="flex items-center justify-center h-7 px-3 rounded" style="background:#4340EA;font-size:13px;color:white" data-name="Button SM">Small</section>
      <section class="flex items-center justify-center h-9 px-4 rounded-md" style="background:#4340EA;font-size:14px;color:white" data-name="Button MD">Default</section>
      <section class="flex items-center justify-center h-11 px-6 rounded-lg" style="background:#4340EA;font-size:16px;color:white" data-name="Button LG">Large</section>
      <section class="flex items-center justify-center h-9 px-4 rounded-full" style="background:#4340EA;font-size:14px;color:white" data-name="Button Pill">Pill</section>
    </section>
  </section>

  <!-- Input / Select -->
  <section class="flex flex-col gap-3" data-name="Input Sizes">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">INPUT / SELECT (36px default, 6px radius)</p>
    <section class="flex flex-row items-center gap-4" data-name="Samples">
      <section class="flex items-center h-8 px-2.5 rounded border border-gray-300 bg-white" data-name="Input SM"><p class="text-xs text-gray-400" data-name="Placeholder">Small</p></section>
      <section class="flex items-center h-9 px-3 rounded-md border border-gray-300 bg-white" data-name="Input MD"><p class="text-sm text-gray-400" data-name="Placeholder">Default</p></section>
      <section class="flex items-center h-11 px-3.5 rounded-lg border border-gray-300 bg-white" data-name="Input LG"><p class="text-base text-gray-400" data-name="Placeholder">Large</p></section>
    </section>
  </section>

  <!-- Toggle -->
  <section class="flex flex-col gap-3" data-name="Toggle Sizes">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">TOGGLE (48×24 default)</p>
    <section class="flex flex-row items-center gap-4" data-name="Samples">
      <section class="rounded-full" style="width:36px;height:20px;background:#E0E0E0" data-name="Toggle SM"></section>
      <section class="rounded-full" style="width:48px;height:24px;background:#4340EA" data-name="Toggle MD"></section>
      <section class="rounded-full" style="width:60px;height:30px;background:#4340EA" data-name="Toggle LG"></section>
    </section>
  </section>

  <!-- Badge -->
  <section class="flex flex-col gap-3" data-name="Badge Sizes">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">BADGE (22px default, pill shape)</p>
    <section class="flex flex-row items-center gap-4" data-name="Samples">
      <section class="flex items-center justify-center rounded-full px-1.5" style="height:18px;background:#E8E8E8;font-size:10px" data-name="Badge SM">Sm</section>
      <section class="flex items-center justify-center rounded-full px-2" style="height:22px;background:#E8E8E8;font-size:11px" data-name="Badge MD">Default</section>
      <section class="flex items-center justify-center rounded-full px-2.5" style="height:28px;background:#E8E8E8;font-size:13px" data-name="Badge LG">Large</section>
    </section>
  </section>

  <!-- Tag -->
  <section class="flex flex-col gap-3" data-name="Tag Sizing">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">TAG (28px, 6px radius)</p>
    <section class="flex items-center gap-3" data-name="Samples">
      <section class="flex items-center justify-center h-7 px-3 rounded-md" style="background:#F5F5F5;font-size:13px" data-name="Tag Default">Default</section>
      <section class="flex items-center justify-center h-7 px-3 rounded-md" style="background:#F4F3FF;color:#4340EA;font-size:13px" data-name="Tag Primary">Primary</section>
      <section class="flex items-center justify-center h-7 px-3 rounded-md" style="background:#E6F7E6;color:#1A7D1A;font-size:13px" data-name="Tag Success">Success</section>
    </section>
  </section>

  <!-- Radius Ladder -->
  <section class="flex flex-col gap-3" data-name="Radius Ladder">
    <p class="text-sm font-semibold" style="color:#9CA0AF" data-name="Category">CORNER RADIUS</p>
    <section class="flex flex-row items-center gap-4" data-name="Samples">
      <section class="w-10 h-10" style="border-radius:4px;background:#4340EA" data-name="Radius 4"></section>
      <section class="w-10 h-10" style="border-radius:6px;background:#4340EA" data-name="Radius 6"></section>
      <section class="w-10 h-10" style="border-radius:8px;background:#4340EA" data-name="Radius 8"></section>
      <section class="w-10 h-10" style="border-radius:12px;background:#4340EA" data-name="Radius 12"></section>
      <section class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center" data-name="Radius Pill">
        <p class="text-2xs" style="font-size:8px">Pill</p>
      </section>
    </section>
  </section>
</section>
```

---

## 第二阶段：组件库生成

在 Token 面板就绪后，在**同一页面**使用 HTML 模板一次性渲染所有组件，再逐个转为 Component Master。

> 通用组件 Master/Instance 创建工作流（非设计系统上下文）见 `09-design-guide.md §组件化设计原则`，包含后置提取工作流。

### 2.1 模板化组件库

所有组件渲染在 Token 面板下方（Y=2200），使用一份完整的 HTML 模板，通过 `<component type='...' config='{...}' />` 标签声明每种组件。**一次 `code_to_design` 调用即可生成全部 23+ 组件**，无需逐一 `component_render`。

**模板文件位置**：`templates/design-system-components.html`

模板结构：
- 外层容器 `position:absolute; top:2200px; left:50px` 确保与 Token 面板错开
- 4 个分组（基础交互 / 展示类 / 导航与布局 / 反馈类），每组含分组标签
- `<component>` 标签的 `data-name` 属性按 `DS_` 命名约定设置，方便后续查找
- 布局使用 Tailwind `flex-row` / `flex-col` 自动排列，**无需手动计算坐标**

### 2.2 生成流程

```
1. code_to_design({ filePath: "templates/design-system-components.html" })
   └→ 一次调用渲染 23+ 组件到画布，偏移至 Y=2200
   └→ 每个组件的 data-name 作为 MasterGo 节点名称

2. 对所有组件：
   search_nodes({ name: { value: "DS_Button_Primary", matchType: "exact" }, types: ["FRAME"] })
   └→ 返回匹配的节点 ID
   
   node_convert_to_component(nodeId: "<节点ID>", keepOriginal: false)
   └→ 转为 Component Master
```

> 如果 Token 面板高度超过预期导致组件与 Token 重叠，调整模板外层容器的 `top` 值（如 `top:2800px`）后重新生成。

### 2.3 转换示例

对所有组件重复以下操作：

| 组件 | data-name | 搜索条件 |
|------|-----------|----------|
| Primary Button | `DS_Button_Primary` | `search_nodes({ name: { value: "DS_Button_Primary", matchType: "exact" } })` |
| TextInput | `DS_TextInput` | `search_nodes({ name: { value: "DS_TextInput", matchType: "exact" } })` |
| Badge (success) | `DS_Badge_Success` | `search_nodes({ name: { value: "DS_Badge_Success", matchType: "exact" } })` |
| Tabs | `DS_Tabs` | `search_nodes({ name: { value: "DS_Tabs", matchType: "exact" } })` |

> **`keepOriginal: false` 注意**：设为 `false` 时插件会删除原空 frame；设为 `true` 会在画布上留下空 frame 残余。

转换后的组件可在 Assets 面板中管理，通过 `component_list` 发现，`node_create(type: "instance", properties: { componentId: "..." })` 复用。

**尺寸层级说明：** 按钮、输入框、选择器、开关和徽标在 `<component>` 标签中通过 `config` 传入 `size.tier` 参数切换预设（sm/md/lg）。按钮额外支持 `shape: "pill"` 和 `icon` / `iconRight`。

### 2.4 组件交互状态矩阵

对交互型组件，在转为 Component Master 后，使用 `component_state_matrix` 创建全套状态变体并自动合成为 ComponentSet 多态组：

```
for each interactive type (button, select, text-input, toggle, checkbox, radio, tabs, tag):
  component_state_matrix({
    type: "<type>",
    config: { label: "<label>", variant: "primary" },
    naming: "variant",
    variantPropertyName: "State",
    states: ["Default", "Hover", "Active", "Disabled", "Focused"]
  })
  └→ mg.combineAsVariants() 自动合成 ComponentSet
  └→ Assets 面板中出现一个含 State 属性的多态组件
  └→ 名称格式: DS_{Type}_{Variant}（如 DS_Button_Primary）
```

**各组件推荐状态：**

| 组件 | 状态数 | 推荐状态 |
|------|--------|----------|
| button | 5 | Default / Hover / Active / Disabled / Focused |
| text-input | 6 | Default / Hover / Focused / Disabled / Error / Open |
| select | 6 | Default / Hover / Focused / Disabled / Error / Open |
| toggle | 4 | Default / Checked / Hover / Disabled |
| checkbox / radio | 6 | Unchecked / Checked / Hover-Unchecked / Hover-Checked / Disabled-Unchecked / Disabled-Checked |
| tabs | 4 | Active / Inactive / Hover / Disabled |
| tag | 5 | Default / Hover / Active / Disabled / Closable |
| card | 4 | Default / Hover / Selected / Disabled |

> 状态矩阵通过 `mg.combineAsVariants()` 自动合成为 `COMPONENT_SET`，无需手动右键操作。
> 在 HTML 中引用时使用 `data-component-id="DS_Button_Primary"`，创建实例后可通过 `data-override-text-*` 覆写文字。

---

## 第三阶段：图标集

使用 `icon_search` 搜索项目所需的常用图标，用 `icon_render` 批量渲染到画布。建议包含：

```yaml
# 导航类
- ri:home-line, ri:menu-line, ri:close-line, ri:arrow-left-line, ri:arrow-right-line

# 操作类
- ri:search-line, ri:add-line, ri:edit-line, ri:delete-bin-line, ri:download-line

# 反馈类
- ri:check-line, ri:close-circle-line, ri:error-warning-line, ri:information-line

# 通用类
- ri:user-line, ri:settings-line, ri:notification-line, ri:time-line
```

图标命名规则：`Icon_{prefix}:{name}`（如 `Icon_ri:search-line`），便于 `design_to_code` 导出时自动识别。

---

## 第三·五阶段：开发者资源导出

Token 面板生成后，可通过 `library_register_styles` 将令牌注册为 MasterGo 原生样式，然后通过 `dsl_export_node` 导出 DSL → `design_to_code` 的 `mode: "tokens"` 输出 CSS 变量、Tailwind Config 和 DTCG JSON。

### 3.5.1 导出流程

```
1. code_to_design({ html: "..." })  ← 渲染 Token 面板到画布
   └→ 获取 Token 面板的 frame nodeId

2. library_register_styles({ parentId: "frame:xxx" })
   └→ 遍历节点树，对每个 token 元素调用 mg.create*Style()
   └→ 创建 Paint/Text/Effect/Spacing 原生样式
   └→ 返回 [{ name, type, styleId }]

3. dsl_export_node({ nodeId: "frame:xxx" })
   └→ 获取 Token 面板的完整 DSL

4. design_to_code({ dsl, options: { mode: "tokens" } })
   └→ 返回 { tokens: { css, tailwind, dtcg } }
```

### 3.5.2 样式注册规则

`library_register_styles` 识别以下 `data-name` 模式并创建对应 MasterGo 原生样式：

| data-name 模式 | 样式类型 | MasterGo API | 结果样式名 |
|---|---|---|---|
| `Brand Text`, `Neutral Bg`, `Success` 等 | PAINT | `mg.createFillStyle({id, name})` | `Brand Text` |
| `H1`, `Label 14`, `Copy 16` 等 | TEXT | `mg.createTextStyle({id, name})` | `H1` |
| `Space 4`, `Space 8` 等 | SPACING | `mg.createSpacingStyle({id, name})` | `Space/4` |
| `Shadow SM`, `Shadow MD` 等 | EFFECT | `mg.createEffectStyle({id, name})` | `Shadow/SM` |

注册后，创建的样式会出现在 MasterGo 样式面板中。

### 3.5.3 输出示例

**CSS 变量** (`tokens.css`):
```css
:root {
  --color-brand-text: #4340EA;
  --color-brand-hover: #3533C4;
  --color-brand-bg: #EEEDFE;
  --color-neutral-bg: #FFFFFF;
  --color-neutral-text: #111827;
  --font-size-h1: 36px;
  --font-weight-h1: 700;
  --space-4: 4px;
  --space-8: 8px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
}
```

**Tailwind Config** (`tailwind.config.js`):
```js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: { text: '#4340EA', hover: '#3533C4', bg: '#EEEDFE' },
        neutral: { bg: '#FFFFFF', text: '#111827' },
      },
      spacing: { '4': '4px', '8': '8px' },
      fontSize: { h1: ['36px', { fontWeight: '700' }] },
      boxShadow: { sm: '0 1px 2px rgba(0,0,0,0.05)' },
    },
  },
}
```

**DTCG JSON** (`tokens.json`):
```json
{
  "$schema": "https://design-tokens.org/format/v1.0",
  "tokens": {
    "color": {
      "brand-text": { "$value": "#4340EA", "$type": "color", "$description": "Brand Text" }
    },
    "spacing": {
      "4": { "$value": "4px", "$type": "dimension" }
    }
  }
}
```

### 3.5.4 样式库管理

样式注册后，可通过 `style_list_colors` / `style_list_text` / `style_apply` 查询和管理：

```
【查询】style_list_colors → 返回所有 Paint Style，含 id/名称/色值
【查询】style_list_text  → 返回所有 Text Style，含 id/名称/字号/字重
【应用】style_apply(nodeId, styleId, styleType: "fill" | "stroke" | "text")
  └→ fill: 应用填充颜色样式
  └→ stroke: 应用描边颜色样式
  └→ text: 应用文本样式
```

**使用示例：**
1. 注册样式后，调用 `style_list_colors` 确认样式库已正确创建
2. 在后续设计中，用 `search_nodes` 定位目标节点，`style_apply` 快速应用样式
3. 品牌色更新时，更新 Token 面板 → `library_register_styles` 重新注册 → 旧实例可选择手动 `style_apply` 更新

### 3.5.4 导出后使用

- **CSS 变量** → 直接 `@import` 或在构建时注入 `:root`
- **Tailwind Config** → 合并到项目 `tailwind.config.js` 的 `extend` 中
- **DTCG JSON** → 导入 Style Dictionary / Token Studio 等工具
- Token 命名规范（角色后缀 Text/Hover/Bg/Border/Bg Hover/Bg Active/Border Hover/Text Secondary）确保各格式输出时分组清晰

---

## 第四阶段：引用设计系统

### 4.1 每次设计前

1. **发现组件**：调用 `component_list` 获取当前文档所有 Component Master，记录它们的 `id` 和 `name`（DS_ 前缀标识设计系统组件）
2. **读取 Token**：`dsl_export_node({ nodeId: "token-page-id" })` 获取当前 Token 值
3. **标记 HTML**：在 HTML 中需要引用已有组件的地方，使用 `data-component-id` 或 `data-component-name` 属性
4. **一键生成**：`code_to_design` 自动将标记的元素转为 `type: "instance"`，插件端渲染为真正的 Component Instance

### 4.2 两种引用方式

**方式 A — ID 引用（推荐，精确匹配）：**
```html
<!-- 直接引用 Component Master 的节点 ID -->
<button data-component-id="Component:abc123">Click me</button>

<!-- 实例可配合 name 属性提供语义化名称 -->
<section data-component-id="Component:xyz789" data-name="Header Button"></section>
```

**方式 B — 名称引用（模糊匹配，适用发现阶段拿不到 ID 的场景）：**
```html
<!-- 按 Component Master 名称匹配 -->
<button data-component-name="DS_Button">Click me</button>

<!-- 也可同时提供 ID 和名称，ID 优先 -->
<button data-component-id="Component:abc123" data-component-name="DS_Button">Click me</button>
```

两种方式都会跳过正常的样式解析（fills/strokes/布局等），只保留 `position`、`size`、`rotation` 等布局位置属性。Instance 的外观由 Component Master 决定。

### 4.3 设计系统组件命名约定

创建 Component Master 时使用统一前缀，便于 `component_list` 返回时识别和过滤：

```
DS_{ComponentName}[_Variant][_State]

Examples:
  DS_Button            → 基础按钮
  DS_Button_Primary    → 主要变体
  DS_Button_Secondary  → 次要变体
  DS_Badge             → 徽标
  DS_Badge_Success     → 成功态
  DS_TextInput         → 输入框
  DS_Toggle            → 开关
  DS_Modal             → 模态框
```

规则：
1. 前缀 `DS_` 标识设计系统组件
2. 大驼峰首字母大写组件名
3. 可选 `_Variant` / `_State` 后缀标识变体和状态
4. 创建时确保名称全局唯一

### 4.4 token 色板 → theme 参数映射

| Token 页值 | theme 参数 | 用途 |
|------------|-----------|------|
| Primary #4340EA | `theme.brand` | 品牌色、主按钮、链接 |
| Gray 200 #E5E7EB | `theme.border` | 输入框描边、分割线 |
| Gray 900 #111827 | `theme.textPrimary` | 主文字颜色 |
| White #FFFFFF | 背景色 | 卡片、输入框背景 |
| Gray 600 #6B7280 | 无需传参 | 辅助文字颜色（默认） |
| Success/Warning/Error/Info | 无需传参 | 语义色（组件内建默认值） |

### 4.5 维护与更新

- Token 值修改时：重新生成 Token 页后，在后续设计中手动传入新值
- 新增组件类型：将新组件加入模板 `design-system-components.html` 后完整重渲染；或单独使用 `component_render` 生成后 `node_convert_to_component`
- 组件库膨胀时：用 `component_list` 列出所有组件 → `node_delete`（批量传 `nodeIds[]`） 清理过时

---

## 完整执行流程

### Phase 0-3：建库

```
Phase 0: 页面准备
  page_create("设计系统")
  page_switch("设计系统")

Phase 1: Token 面板（渲染在 x=50, y=50）
  task_plan([{id:"page", label:"准备页面"}, {id:"tokens", label:"生成令牌面板"}, {id:"components", label:"生成组件库"}])
  task_step("page", "running")       ← 新建/切换到"设计系统"页
  task_step("page", "completed")
  task_step("tokens", "running")
  code_to_design(html=色板+字阶+间距+阴影)
  task_step("tokens", "completed")

Phase 2: 组件库（渲染在 Y=2200 下方，单模板）
  task_step("components", "running")
  code_to_design(html=read("templates/design-system-components.html"))  ← 一次调用
  for each component label in [DS_Button_Primary, DS_TextInput, DS_Select, ...]:
    search_nodes({ name: { value: "<data-name>", matchType: "exact" } })
    → get nodeId
    node_convert_to_component(nodeId: "<节点ID>", keepOriginal: false)
  task_step("components", "completed")

Phase 2.5: 组件状态矩阵
  task_step("states", "running")
  for each interactive type in [button, select, text-input, toggle, tabs, tag]:
    component_state_matrix(type: "<type>", naming: "variant", variantPropertyName: "State")
    └→ 自动合成为 ComponentSet，Assets 中可见多态组件
  task_step("states", "completed")

Phase 3: 图标集
  page_create("图标集")     ← 建议单独页面，方便管理
  page_switch("图标集")
  icon_render(name, position) for each icon
```

> `keepOriginal: false` 确保原 frame 被删除，不会在画布留下空 frame 残余。

### Phase 4：引用（日常设计流程）

```
Phase 4: 引用（后续每次设计）
  task_plan([{id:"discover", label:"发现已有组件"}, {id:"generate", label:"生成设计"}])

  task_step("discover", "running")
  component_list → 得到所有 DS_ 组件 ID 和名称
  task_step("discover", "completed")

  task_step("generate", "running")
  # HTML 中使用 data-component-id 引用已有组件
  code_to_design(html="<section data-component-id='Component:abc123'>...")
  task_step("generate", "completed")

  task_complete({ status: "success" })
```

---

## 差距分析与提升计划

对标 Material Design 3、Ant Design、Radix UI 等成熟设计系统，当前工作流的核心差距和提升路径如下：

### 1. 🎯 组件状态系统（高优先级）

**现状**：每个组件渲染单帧（如 button-primary），不含交互态。

**成熟系统做法**：每个组件定义 `default / hover / focus / active / disabled` 等多态。

| 阶段 | 任务 | 说明 |
|------|------|------|
| 1.1 | 组件状态枚举标准化 | 为所有 33 种组件定义状态矩阵（哪些状态适用、属性差异） |
| 1.2 | `component_render` 扩展 `states` 参数 | 类似 checkbox-group 的 `states` 模式，推广到所有组件；`states: ["default","hover"]` 自动渲染多态组合 |
| 1.3 | 状态命名可视化 | 状态组渲染到画布时附带状态标签（Default / Hover / Focus / Disabled） |
| 1.4 | `design_suggest` 状态切换 | 通过 `design_suggest` 直接切换组件状态（如"变 hover 态"） |

### 2. 🌓 暗色主题自动生成（高优先级）

**现状**：主题需手动定义所有颜色 token，无暗色模式支持。

**成熟系统做法**：`light` / `dark` / `high-contrast` 等多种色彩方案。

| 阶段 | 任务 | 说明 |
|------|------|------|
| 2.1 | 色彩 token 推导引擎 | 给定 brand 色，自动生成 light/dark 两套完整色板（bg、border、text、hover 等） |
| 2.2 | `theme` 参数扩展 `mode: light\|dark` | `component_render(theme:{brand, mode:"dark"})` 自动应用暗色 token |
| 2.3 | 暗色 token 面板渲染 | `code_to_design` 同时渲染 light/dark 两套 token 面板并排展示 |
| 2.4 | `design_to_code` 暗色 CSS 输出 | 导出 `@media (prefers-color-scheme: dark)` 或 `.dark` class 变量 |

### 3. 📐 设计令牌体系补全（中优先级）

**现状**：颜色、排版、间距、阴影基本覆盖；缺失动效、圆角阶梯、Z-index、断点等。

**成熟系统做法**：完整的 Design Token 分类（CTI 命名体系）。

| 类别 | Token | 状态 | 说明 |
|------|-------|------|------|
| **圆角** | `borderRadiusSm/Md/Lg/Xl/Full` | ✅ 已文档化 | 2/4/6/8/12/9999px 阶梯，`component_render` 的 `theme.borderRadius*` 已实现 |
| **透明度** | `opacity100/80/60/38` | ✅ 已文档化 | 100/80/60/38% 四级，已包含在 Token 面板模板 |
| **层级** | `zIndexDropdown(100)/Modal(1000)/Tooltip(2000)` | ✅ 已文档化 | 已包含在 Token 面板模板 |
| **动效** | `durationFast/Normal/Slow` + `easingIn/Out/InOut` | ✅ 已文档化 | 150/250/400ms 三级，已包含 |
| **网格** | `containerSm/Md/Lg/Xl`, `col*`, `gutter` | ⚠️ 新增 (1.9) | Token 面板模板已添加，引擎渲染支持待验证 |
| **交互** | `focusRingWidth/Color/Offset`, `input/btnHeight sm/md/lg` | ⚠️ 新增 (1.10) | Token 面板模板已添加 |
| **断点** | `breakpointSm/Md/Lg/Xl` | ❌ 未实现 | 640/768/1024/1280 — CSS token 输出需要，不影响渲染 |
| **行高** | `lineHeightTight/Normal/Relaxed` | ❌ 未实现 | 1.25/1.5/1.75 比例值 — 需引擎支持 |
| **色板语义名** | `foreground`, `background`, `link`, `selection` | ❌ 未实现 | 当前使用 Brand/Neutral 角色命名。语义名增加开发端可读性 |
| **字体系列** | `fontSans/Mono` 回退栈 | ❌ 未实现 | `'Inter', -apple-system, ...` — 需要 `dsl-tokens.ts` 新增输出 |
| **间距语义名** | `spaceXs/Sm/Md/Lg/Xl` | ❌ 未实现 | 当前 Token 面板已展示原始值，缺少语义别名层 |
| **高程语义名** | `elevationSurface/Floating/Overlay` | ❌ 未实现 | 当前使用 Shadow SM/MD/LG，缺少语义封装 |
| **表单交互** | (已包含在 1.10) | ⚠️ 新增 | focus ring + input/button 高度 |
| **数据展示** | `tableCellPadding`, `cardPaddingSm/Md/Lg` | ❌ 未实现 | Card/Table/List 的标准内边距，需要 DEFAULT_THEME 扩展 |
| **载入态** | `spinnerSizeSm/Md/Lg`, `skeletonRadius` | ❌ 未实现 | Spinner 尺寸和 Skeleton 圆角 — 可逐步补充 |

| 阶段 | 任务 | 说明 |
|------|------|------|
| 3.1 | 新增 token 类别到 DEFAULT_THEME | 补全圆角阶梯、透明度、z-index、动效、网格、交互 tokens |
| 3.2 | 更新 Token 面板 HTML 模板 | 增加 Motion、Border Radius、Opacity、Z-Index、Grid、Interaction 面板（模板已就绪） |
| 3.3 | `dsl-tokens.ts` 增加输出 | CSS 变量 / Tailwind / DTCG 同步新增 token（含字体回退栈、间距语义名、高程语义名） |
| 3.4 | `library_register_styles` 扩展 | 支持注册新类别（如有对应的 MasterGo API） |
| 3.5 | 对齐 Geist 语义命名 | 增加 `foreground/background/link/selection` 等角色色，以及 `elevationSurface/Floating` 高程语义 |

### 4. 🧩 组件组合模式（中优先级）

**现状**：33 种原子组件可独立渲染，但无法生成复合模式（如带表单的登录页、带数据的 dashboard）。

**成熟系统做法**：提供"模式/区块"模板（Page Shell、Form Layout、Hero Section）。

| 阶段 | 任务 | 说明 |
|------|------|------|
| 4.1 | 新增 `renderPageShell` | 页面框架（Header/Sidebar/Content）布局生成器 |
| 4.2 | 新增 `renderFeatureGrid` | 功能特性网格（3/4 列，含图标+标题+描述） |
| 4.3 | 新增 `renderPricingTable` | 定价表（3-4 档，含功能列表+CTA 按钮） |
| 4.4 | 新增 `renderFormLayout` | 表单布局（字段分组、标签位置、验证状态） |
| 4.5 | 以上注册为 `pattern_*` 工具 | 通过 `component_render` 统一调用 |

### 5. 🔄 开发者资源导出增强（中优先级）

**现状**：`design_to_code(mode:"tokens")` 支持 CSS 变量、Tailwind Config、DTCG JSON。

**待增强**：

| 阶段 | 任务 | 说明 |
|------|------|------|
| 5.1 | 导出暗色主题 CSS 变量 | `--color-bg-dark`, `--color-text-dark` 等 |
| 5.2 | 导出 Radius/Opacity/ZIndex | 新增的 token 类别 |
| 5.3 | 导出 Spacing 语义别名 | `--space-xs` / `--space-sm` / `--space-md` / `--space-lg` / `--space-xl` |
| 5.4 | 导出 Font Family 回退栈 | `--font-sans: 'Inter', system-ui, sans-serif` |
| 5.5 | 导出 Shadow 语义名 | `--shadow-sm` / `--shadow-md` / `--shadow-lg` |

### 6. 🎬 动效/过渡体系（低优先级）

**现状**：完全缺失。

**实施路径**：定义 token → 生成面板 → 导出 CSS `transition` 工具类。

### 7. ♿ 可访问性（低优先级）

**现状**：无焦点环、无对比度验证。

**实施路径**：`focus-visible` 环 token → WCAG AA 对比度校验工具 → `design_suggest` 自动修复。

---

## 执行优先级

| 优先级 | 阶段 | 预计工作量 | 依赖 |
|--------|------|-----------|------|
| **P0** | 1.1-1.3 组件状态标准化 + `states` 参数 | ~3 天 | 现有渲染器架构 |
| **P0** | 2.1-2.3 暗色主题自动生成 | ~2 天 | 色彩推导算法 |
| **P1** | 3.1-3.5 设计 token 补全（含 Grid/Interaction 模板 + Geist 语义对齐） | ~3 天 | 无 |
| **P1** | 4.1-4.5 组件组合模式 | ~3 天 | 原子组件完成 |
| **P2** | 5.1-5.5 开发者资源增强（含字体回退栈、语义间距/高程输出） | ~2 天 | Token 补全 |
| **P2** | 6 / 7 动效 + 可访问性 | ~2 天 | Token 补全 |

> **建议立即启动 P0 项**：组件状态系统完善后，AI 生成的设计从"单帧示意"升级为"交互态完整"的设计稿。
