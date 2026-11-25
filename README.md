# Vegetation Studio & Rock Studio (`foliage-mass-prototype`)

> **在线体验（GitHub Pages）**：
> - **[打开经典树木工作台（主入口）](https://koerye.github.io/foliage-mass-prototype/)** — 全品类程序化植被（含竹子/荷花/羽叶林木/卧枝盆景）、树干雕刻、SpeedTree 枝干/树叶/法线编辑、贴图节点工坊 v2、LOD 与 GLB/FBX 导出
> - **[打开场景组装工作台（Scene Studio）](https://koerye.github.io/foliage-mass-prototype/scene.html)** — 自由摆放无限资产、直连树木工作台资产库、UE 风格刷草与地形材质笔刷（RVT 联动）、远景 LOD 与透明底抠图
> - **[打开 AI 模式（丢图生成 & 案例库）](https://koerye.github.io/foliage-mass-prototype/ai.html)** — 面向 Agent / 拖图自动拆解多部件植物、抠图画笔、案例库与整体/单体编辑
> - **[打开风格化石头工作台（Rock Studio）](https://koerye.github.io/foliage-mass-prototype/rock.html)** — 三层地质切面雕刻、厚涂 & 赛璐璐双着色风格、灰模/线框与 GLB 导出
>
> 💡 **本地运行 & 桌面版**：仓库内置作者精修的 **14 套默认树木预设覆盖**、**个人预设库与场景案例**（`user-presets/`）及 **12 项程序贴图库**（`user-textures/library.json`），支持 Web（`npm run dev`）、Electron 桌面双模版（`npm run electron` / `npm run dist:win`）与内置 MCP 服务（`npm run mcp`）。

一个基于 **TypeScript + Three.js + WebGL 2 + Vite + Electron** 构建的实时程序化 3D 植被、岩石与场景组装创作工作台，面向游戏与风格化三维场景的资产生产。

---

## 效果预览

| 多树种与风格化叶型总览 | AI 案例 · 盘曲古樱 |
| :---: | :---: |
| ![多树种与风格化叶型总览](docs/images/presets-and-styles.png) | ![盘曲古樱](docs/images/sakura-twist.png) |

| 树干褶皱雕刻 & 一级枝口无缝焊接 | 贴图节点工坊 v2 · 参考图卷帘对比 & 复刻 |
| :---: | :---: |
| ![树干褶皱雕刻](docs/images/wood-sculpt-v3.png) | ![贴图节点工坊 v2](docs/images/texgraph-v2.png) |

| 全新 Rock Studio · 风格化石头工作台 | 6 项硬核 GLB 导出（高模法线+AO / UV1 风动） |
| :---: | :---: |
| ![Rock Studio 风格化石头工作台](docs/images/rock-studio.png) | ![GLB 导出设置](docs/images/glb-export-options.png) |

| SpeedTree 风格 3D 枝干节点编辑 | 案例库 · 繁花绿灌木丛 |
| :---: | :---: |
| ![SpeedTree 风格枝干节点编辑](docs/images/speedtree-node-edit.png) | ![繁花绿灌木丛](docs/images/flowering-bush.png) |

---

## 核心功能

### 1. 多品类程序化植被生成 & 多排布花丛
- **阔叶 / 观赏树**：多级分叉骨架、底冠露枝负空间（`canopyLift`）、云片冠层压平（`padFlatten`）、扭棱古干与贴地露根；内置圆冠、舒展、羽叶高冠树（`feathery` 细腻微叶卡）、卧枝云片盆景、樱花盆景、红枫绯秋、垂柳轻丝、仙韵祈愿古树、绞缠枯树、扭纹古干等预设。
- **竹子 / 荷花 / 针叶 / 棕榈 / 灌木 / 实体 3D 草叶 / 蕨类**：束腰双唇竹节与 V 折掌状叶扇竹丛（写实/Q 版）、挺水/浮叶荷花、松树折叠面片、带节环与椰果簇的棕榈、无贴图纯几何实体 3D 草叶。
- **独立花丛模板（带杆 / 纯花）**：带植物杆模式自带植物学 Alpha 茎叶贴图槽，支持一键切换**球形圆丘 / 方形 / 长条花带 / 环形 / 列阵**等多种分布排布。

### 2. 树干高质感褶皱雕刻 v3 & 感知 HSL 实时换色
- **树干雕刻与单流形无缝焊接**：锚定宽脊、一体连续板根、弯肘局部挤压褶皱、跨圆柱 UV 缝无缝单流形一级枝口焊接与抗混叠流场 UV；拖动雕刻/树皮参数仅原地局部重建木质几何（提速 ~8×）。
- **所见即所得感知换色**：针对彩色手绘叶贴图与自定义树皮贴图提供感知 HSL 色相映射，拉动内外叶色与树皮色调所见即所得、不发灰发脏。
- **3D 世界空间朝上青苔**：按世界法线与根沟积苔实时渲染厚涂青苔（`0 ms` GPU 实时滑块）。

### 3. SpeedTree 风格节点编辑、3D 树叶直接编辑与自定义法线
- **树冠竖向轮廓曲线 & 全局枝条位移**：交互式镜像 SVG 曲线编辑器（默认 / 花瓶收腰 / 宝塔层级 / 伞盖宽顶 + 5 点实时拖拽），支持全局枝条起始高度、方位旋转与 XYZ 空间位移。
- **SpeedTree 风格枝干节点模式**：3D 视口直接点选主干/主枝/侧枝，使用金色长度柄、同心仰角弧与 4 点 3D 样条塑形，支持**拖动绿色根点沿树干上下滑动（或 `Shift+拖拽` 自由 3D 偏移）**、单枝去叶、级联修剪（`Delete`）与 30 步撤销（`Ctrl+Z`）。
- **🍃 树叶直接编辑（3D 补叶簇 + 树冠笔刷）**：支持点击枝干/树冠种植可 3D 拖拽的补叶簇（半径/压扁/密度/叶大小/局部染色），并提供 **增密 / 疏剪 / 放大缩小 / 局部染色 / 擦除** 5 款 3D 笔刷，全面兼容撤销、JSON、LOD 与 GLB/FBX 导出。
- **树叶自定义法线编辑（Normal Transfer + 3D 笔刷）**：支持 6 种法线投射模式、拖拽 3D 青色投射球心、树冠表面 3D 梳向/提亮/球凸/平滑笔刷与 RGB 法线实时检视，导出 GLB 100% 保留自定义 `NORMAL`。

### 4. Substance 风格贴图节点工坊 v2 & 实时贴图库
- **独立 Web Worker 60fps 节点图引擎**：支持树皮/噪声/叶片/花朵/扭曲/曲率 AO/色板映射/描边等节点与 1:1 矢量自由构图拖拽（`Vector Layout`），支持任意 `N×M` 与 **8 区非对称橡叶图集（`Atlas Compose`）**，全通道 PBR（`BaseColor / Normal / Height / Roughness`）实时同步 3D 树木并落盘至 `user-textures/library.json`。
- **参考图对照器 & AI 自动复刻**：支持导入参考图进行**卷帘（Wipe）/ 半透明叠加 / 差异热力图 / 原像素吸管**比对，一键「✨分析初稿 → ⚡自动寻优」将参考图拆解为可编辑节点图并同步上树。

### 5. AI 模式（面向 Agent · 丢图自动生成多部件植物）
- **零依赖内置图像解析 + Agent Schema/JSON 接口**：把参考图和源码发给 DeepSeek / Codex 等 Agent 平台即可调用底层参数生成 3D 植物；也可直接将图片拖入空白画布自动拆解多部件、使用抠图画笔修补。
- **整体同步 / 单体隔离双模式 & 案例库**：默认整体同步联动调色、光影与整树 LOD；开启节点编辑后可单部件独立调参、改位姿与贴图覆写；内置成品案例库支持悬停实时 3D 预览、收藏与管理。

### 6. 全新 Rock Studio · 风格化石头工作台（`/rock.html`）
- **三层地质切面多面体裁切 + 面加权法线**：闭合凸多面体 + 跨倒角连续法线（零破缝），内置**厚涂风格化**（顶部沙/青苔/积雪覆层 + 棱角干扫）与**赛璐璐简面**（4 阶硬朗明暗 + 断续高光线）双着色模式。
- **6 套即用预设**：沙顶切面岩、赛璐璐简面石、凿面碎棱岩、宽厚平棱巨石、森林青苔磐石、自然石堆组合，支持成品 / 灰模 / 线框切换、随机石形、JSON 读写与 GLB 导出。

### 7. Scene Studio 场景组装、Electron 桌面端 + MCP 与工程级多格式导出
- **场景组装工作台（`/scene.html`）**：自由摆放无限树木/花草/石头/AI 多部件场景，**双向直连树木工作台资产库**（`★ 我的库` + `🌳 树木资产库` 含自定义贴图与跨页热同步、支持选中植物一键存回树木预设库）；内置 UE 风格植被刷草笔刷、手绘地形材质笔刷（RVT 草色/法线实时融合）、远景自动 `THREE.LOD` 与参考图卷帘对比。
- **Electron 桌面双模壳 & 内置 MCP 服务端**：支持热更新开发（`npm run electron:dev`）、一键打包 Windows 便携 `.exe`（`npm run dist:win`）与 23 个结构化 MCP 工具（`npm run mcp`），可直接由 AI 代理实时建树、调参、组装场景与截屏验收。
- **全状态保存替换默认预设 & 多格式导出**：
  - 支持 **GLB 合并/拆分**、**拆分 `glTF + textures/*.png`**、**标准二进制 `FBX 7.4 + textures/*.png`**、**一键 `LOD0~LOD3.zip`** 及四工作台统一 **透明底 PNG**；
  - 支持默认程序化树皮自动烘焙 BaseColor + Normal PNG、实体 3D 草可选烘焙渐变贴图、独立 Worker 高模雕刻法线 + Cavity AO 烘焙（OpenGL/DirectX）与 `UV1 / TEXCOORD_1` 风动权重。

---

## 快速开始

### 环境要求
- **Node.js** `20.19+` 或 `22.12+`
- 支持 **WebGL 2** 的现代浏览器（Chrome / Edge / Firefox）

### 安装与启动

```bash
npm install
npm run dev
```

启动后打开浏览器访问终端输出的地址（默认 `http://127.0.0.1:5867`）：

| 入口路径 | 说明 |
| --- | --- |
| `/`（或 `/broadleaf.html`） | **经典树木工作台（主入口）**：全品类程序化植被、树干雕刻、枝干/树叶/法线编辑、贴图工坊 v2、LOD 与预设库 |
| `/scene.html` | **场景组装工作台（Scene Studio）**：多资产摆放、直连树木资产库、刷草/地形 RVT 笔刷、远景 LOD 与案例库 |
| `/ai.html` | **AI 模式（空白工程）**：面向 Agent、拖入参考图生成多部件植物、案例库、抠图画笔 |
| `/rock.html` | **风格化石头工作台（Rock Studio）**：切面雕刻、厚涂 & 赛璐璐双着色风格、随机石形与 GLB 导出 |
| `/legacy.html` | **旧版工作台**：薄片阔叶与松树对照页面 |

Windows 用户也可以直接双击或运行 `start.cmd`：

```bat
start.cmd            :: 默认启动经典树木工作台
start.cmd scene      :: 启动场景组装工作台 (/scene.html)
start.cmd ai         :: 启动 AI 模式 (/ai.html)
start.cmd rock       :: 启动风格化石头工作台 (/rock.html)
```

### 构建、桌面打包与测试

```bash
# TypeScript 类型检查 + Vite 生产构建
npm run build

# 运行 Vitest 单元测试套件（27 个测试文件 / 349 项）
npm test

# 启动 Electron 桌面端 / 打包 Windows 便携版 EXE
npm run electron
npm run dist:win
```

> 可选：如需运行 Python Playwright 浏览器视觉自动化检查（`tests/*_browser.py`），需本地安装 Chrome 以及 Python 的 `playwright` 与 `Pillow`。

---

## 目录结构

```text
foliage-mass-prototype/
├── index.html                 # 经典程序化树木工作台主入口
├── broadleaf.html             # 经典树木工作台兼容入口
├── scene.html                 # Scene Studio 场景组装工作台入口
├── ai.html                    # AI 识图多部件工作台入口
├── rock.html                  # Rock Studio 风格化石头工作台入口
├── legacy.html                # 旧版工作台入口
├── start.cmd                  # Windows 一键启动脚本
├── electron/                  # Electron 桌面双模壳与本地服务（app-server / main / preload）
├── mcp/                       # 面向 AI Agent 的 MCP 服务端与 23 项结构化操控工具
├── user-presets/              # 作者精修的 14 套默认树木预设覆盖、个人预设库与场景案例
├── user-textures/             # 贴图工坊本地实时贴图库（12 项程序贴图与 PBR 资产）
├── src/
│   ├── tree/                  # 统一程序化植物核心引擎（骨架/树干雕刻/竹子/荷花/树叶编辑/法线/花丛/烘焙/LOD 等）
│   ├── assembly/              # Scene Studio 场景组装引擎、刷草/地形 RVT 笔刷、案例与跨工作台同步桥
│   ├── rock/                  # Rock Studio 风格化石头切面雕刻与厚涂/赛璐璐着色器
│   ├── texgraph/              # Substance 风格节点贴图工坊 v2、Web Worker 求值核与参考图自动复刻引擎
│   ├── studio/                # 工作台 UI、SpeedTree 枝干/树叶/法线编辑器、预设库、多格式导出弹窗与日志
│   ├── ai/                    # AI 图像解析、抠图画笔、多部件场景与案例库
│   ├── broadleaf/             # 叶片插片引擎、风格化 SSS/微风着色器与旧版工作台
│   ├── export-glb.ts          # glTF/GLB 与拆分贴图导出、合批分槽、青苔/树皮烘焙与 UV1 风动权重
│   ├── export-fbx.ts          # 标准二进制 FBX 7.4 + textures/*.png 导出管线
│   ├── export-zip.ts          # 轻量标准 PKZIP 打包（拆分贴图包与 LOD0~LOD3.zip）
│   └── viewport.ts            # Three.js 视口、四机位、透明抠图、氛围光与微风驱动
├── scripts/                   # Vite 本地持久化中间件（presets / textures）与无头贴图 CLI
├── presets/                   # 默认 JSON 预设文件
├── public/showcases/          # 案例库 3D 封面缩略图
├── textures/                  # 内置占位与程序化贴图资源
├── experiments/               # 早期松杉枝叶薄片对比实验代码
├── tests/                     # Vitest 单元测试套件（27 个测试文件 / 349 项）
└── docs/                      # 算法笔记、变更日志与展示截图
```

---

## 延伸阅读

- [植物资产生成算法小结](docs/algorithm-notes.md)：早期松树枝叶薄片（A/B/C 方案）与阔叶多级分枝的演进记录。

---

## 许可证（License）

本项目采用 **非商业软件使用许可**（详见 [LICENSE](LICENSE)）：

- **允许**：免费下载、运行、学习、修改及非商业分发（须保留原作者版权声明与 `LICENSE` 文件）。
- **禁止**：未经作者书面授权的任何商业用途（包括集成至商业游戏/软件或付费服务）。
- **仓库权限**：本仓库仅作者本人拥有写入权限，外部访客仅可浏览与下载。
