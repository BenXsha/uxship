/**
 * 样式名的归一 —— 供「按名 upsert」比对用。
 *
 * 真机踩到（2026-10-02）：模板里的文字节点名是 `Body / Default`（斜杠两侧**带空格**），
 * Penpot 把 `/` 当文件夹分隔且**每段会 trim**，于是存成 `name='Default' / path='Body'`。
 * 原来的 upsert 只做了「按 `/` 取叶子」而**没有 trim**，叶子名成了 `' Default'`，
 * 与已存在的 `'Default'` 永远不相等 → 每次注册都新建，文本样式无限翻倍（真机 5 轮 = 20 个）。
 *
 * 归一口径（与 Penpot 存储一致）：
 *   - 叶子名：最后一个 `/` 之后的部分，**trim**；
 *   - 命中判据：已存名（trim）等于查询全名（trim），或其叶子名（trim）。
 *
 * 颜色样式走同一条规则（Penpot 的 `LibraryColor`、`LibraryTypography` 同样按 `/` 分文件夹）。
 */

/** 最后一个 `/` 之后的部分并 trim（Penpot 存叶子名时不带两侧空格） */
export function leafStyleName(name: string): string {
  const at = name.lastIndexOf('/')
  return (at >= 0 ? name.slice(at + 1) : name).trim()
}

/**
 * upsert 比对：`storedName`（宿主里已有的名字）是否指向 `queryName` 想要的同一个样式。
 *
 * - Penpot：`storedName` 是**叶子名**（如 `Default`），`queryName` 是节点全名（如 `Body / Default`）
 *   → 走叶子命中；
 * - MemoryHost：`storedName` 就是当初传入的全名 → 走全名命中。
 */
export function styleNameMatches(storedName: string, queryName: string): boolean {
  const stored = storedName.trim()
  return stored === queryName.trim() || stored === leafStyleName(queryName)
}
