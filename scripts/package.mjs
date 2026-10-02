/**
 * MasterGo MCP 一键打包工具
 *
 * 打包内容：
 * 1. mcp-server (已构建)
 * 2. uxship-design skill (skills/design)
 *
 * 输出：dist/uxship-{version}-package.zip
 *
 * 使用方式：
 *   node scripts/package.mjs              # 交互式打包
 *   node scripts/package.mjs --skip-build # 跳过构建直接打包
 *   node scripts/package.mjs --output /path/to/output # 指定输出目录
 */
import { promises as fs, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')
const OUTPUT_DIR = join(ROOT_DIR, 'dist')
const TEMP_DIR = join(ROOT_DIR, 'dist', 'temp-package')

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(color, ...args) {
  console.log(`${color}${args.join(' ')}${colors.reset}`)
}

function info(...args) { log(colors.blue, '[INFO]', ...args) }
function success(...args) { log(colors.green, '[SUCCESS]', ...args) }
function warn(...args) { log(colors.yellow, '[WARN]', ...args) }
function error(...args) { log('\x1b[31m', '[ERROR]', ...args) }

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    skipBuild: false,
    outputDir: OUTPUT_DIR,
    clean: false,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip-build') options.skipBuild = true
    else if (args[i] === '--output' && args[i + 1]) {
      options.outputDir = args[++i]
    }
    else if (args[i] === '--clean') options.clean = true
  }

  return options
}

// 检查目录是否存在
async function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// 执行命令
function exec(cmd, cwd = ROOT_DIR) {
  info(`执行: ${cmd}`)
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return output
  } catch (e) {
    error(`命令执行失败: ${cmd}`)
    if (e.stdout) console.log(e.stdout)
    if (e.stderr) console.error(e.stderr)
    throw e
  }
}

// 递归复制目录
// 复制目录，支持排除特定文件和扩展名
async function copyDir(src, dest, options = {}) {
  const { exclude = [], includeOnly = null, excludeExt = [] } = options
  await ensureDir(dest)

  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    // 排除特定目录/文件
    if (exclude.some(pattern => entry.name === pattern || srcPath.includes(pattern))) {
      continue
    }

    // 排除特定扩展名
    if (excludeExt.some(ext => entry.name.endsWith(ext))) {
      continue
    }

    // 如果指定了 includeOnly，则只包含特定文件
    if (includeOnly && !includeOnly.some(pattern => entry.name === pattern || entry.name.endsWith(pattern))) {
      continue
    }

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, { exclude, includeOnly, excludeExt })
    } else {
      await fs.copyFile(srcPath, destPath)
      info(`  复制: ${entry.name}`)
    }
  }
}

// 创建 ZIP 归档 (使用简单的tar+gzip格式，因为跨平台zip需要额外依赖)
async function createArchive(sourceDir, outputPath, baseName) {
  info(`创建归档: ${baseName}`)

  // 先创建 tar.gz
  const tarPath = join(OUTPUT_DIR, `${baseName}.tar.gz`)

  // 使用系统 tar 命令创建归档
  try {
    exec(`tar -czf "${tarPath}" -C "${sourceDir}" .`, ROOT_DIR)
    success(`归档已创建: ${tarPath}`)
    return tarPath
  } catch {
    // 如果tar失败，尝试使用Node.js内置方式
    warn('系统tar不可用，使用Node.js内置归档...')
    await createSimpleArchive(sourceDir, tarPath)
    return tarPath
  }
}

// 简单的 tar.gz 创建（无依赖方式）
async function createSimpleArchive(sourceDir, outputPath) {
  // 收集所有文件
  const files = []
  async function collectFiles(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await collectFiles(fullPath, relativePath)
      } else {
        const content = await fs.readFile(fullPath)
        files.push({
          path: relativePath,
          content: content.toString('base64'),
          mode: entry.mode,
        })
      }
    }
  }

  await collectFiles(sourceDir)

  // 简单 tar 格式：文件列表JSON + base64内容
  const manifest = {
    version: '1.0',
    created: new Date().toISOString(),
    files: files.map(f => ({
      path: f.path,
      size: Buffer.from(f.content, 'base64').length,
      mode: f.mode,
    })),
    contents: files.reduce((acc, f) => {
      acc[f.path] = f.content
      return acc
    }, {}),
  }

  // 写入 tar.gz (简化版，直接写入json+gzip)
  const jsonContent = JSON.stringify(manifest)
  const { gzip } = await import('zlib')
  const gzipped = gzip(Buffer.from(jsonContent))

  await fs.writeFile(outputPath, gzipped)
  success(`归档已创建: ${outputPath}`)
}

