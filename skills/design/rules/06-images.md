# 模块八：图片地址与 AI 生成

图片通过类 Stable Diffusion 的方式生成；需要提供**英文**提示词来描述画面内容。

**基础地址：**

```
/ai/api/search-image
```

下文用占位符 `{{ImageUrl}}` 表示该基础地址（与项目模板保持一致时替换为实际前缀或完整路径）。

---

## 1. 提示词规则（`image-generate-prompt-rules`）

- 提示词需为**一整句**英文描述，**不少于 150 个字符**。
- 提示词中**禁止**出现：`'`（单引号）、`"`（双引号）、换行、`` ` ``（反引号）、`%`（百分号）。
- **产品图**：背景尽量简单，突出主体。
- **全页图片**：风格一致；在可行范围内背景也保持一致。
- 整体画面需美观、和谐。
- 提示词**必须包含对背景的描述**：保证商品/主体背景一致、简洁。
- 若需更换或修正图片，应按 **「图片 URL 格式」** 重新生成完整链接；**非必要不要改动**已有图片地址。

---

## 2. 图片 URL 格式（`image-url-format`）

完整 URL 形态：

```
{{ImageUrl}}?query={英文提示词}&width={宽度}&height={高度}&orientation={landscape|portrait|squarish}
```

- `orientation` 从 **`landscape`**、**`portrait`**、**`squarish`** 中选其一。
- **禁止**用任何「运行时拼接」的方式给出链接，包括但不限于：字符串相加、模板字符串/插值、封装函数再拼参数等。链接须以**字面量**形式一次性写出（提示词内容已编码进 query）。

❌ **错误示例（禁止出现）**：

```javascript
imageUrl = '{{ImageUrl}}?' + myImagePrompt + imageSize
imageUrl = `${{ImageUrl}}?query=${myImagePrompt}&width=${imageSize.width}&height=${imageSize.height}`
imageUrl = getImgUrl({{ImageUrl}}, myImagePrompt, imageSize)
```

✅ **正确示例**（结构示意；真实任务中 `query=` 后的英文句须同时满足本节第 1 条「不少于 150 字符」等提示词规则）：

```javascript
imageUrl = '{{ImageUrl}}?query=this is an example prompt&width=100&height=200&orientation=squarish'
```

---

## 3. 尺寸规则（`image-size-rules`）

- `width` 与 `height` 的**宽高比**须与页面上**该图片展示区域**的宽高比一致，避免裁切或拉伸观感与布局不符。

---

## 4. 小结

生成或填写图片时：**先按提示词规则写够长度、写好背景与风格；再按 URL 格式写出完整字面量链接；最后按展示区域比例设定 width/height 与 orientation。**

---

## 5. ✅ 已修：**描边型图标的颜色曾被忽略**（2026-10-02 真机发现并修复）

**现象**：`<i data-icon="lucide:check" class="text-[24px] text-[#DC2626]">` 渲到画布后，图标是 **灰色 `#e5e7eb`**，
不是红色 —— 而同一个页面里 `<p class="text-[#0F172A]">` 的文字颜色**完全正确**。

**因果链**（三段都已核实）：

1. 服务端 `mcp-server/src/utils/html-preprocessor.ts` 把 `<i data-icon>` 重写成裸 `<svg stroke="currentColor">`，
   **丢掉了 `class`**（走 API 分支时**连 `data-name` 也丢**）—— 所以 `text-[#…]` 不再作用到这个元素；
2. `mcp-server/src/utils/icon-utils.ts#customizeIconSvg` 只替换 `fill="currentColor"`，
   **不动 `stroke="currentColor"`** → 描边型图标（Lucide / Remix 线条图标…）的颜色参数被**静默忽略**；
3. 于是 `currentColor` 按继承解析 —— 也就是**插件面板自己的文字色**（实测 `#e5e7eb`）。
   设计里根本没有这个颜色，属于"看着渲染成功、颜色却不是你要的"。

**影响**：所有**描边型**图标都会串成面板灰；填充型图标（`ri:*` 多数）不受影响（第 2 段只处理 fill）。

**修法**（✅ 2026-10-02 已实施）：

1. `icon-utils.ts#customizeIconSvg` 改为替换**所有** `currentColor`（`/currentColor/gi`）——
   fill 与 stroke 一起处理，描边型图标不再被漏；
2. `html-preprocessor.ts` 新增 `copyIconAttributes()`：把 `<i>` 上的属性（`class` / `data-name` /
   `data-token-*` / `style` / `aria-*`…，`data-icon` 除外）**整体**搬到生成的 `<svg>` 上，
   **两条分支（本地图标 / 网络图标）都搬** —— 以前只在本地分支搬 `data-name`；
3. 门禁 `mcp-server/tests/icon-color.test.ts`（6 条）：颜色必须落在 fill **与** stroke 上、
   属性搬运（含写在 `data-icon` 之前的）、以及一条**离线**端到端（用本地图标集跑完整重写）。

**残留限制（已知，属取舍）**：颜色仍由服务端**烘焙**进 SVG；当颜色写在**祖先元素**上
（如 `<div class="text-[#DC2626]"><i data-icon="…"></i></div>`）时，`<i>` 自己没带颜色类，
会烘焙成默认 `#333333` 而不是祖先色 —— 因为烘焙是**宿主导入 SV​G 所需**
（`icon-utils.ts#buildIconDsl` 走 `customizeIconSvg`，MasterGo 侧 `createNodeFromSvgAsync` 不会把
SVG 级 fill 传给子节点）。要彻底修需改成“不烘焙、交给 CSS 继承”，但那会动到两侧宿主的导入行为，
得单独评估 —— 先记在这里，不要再当“没人知道”的隐疾。
