# 模块五：可视化图表 (ECharts)

遇到任何与图表/数据可视化/折线/柱状/饼图/环形图等可使用 echarts 图表库创建的图表需求，**必须使用 `<chart>` 标签**，这是最高优先级标签。

## 1. 核心约束

- **数据专注原则**：`<chart>` 标签只负责数据可视化，不包含任何 UI 装饰元素。
- **分离设计原则**：标题、图例、说明文字等必须使用 HTML 标签在 chart 外部生成，合理布局，避免重叠。
- **JSON格式强制**：`option` 属性必须是合法的 JSON 字符串，所有双引号必须转义为 `&quot;`。JSON 字符串整体用**单引号**包裹（因内部含双引号）。

## 2. 需要包含的配置项
```json
{
  "series": [...],           // ✅ 必需：数据系列
  "xAxis": {                 // ✅ 必需：必须显式配置，含 type/data/boundaryGap
    "type": "category",
    "data": [...],
    "boundaryGap": false,    // 折线图建议 false；柱状图建议 true
    "axisLabel": {...}       // 推荐：控制字号/颜色/旋转
  },
  "yAxis": {                 // ✅ 必需：必须显式配置，含 type/min/max/splitLine
    "type": "value",
    "min": 0,
    "max": <根据数据最大值动态设定>,
    "splitLine": {...},      // 推荐：网格线样式
    "axisLabel": {...}       // 推荐：控制字号/颜色
  },
  "grid": {                  // ✅ 必需（≥6 数据点时）：控制图表内边距，防止标签裁剪
    "left": 40,
    "right": 20,
    "top": 20,
    "bottom": 25
  }
}
```

> **`grid` 不是可选项** — 数据点 ≥6 时必须配置 `grid`，否则轴标签（axisLabel）会被容器边界裁剪。

## 3. 严格禁止的配置项
```json
{
  "title": {...},      // ❌ 禁止：标题
  "legend": {...},     // ❌ 禁止：图例
  "tooltip": {...},    // ❌ 禁止：提示框
  "animation": {...}   // ❌ 禁止：动画效果
}
```

## 4. 图表生成示例

### ✅ 正确示例：纯数据图表
```html
<!-- 柱状图：标题与数据分离 -->
<section class="flex flex-col gap-[16px]" data-name="chart-container">
  <p class="text-[18px] font-[600] text-[#000000]" data-name="chart-title">
    月度销售数据
  </p>
  <chart
    class="w-[400px] h-[300px]"
    option='{"xAxis":{"type":"category","data":["1月","2月","3月"]},"yAxis":{"type":"value"},"series":[{"data":[120,200,150],"type":"bar"}]}'
    data-name="chart"
  ></chart>
</section>
```

### ❌ 错误示例：混合UI元素
```html
<!-- 错误：在option中包含title或legend -->
<chart
  option='{"title":{"text":"销售数据"},"legend":{"data":["系列1"]},"series":[...]}'
></chart>
```

## 5. 🔴 图表尺寸规则（高频踩坑）

### 5.1 Chart 标签必须有与容器匹配的显式宽度

`<chart>` 标签会被转换为 `flexMode: "NONE"` 的 frame，**不会自动撑满父容器宽度**。即使父容器是 VERTICAL auto-layout 且有 `w-[Npx]`，<chart> 也不会 auto-FILL。

✅ **正确**：chart 的 `w-[Npx]` 必须等于父容器的 content width（父容器 width - paddingLeft - paddingRight）
```html
<section class="flex flex-col w-[966px] p-[16px]" data-name="chart-container">
  <chart class="w-[934px] h-[280px]" ...>   <!-- 966 - 16 - 16 = 934 -->
</section>
```

❌ **错误**：chart 没有 width 或 width 小于容器
```html
<section class="flex flex-col w-[966px]" data-name="chart-container">
  <chart class="h-[280px]" ...>             <!-- ❌ 无 width → 默认 400px，极度拥挤 -->
</section>
```

### 5.2 高度需根据数据点数量阶梯调整

| 数据点数量 | 建议 chart 高度 | 说明 |
|-----------|----------------|------|
| 3-6 个 | 200-240px | 空间充裕，基本折线/柱状 |
| 7-12 个 | 260-300px | 防止线条/柱体挤压 |
| 13-20 个 | 300-360px | 密集数据需更高空间 |
| ≥3 条 series | 每增加一条 +40px | 多系列叠加需要更多纵向空间 |

### 5.3 容器不要固定高度

`chart-container` 应使用自适应高度（不设 `h-[Npx]`），由 padding + chart 高度共同决定容器高度。否则若 chart 高度超出容器会被裁剪。

✅ **正确**：
```html
<section class="flex flex-col w-[966px] p-[16px]" data-name="chart-container">
  <chart class="w-[934px] h-[280px]" ...>
</section>
<!-- 容器高度 = 16 + 280 + 16 = 312px，由内容撑开 -->
```

❌ **错误**：
```html
<section class="flex flex-col w-[966px] h-[200px]" data-name="chart-container">
  <chart class="w-[934px] h-[280px]" ...>   <!-- ❌ 容器 200px，图表 280px，底部被裁剪 -->
</section>
```

## 6. 折线图最佳实践

### 6.1 必须配置的 series 属性（≥6 数据点时）
```json
{
  "series": [{
    "type": "line",
    "data": [...],
    "smooth": true,           // 推荐：使曲线更流畅，避免折角视觉噪声
    "symbol": "circle",       // 推荐：突出数据点位置
    "symbolSize": 6,          // 数据点大小，数据密集时可缩小到 4
    "lineStyle": {
      "width": 2,
      "color": "#COLOR"
    },
    "itemStyle": {
      "color": "#COLOR"
    },
    "areaStyle": {            // 按需：面积填充增强视觉层次
      "opacity": 0.1,
      "color": "#COLOR"
    }
  }]
}
```

### 6.2 Y 轴范围应动态匹配数据
- `max` 不要固定为 100：取 **数据最大值向上取整到最近的可读值**（如数据最高 75 → max: 80）
- 留白过多会压缩数据区域的视觉占比，让折线看起来太平

### 6.3 配色与图例一致性
- HTML 图例色块的颜色必须与图表 `itemStyle.color` 严格一致
- 图例文字在 chart 外部用 HTML 实现（禁止用 ECharts `legend`）

## 7. 🔴 常见图表布局错误

| 错误 | 后果 | 修复 |
|------|------|------|
| `<chart>` 无 `w-[Npx]` | 渲染为默认 400px 宽，容器内大量留白 | 加上等于父容器 content width 的 `w-[Npx]` |
| 缺少 `grid` 配置 | 数据点标签被容器边界裁剪 | 添加 `grid:{left,right,top,bottom}` |
| `yAxis.max` 设为 100 | 数据范围仅用满顶部 75%，底部大片留白 | 按数据最大值动态调整 |
| 容器固定 `h-[Npx]` | 图表超出部分被 `clipsContent` 裁剪 | 容器不设高度，由内容撑开 |
| `xAxis` 无 `boundaryGap` | 折线图数据点紧贴 Y 轴 | 折线图设 `boundaryGap: false` |

## 8. 关键注意事项
1. **JSON转义强制**：所有双引号必须转义为 `&quot;`，否则解析失败。
2. **配色专业性**：使用数据可视化专业配色，避免过于鲜艳或刺眼的颜色。
3. **多系列注意**：2 条折线以上时，每条线用不同色调（如橙色系 vs 紫色系），避免同色系混淆。
4. **数据点密度**：超过 15 个数据点时考虑简化或分两图展示。