// 清理临时目录
async function cleanTemp() {
  if (existsSync(TEMP_DIR)) {
    info('清理临时目录...')
    await fs.rm(TEMP_DIR, { recursive: true, force: true })
  }
}

// 获取版本号
async function getVersion() {
  try {
    const pkg = JSON.parse(
      await fs.readFile(join(ROOT_DIR, 'mcp-server', 'package.json'), 'utf-8')
    )
    return pkg.version || '1.0.0'
  } catch {
    return '1.0.0'
  }
}

// 创建安装脚本
async function createInstallScripts(pkgDir) {
  info('创建安装脚本...')

  // Windows 安装脚本
  const installBat = `@echo off
chcp 65001 > nul
echo ========================================
echo   MasterGo MCP Server 安装程序
echo ========================================
echo.

echo [1/3] 检查 Node.js 环境...
node --version > nul 2>&1
if errorlevel 1 (
    echo [错误] 未安装 Node.js，请先安装 https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js 已安装

echo.
echo [2/3] 安装依赖...
call npm install
if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)
echo [OK] 依赖安装完成

echo.
echo [3/3] 配置 MCP...
call npm run config:mcp
echo [OK] MCP 配置完成

echo.
echo ========================================
echo   安装成功！
echo ========================================
echo.
echo 使用以下命令启动：
echo   npm start                           # HTTP + WebSocket 模式
echo   npx uxship-mcp --stdio     # STDIO 模式（AI IDE）
echo.
echo 启动前请先打开 MasterGo 桌面端，服务器会自动检测连接。
echo.
pause
`

  // Unix/Linux/macOS 安装脚本
  const installSh = `#!/bin/bash

set -e

echo "========================================"
echo "  MasterGo MCP Server 安装程序"
echo "========================================"
echo ""

echo "[1/3] 检查 Node.js 环境..."
if ! command -v node &> /dev/null; then
    echo "[错误] 未安装 Node.js，请先安装 https://nodejs.org/"
    exit 1
fi
echo "[OK] Node.js 已安装 ($(node --version))"

echo ""
echo "[2/3] 安装依赖..."
npm install
echo "[OK] 依赖安装完成"

echo ""
echo "[3/3] 配置 MCP..."
npm run config:mcp
echo "[OK] MCP 配置完成"

echo ""
echo "========================================"
echo "  安装成功！"
echo "========================================"
echo ""
echo "使用以下命令启动："
echo "  npm start                           # HTTP + WebSocket 模式"
echo "  npx uxship-mcp --stdio     # STDIO 模式（AI IDE）"
echo ""
echo "启动前请先打开 MasterGo 桌面端，服务器会自动检测连接。"
echo ""
`

  // MCP 配置脚本
  const configMcpSh = `#!/bin/bash

# MasterGo MCP 自动配置脚本

echo "正在配置 MasterGo MCP..."

# 检测操作系统
detect_os() {
    case "$(uname -s)" in
        Darwin*)  echo "macos" ;;
        Linux*)   echo "linux" ;;
        CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
        *)        echo "unknown" ;;
    esac
}

OS=$(detect_os)

# 确定配置文件路径
get_config_path() {
    local os=$1
    case $os in
        macos)
            # Trae on macOS
            if [ -d "$HOME/Library/Application Support/Trae CN/User" ]; then
                echo "$HOME/Library/Application Support/Trae CN/User/mcp.json"
            elif [ -d "$HOME/Library/Application Support/Trae/User" ]; then
                echo "$HOME/Library/Application Support/Trae/User/mcp.json"
            # Claude Code
            elif [ -f "$HOME/.claude/mcp.json" ]; then
                echo "$HOME/.claude/mcp.json"
            # Cursor
            elif [ -f "$HOME/.cursor/mcp.json" ]; then
                echo "$HOME/.cursor/mcp.json"
            else
                echo ""
            fi
            ;;
        linux)
            if [ -f "$HOME/.config/Trae/mcp.json" ]; then
                echo "$HOME/.config/Trae/mcp.json"
            elif [ -f "$HOME/.claude/mcp.json" ]; then
                echo "$HOME/.claude/mcp.json"
            else
                echo ""
            fi
            ;;
        windows)
            if [ -f "$APPDATA/Trae CN/User/mcp.json" ]; then
                echo "$APPDATA/Trae CN/User/mcp.json"
            elif [ -f "$APPDATA/Trae/User/mcp.json" ]; then
                echo "$APPDATA/Trae/User/mcp.json"
            else
                echo ""
            fi
            ;;
        *)
            echo ""
            ;;
    esac
}

CONFIG_PATH=$(get_config_path)

if [ -z "$CONFIG_PATH" ]; then
    echo "[警告] 未检测到支持的 AI IDE，将创建示例配置"
    CONFIG_PATH="./mcp-config.json"
fi

echo "配置文件: $CONFIG_PATH"

# MCP 服务器配置
# STDIO 模式（推荐）：IDE 通过 npx 启动服务器，自动连接 MasterGo
MCP_CONFIG='{
  "mcpServers": {
    "uxship": {
      "command": "npx",
      "args": ["-y", "uxship-mcp", "--stdio"]
    }
  }
}'

# 检查现有配置
if [ -f "$CONFIG_PATH" ]; then
    echo "检测到现有 MCP 配置，正在合并..."
    # 简单合并：保留现有配置，添加 uxship
    if grep -q "uxship" "$CONFIG_PATH" 2>/dev/null; then
        echo "[跳过] uxship 已配置"
    else
        # 使用 node 合并 JSON
        node -e "
        const fs = require('fs');
        const path = require('path');
        const configPath = process.argv[1];
        const newConfig = JSON.parse(process.argv[2]);

        let existing = {};
        try {
            existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (e) {}

        existing.mcpServers = { ...existing.mcpServers, ...newConfig.mcpServers };
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
        " "$CONFIG_PATH" '$MCP_CONFIG'
        echo "[OK] uxship 已添加到配置"
    fi
else
    echo "创建新配置文件..."
    mkdir -p "$(dirname "$CONFIG_PATH")"
    echo "$MCP_CONFIG" > "$CONFIG_PATH"
    echo "[OK] 配置文件已创建"
fi

echo ""
echo "配置完成！"
echo ""
echo "下一步："
echo "1. 确保 MasterGo 桌面端已打开"
echo "2. 重启 AI IDE（服务器会自动连接）"
echo "3. 或手动启动: npm start"
`

  // Windows MCP 配置脚本
  const configMcpBat = `@echo off
chcp 65001 > nul
echo 正在配置 MasterGo MCP...

REM 检测配置文件路径
set "CONFIG_PATH="

REM Trae on Windows
if exist "%APPDATA%\\Trae CN\\User\\mcp.json" set "CONFIG_PATH=%APPDATA%\\Trae CN\\User\\mcp.json"
if exist "%APPDATA%\\Trae\\User\\mcp.json" set "CONFIG_PATH=%APPDATA%\\Trae\\User\\mcp.json"
if exist "%USERPROFILE%\\.claude\\mcp.json" set "CONFIG_PATH=%USERPROFILE%\\.claude\\mcp.json"

if "%CONFIG_PATH%"=="" (
    echo [警告] 未检测到支持的 AI IDE
    set "CONFIG_PATH=%CD%\\mcp-config.json"
)

echo 配置文件: %CONFIG_PATH%

REM 创建配置内容
echo {"mcpServers":{"uxship":{"url":"http://localhost:15490/sse"}}} > "%CONFIG_PATH%"

echo [OK] MCP 配置完成
echo.
echo 配置完成！
echo.
echo 下一步：
echo 1. 确保 MasterGo 桌面端已打开
echo 2. 重启 AI IDE（服务器会自动连接）
echo 3. 或手动启动: npm start
pause
`

  await fs.writeFile(join(pkgDir, 'install.bat'), installBat)
  await fs.writeFile(join(pkgDir, 'install.sh'), installSh)
  await fs.writeFile(join(pkgDir, 'config-mcp.sh'), configMcpSh)
  await fs.writeFile(join(pkgDir, 'config-mcp.bat'), configMcpBat)

  // 设置可执行权限 (Unix)
  try {
    execSync('chmod +x "' + join(pkgDir, 'install.sh') + '"')
    execSync('chmod +x "' + join(pkgDir, 'config-mcp.sh') + '"')
  } catch {
    // Windows 忽略
  }

  success('安装脚本已创建')
}

