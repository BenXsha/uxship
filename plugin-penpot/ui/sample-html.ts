/**
 * 内置样例 HTML —— 用于在**没有服务端**的情况下自测「HTML → 实测像素 → DSL → 画布」这条链。
 *
 * 遵守 `skills/design/rules/01-core-tags.md` 的全部硬规则（这不是装饰，是渲染能成功的前提）：
 *   - 只用 `section` / `p` / `img` / `i[data-icon]`（`div` 只能做叶子）
 *   - **所有元素都有 data-name**（图层名不能丢）
 *   - **带 padding 的 section 必须有 flex**（否则宿主忽略 padding）
 *   - `p` 必须显式 `leading-[Npx]`（否则行高按默认值炸开）
 *   - 根节点显式宽度（插件 UI iframe 很窄，靠 viewport 撑宽会得到错的布局）
 *   - 任意值写法优先（Tailwind 解析器是白名单制，刻度类名覆盖有限）
 *
 * 刻意覆盖三类“容易在跨宿主时踩坑”的东西：
 *   渐变填充、`data-icon` 客户端解析、远程图片（走 Penpot 的 uploadMediaUrl）。
 */
export const SAMPLE_HTML = `<section data-name="Card" class="flex flex-col gap-[16px] w-[380px] p-[20px] bg-[#0B1220] rounded-[18px]">
  <section data-name="Header" class="flex flex-row items-center gap-[10px] w-[340px]">
    <i data-icon="ri:sparkling-line" data-name="Icon" class="w-[20px] h-[20px]"></i>
    <p data-name="Title" class="text-[15px] font-[600] leading-[22px] w-[310px]" style="color:#E5E7EB">HTML → Penpot 直通</p>
  </section>

  <p data-name="Body" class="text-[12px] leading-[18px] w-[340px]" style="color:#9CA3AF">这段文字与下面的色块来自一份 HTML+Tailwind 片段：先在浏览器里真实渲染、实测像素，再翻译成 Penpot 节点。</p>

  <section data-name="Bars" class="flex flex-col gap-[8px] w-[340px]">
    <section data-name="Bar Gradient" class="w-[340px] h-[8px] rounded-[4px] bg-[linear-gradient(90deg,#31EFB8,#4340EA)]"></section>
    <section data-name="Bar Solid" class="w-[220px] h-[8px] rounded-[4px] bg-[#4340EA]"></section>
  </section>

  <section data-name="Shapes" class="flex flex-row items-center gap-[12px] w-[340px]">
    <!-- 内联 SVG 里的 polygon / star / line —— 走 SVG 通道落成原生 Path（同属「逃生口」） -->
    <svg data-name="Hexagon" class="w-[48px] h-[48px]" viewBox="0 0 40 40">
      <polygon points="20,0 37.3,10 37.3,30 20,40 2.7,30 2.7,10" fill="#4340EA" />
    </svg>
    <svg data-name="Star" class="w-[48px] h-[48px]" viewBox="0 0 40 40">
      <polygon points="20,0 24.9,13.2 39,13.8 27.9,22.4 31.8,36 20,28.4 8.2,36 12.1,22.4 1,13.8 15.1,13.2" fill="#31EFB8" />
    </svg>
    <svg data-name="Wave" class="w-[48px] h-[48px]" viewBox="0 0 40 40">
      <path d="M4 32 C 14 4, 30 4, 40 32 Z" fill="#F59E0B" />
      <line x1="2" y1="37" x2="38" y2="37" stroke="#F87171" stroke-width="2" />
    </svg>
    <p data-name="Shapes Hint" class="text-[11px] leading-[16px] w-[200px]" style="color:#6B7280">polygon / star / path 都在内联 SVG 里，落成原生可编辑 Path</p>
  </section>

  <img data-name="Cover" src="https://picsum.photos/seed/mgmcp/340/120" class="w-[340px] h-[120px] rounded-[12px]" />

  <section data-name="Footer" class="flex flex-row items-center justify-between w-[340px] pt-[4px] border-t-[1px] border-[#1F2937]">
    <p data-name="Hint" class="text-[11px] leading-[16px] w-[240px]" style="color:#6B7280">提示：单边描边在 Penpot 会降级为整圈</p>
    <p data-name="Badge" class="text-[11px] font-[600] leading-[16px] w-[80px] text-right" style="color:#31EFB8">P3</p>
  </section>
</section>`

/**
 * 极简样例：只验证链路通不通（无图片、无图标，完全不依赖网络）。
 * 排查时先用它 —— 它失败说明是引擎/宿主问题，而不是网络问题。
 */
export const MINIMAL_HTML = `<section data-name="Smoke" class="flex flex-col gap-[8px] w-[240px] p-[16px] bg-[#4340EA] rounded-[12px]">
  <p data-name="Smoke Title" class="text-[14px] font-[600] leading-[20px] w-[208px]" style="color:#FFFFFF">客户端渲染已连通</p>
  <section data-name="Smoke Bar" class="w-[208px] h-[6px] rounded-[3px] bg-[#31EFB8]"></section>
</section>`