// 创建 README
async function createReadme(pkgDir, version) {
  // 公开快照可能不带 CHANGELOG（内部变更记录不随公开仓分发），此时不要生成死链
  const changelogSection = existsSync(join(ROOT_DIR, 'CHANGELOG.md'))
    ? '## 更新日志\n\n详见 [CHANGELOG.md](./CHANGELOG.md)\n\n'
    : ''
  const readme = `# uxship MCP Server v${version}

通过 MCP (Model Context Protocol) 协议连接 AI Agent 与 MasterGo 设计工具的服务器。

## 快速安装

### Windows
1. 解压 zip 文件
2. 双击运行 \`install.bat\`
3. 按照提示完成安装

### macOS / Linux
1. 解压 tar.gz 文件
2. 终端进入目录
3. 运行 \`chmod +x install.sh && ./install.sh\`

## 启动服务

\`\`\`bash
# HTTP/SSE 模式（推荐）- 后台持续运行
npm start

# 或使用 npx
npx uxship-mcp
\`\`\`

## AI IDE 配置

安装脚本会自动配置 MCP。若需手动配置，添加以下内容到 MCP 配置文件：

### STDIO 模式（推荐给 AI IDE，如 Cursor/Claude Code）
\`\`\`json
{
  "mcpServers": {
    "uxship": {
      "command": "npx",
      "args": ["-y", "uxship-mcp", "--stdio"]
    }
  }
}
\`\`\`

### SSE 模式（适用于 HTTP/SSE 客户端）
\`\`\`json
{
  "mcpServers": {
    "uxship": {
      "url": "http://localhost:15490/sse"
    }
  }
}
\`\`\`

### 配置文件位置
- **Trae**: \`~/Library/Application Support/Trae CN/User/mcp.json\` (macOS)
- **Claude Code**: \`~/.claude/mcp.json\`
- **Cursor**: \`~/.cursor/mcp.json\`

## 自动连接

启动服务器后会自动检测 MasterGo 桌面端：
1. 如果检测到 MasterGo 桌面端 HTTP API（端口 50678），直接使用 HTTP 模式
2. 否则等待 \`plugin-mastergo\` 插件通过 WebSocket 连接
3. 两边都无需手动操作

## 验证连接

\`\`\`bash
curl http://localhost:15490/health
\`\`\`

返回 \`{"backendMode": "http"}\` 或 \`{"pluginConnected": true}\` 表示连接成功。

## 工具列表

共 **67 个**业务工具（46 个插件路由 + 21 个服务端本地）+ 2 个诊断工具；完整清单见 \`skills/uxship-design/rules/07-mcp-tools.md\`。

- \`code_to_design\` - HTML+Tailwind 一键渲染到画布（渲染后默认自动聚焦并选中成果）
- \`node_swap_component\` - 换组件：实例换主组件；普通对象（frame/矩形/文本等）原位替换为组件实例
- \`team_library_list\` / \`team_component_search\` / \`team_component_import\` - 团队组件库检索与实例化
- \`canvas_zoom_to_node\` / \`canvas_zoom_to_rect\` / \`selection_set\` - 画布聚焦与选区
- \`design_to_code\` - DSL 转 HTML+Tailwind（含设计令牌导出）
- \`icon_search\` / \`icon_render\` - 图标搜索与渲染（20 万+）
- \`component_render\` - 33 种高阶组件
- \`task_plan\` / \`task_step\` / \`task_complete\` - 任务进度通知
- 节点操作（create/update/delete/clone/move/export）、DSL 导出、样式库管理等

详细文档: https://github.com/BenXsha/uxship

${changelogSection}## 许可证

Apache-2.0
`

  await fs.writeFile(join(pkgDir, 'README.md'), readme)
  info('README.md 已创建')
}

// 主打包流程
async function main() {
  console.log(`
${colors.cyan}
╔══════════════════════════════════════════════╗
║    MasterGo MCP Server 打包工具 v1.0         ║
╚══════════════════════════════════════════════╝
${colors.reset}
`)

  const options = parseArgs()

  // 解析版本
  const version = await getVersion()
  info(`当前版本: ${version}`)

  // 清理旧文件
  if (options.clean || options.skipBuild) {
    await cleanTemp()
  }

  // 确保输出目录存在
  await ensureDir(OUTPUT_DIR)
  await ensureDir(TEMP_DIR)

  const pkgName = `uxship-${version}-package`
  const pkgDir = join(TEMP_DIR, pkgName)

  try {
    // 1. 构建服务器
    if (!options.skipBuild) {
      info('='.repeat(50))
      info('步骤 1: 构建 mcp-server')
      info('='.repeat(50))
      exec('npm run build', join(ROOT_DIR, 'mcp-server'))
      success('构建完成')
    } else {
      warn('跳过构建步骤')
    }

    // 2. 复制服务器文件
    info('='.repeat(50))
    info('步骤 2: 复制服务器文件')
    info('='.repeat(50))
    await copyDir(join(ROOT_DIR, 'mcp-server'), join(pkgDir, 'mcp-server'), {
      exclude: [
        'node_modules', '.git', 'src', 'scripts', '*.ts',
        // 运行时/本地残留，不进分发包
        '_preview', '.agent-sessions', '.uxship', '.DS_Store',
      ],
    })
    success('服务器文件复制完成')

    // 3. 复制 Skill 文件
    info('='.repeat(50))
    info('步骤 3: 复制 Skill 文件')
    info('='.repeat(50))
    await copyDir(join(ROOT_DIR, 'skills', 'design'), join(pkgDir, 'skills', 'uxship-design'))
    success('Skill 文件复制完成')

    // 4. 创建安装脚本
    await createInstallScripts(pkgDir)

    // 5. 创建 README
    await createReadme(pkgDir, version)

    // 5b. 复制 CHANGELOG
    const changelogSrc = join(ROOT_DIR, 'CHANGELOG.md')
    if (existsSync(changelogSrc)) {
      await fs.copyFile(changelogSrc, join(pkgDir, 'CHANGELOG.md'))
      info('CHANGELOG.md 已复制')
    }

    // 6. 创建 package.json
    const packageJson = {
      name: 'uxship-bundle',
      version: version,
      description: 'uxship — MCP server + skills bundle',
      scripts: {
        postinstall: 'cd mcp-server && npm install --production',
        start: 'cd mcp-server && npm start',
        dev: 'cd mcp-server && npm run dev',
        'build:server': 'cd mcp-server && npm run build',
        'config:mcp': 'bash config-mcp.sh',
      },
      files: [
        'mcp-server/',
        'skills/',
      ],
    }
    await fs.writeFile(join(pkgDir, 'package.json'), JSON.stringify(packageJson, null, 2))

    // 7. 复制 plugin-mastergo 插件
    info('='.repeat(50))
    info('步骤 4: 复制 plugin-mastergo 插件')
    info('='.repeat(50))
    if (existsSync(join(ROOT_DIR, 'plugin-mastergo'))) {
      // 复制预构建的 dist 文件
      if (existsSync(join(ROOT_DIR, 'plugin-mastergo', 'dist'))) {
        await copyDir(join(ROOT_DIR, 'plugin-mastergo', 'dist'), join(pkgDir, 'plugin-mastergo', 'dist'), {
          exclude: [],
        })
        info('  dist 文件已复制')
      }
      // 复制必要的源码（不包含 .ts, .vue 等）用于参考
      await copyDir(join(ROOT_DIR, 'plugin-mastergo'), join(pkgDir, 'plugin-mastergo'), {
        exclude: ['node_modules', '.git', 'dist', 'scripts', '.DS_Store'],
        excludeExt: ['.ts', '.vue', '.tsx', '.jsx', '.json'],
      })
      // manifest.json 是 MasterGo 插件的加载入口，必须包含（上面的 .json 排除会误伤）
      const manifestSrc = join(ROOT_DIR, 'plugin-mastergo', 'manifest.json')
      if (existsSync(manifestSrc)) {
        await fs.copyFile(manifestSrc, join(pkgDir, 'plugin-mastergo', 'manifest.json'))
        info('  manifest.json 已复制（插件加载入口）')
      } else {
        warn('plugin-mastergo/manifest.json 不存在，插件将无法加载！')
      }
      success('plugin-mastergo 插件复制完成')
    } else {
      warn('plugin-mastergo 目录不存在，跳过')
    }

    // 8. 创建归档
    info('='.repeat(50))
    info('步骤 5: 创建归档')
    info('='.repeat(50))

    // 先复制到临时目录的根目录
    await ensureDir(join(TEMP_DIR, 'uxship'))
    await copyDir(pkgDir, join(TEMP_DIR, 'uxship'))

    const archivePath = await createArchive(
      join(TEMP_DIR, 'uxship'),
      OUTPUT_DIR,
      pkgName
    )

    // 清理临时目录
    await cleanTemp()

    // 完成
    console.log(`
${colors.green}
╔══════════════════════════════════════════════╗
║              打包完成！                       ║
╚══════════════════════════════════════════════╝
${colors.reset}

输出文件: ${archivePath}

使用方法:
1. 解压文件
2. 运行安装脚本: ${process.platform === 'win32' ? 'install.bat' : './install.sh'}
3. 确保 MasterGo 桌面端已打开
4. 启动服务: npm start（或配置 IDE 使用 npx uxship-mcp --stdio）
`)

  } catch (e) {
    error(`打包失败: ${e.message}`)
    await cleanTemp()
    process.exit(1)
  }
}

main()
