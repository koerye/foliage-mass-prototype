# PROJECT_STATE
项目：Vegetation Studio（foliage-mass-prototype）
本轮目标：用统一的程序化生成器（v2）替代 GPT 版的阔叶/松树算法：重写树干、松树改为 SpeedTree 式针叶簇、树冠可拖拽编辑。
完成定义：五个预设（2 阔叶 + 3 松树）可运行；树冠控制点可拖（拉宽 / 下垂 / 压扁 / 定向延伸）；裸枝区可控制哪里长叶；参数实时生效；JSON/GLB 可用；旧版工作台保留。
状态：可运行。

## 启动 / 构建 / 测试
- **桌面 `.exe`（推荐）**：直接双击 `release/win-unpacked/Vegetation Studio.exe` 或单文件便携版 `release/Vegetation-Studio-1.0.0-portable.exe`（自动拉起内置本地服务 + MCP 控制桥接）
- **开发模式**：桌面热更新 `npm run electron:dev`；桌面离线预览 `npm run electron`；纯网页开发 `npm run dev` / `start.cmd`（默认 `/broadleaf.html`、`/scene.html`、`/ai.html`、`/rock.html`、`/legacy.html`）
- **打包 / 构建 / 测试**：打包 `.exe`：`npm run dist:win`；网页构建：`npm run build`；单元测试：`npm test`（24 组 / 296 项）；MCP 服务入口：`npm run mcp`（已全局注入 `C:/Users/ronal/.gemini/config/mcp_config.json`）

## 核心文件（v2）
- `src/tree/spec.ts`：TreeSpec v2（树干 / 树冠 / 枝条 / 叶片 / 针叶 / 控制点）、五个预设、JSON 校验
- `src/tree/envelope.ts`：可编辑树冠包络（超椭球 / 锥形 + 控制点位移场 + 反变换 + 裸枝区）
- `src/tree/skeleton.ts`：骨架（阔叶：多主枝朝包络生长；松树：轮生 + 鱼骨状子枝；枯枝桩），沿路径加权变形，枝根不会脱离父枝
- `src/tree/wood.ts`：树干/枝条扫描网格（根部板状膨大、扭转树皮棱、枝领、顶点色 AO）
- `src/tree/fronds.ts`：松针簇（帐篷折叠 + 竖向交叉片 + 随机扭转 + 树顶簇，法线球化）
- `src/tree/assemble.ts`：整树装配；阔叶复用 `src/broadleaf/leaves.ts`（已泛化：任意骨架 + 外部包络 + 裸枝遮罩）
- `src/studio/main.ts`、`panel.ts`、`editor.ts`：新工作台、参数面板、视口控制点编辑器
- `textures/*_placeholder.png`：占位贴图示例

## 已验证（2026-11-18）
- `npm test` 60/60 通过（新增 19 项：确定性、枝根贴合、变形后仍贴合、拉宽/压扁生效、裸枝区剔除叶片、针叶几何有效、面数预算、JSON 往返）；`npm run build` 通过。
- 浏览器（Chrome + swiftshader，`tests/studio_browser.py`）：五个预设都能出图，生成耗时 23–60 ms（拖动时实时重建）；
  真实鼠标拖动：阔叶左侧 minX −2.47→−3.22、顶部 maxY 6.11→5.03；松树 minX −1.90→−3.36、maxY 9.0→7.37；
  裸枝区添加后叶片减少，侧视能看到露出的枝条；JSON 保存→重置→导入，控制点完整还原；GLB 导出正常；旧版页面正常；控制台零报错。
- 截图：`evidence/studio-v2/`。

## 2026-11-19 增量（插片方式 / 松树垂片 / 低矮植物）
- 叶片插片方式：单片 / 十字交叉 / 三向星形 / 扇形簇 / 沿枝条带（`leaves.cardType`，扇形片数与张角可调；十字/三向自动关闭朝向相机）。
- 松树默认改为「垂片」：每根主枝挂一张从枝条垂下的面片（贴图上边 = 枝条），子枝在垂片平面内下垂；原「折叠片」作为第二种方式保留（`fronds.mode`）。
- 新增低矮植物预设：灌木·圆球、灌木·低矮宽丛、针叶灌木·刺柏、草丛、高草·芦苇丛、蕨类（新类型 grass/fern，`src/tree/ground.ts`）；控制点与裸枝区对低矮植物同样生效。
- 新增占位贴图：`textures/drape|grass|fern_placeholder.png`。
- 验证：`npm test` 83/83（新增 `tests/plants.test.ts` 9 项）；构建通过；`python tests/plants_browser.py <url> <out>`：11 个预设 + 5 种插片都能出图，控制台零报错；截图见 `evidence/plants-v3/`。

## 2026-11-19 松树重构：一根枝条一张折叠叶形面片（默认）
- 依据参考原理（贴图 Alpha + 低面数中脊折叠面片）：主干上只长一级下垂外展枝条（无多余子枝，`childCount = 0`），每根枝条贴一张低面数 3 列折叠菱形/盾形面片（左缘/中脊/右缘），不拉伸 UV（`u = 0.5 ± 0.5*profile`，`v = 1` 上方枝根，`v = 0` 下方垂尖）。
- 枝条角度改为整体陡峭下垂并梢端外挑（底部 -44°、顶部 -62°、`tipCurl = 0.42`），主干起始挂点按垂直下垂量自动上移，保证底部树干露出、整树上疏下密、树顶由三层上下交错、同向向下外展的叶形面片（4+4+3）在顶点汇拢收尖，针叶方向与整树完全统一，俯视与特写均无接缝/倒刺。
- 占位贴图 `textures/needle_card_placeholder.png` 改为 512×512 正方形、上枝根下叶尖，自带柔和枝脉与粗笔触羽片。
- 验证：`npm test` 89/89 通过，`npm run build` 通过；四个针叶预设实测 42–78 张面片、9.2k–16.8k 三角面、5–10 ms 生成、零报错；截图见 `evidence/conifer-leafcards/`。

## 2026-11-19（早期版本，已由上方替代）
- 依照参考流程：枝桩 → 每根主枝一张叶形卡片（中脉沿枝条，窄基部、约 40% 处最宽、尖端），沿中脉 V 形折叠 + 边缘内扣 + 下弯，伸出枝梢；多层叠放成锥形；树顶由几片上扬卡片组成尖顶。轮廓由网格决定，贴图只负责针叶质感（新的粗笔触占位贴图 `textures/needle_card_placeholder.png`）。
- 参数：宽长比、伸出枝梢、卡片下弯、边缘内扣、每枝卡片数、中脉折角、随机扭转、子枝卡片比例。垂片和折叠片仍可在「针叶方式」里切换。松树预设默认不长子枝（只有枝桩），与参考一致。
- 验证：`npm test` 88/88（新增叶形卡测试 5 项）；浏览器四个针叶预设都能出图，零报错；截图见 `evidence/conifer-leafcards/`。

## 2026-11-19 其他树种优化 + 面数优化（LOD）系统
- **树种算法修复**：
  - 树干/枝条（`src/tree/wood.ts`）：根部底环与低位枝领钳制在 `y >= 0`，修复阔叶与灌木树干底部露出穿地尖刺的问题。
  - 阔叶树（`src/tree/skeleton.ts`）：取消顶部孤立直立主枝，并在主枝中段增加桥接树冠簇，消除原本「一坨坨分离圆球」的割裂感。
  - 蕨类与草丛（`src/tree/ground.ts`、`textures.ts`）：蕨类改为内外两层莲座 + 清晰羽片缺口；草丛叶片加粗、减淡根部过黑 AO，消除叶尖被 Alpha 裁成虚线的问题。
- **面数优化（LOD）系统**（`src/tree/optimize.ts` + 面板顶部「面数优化 · LOD」）：
  - 支持四档一键切换（高模 / 标准游戏 / 手游轻量 / 远景 LOD）、目标三角面数自动求解（「自动优化」二分搜索最小减面强度）、五项精细控制（优化强度、木质细分、剔除隐藏枝、叶片平板化、面积补偿减卡）。
  - 导出 GLB 同步生效；藏在裸枝区内的枝条在剔除隐藏枝时自动保留。
- **验证**：`npm test` 107/107 通过（新增 `tests/optimize.test.ts` 18 项），`npm run build` 通过；浏览器实测（`tests/optimize_browser.py`）零报错：阔叶 28,007 → 5,482（−80%）/ 3,022（−89%）/ 1,844（−93%），松树 13,274 → 1,588（−88%）/ 830（−94%）/ 436（−97%）；截图见 `evidence/optimize-v4/`。

## 2026-11-19 新增棕榈树（palm）
- 新建独立生成器 `src/tree/palm.ts`：带横向叶痕节环与根部膨大的弯曲 / S 形树干 + 冠底椰果簇（0–6，合批进木质网格，零额外 Draw Call）+ 顶冠三层交错下垂的 3 列折叠棕榈叶面片（不拉伸 UV：底边 = 叶柄、顶边 = 叶尖）。
- 新增三个预设：`棕榈 · 热带经典`（2,000 面）、`棕榈 · 粗干矮棕`（1,840 面）、`棕榈 · 弯干海滩`（2,096 面），均支持「编辑树冠」拖拽/裸枝区、「面数优化 · LOD」（标准游戏档 849 面 / −58%）、自定义棕榈叶贴图（占位图 `textures/palm_frond_placeholder.png`）与 GLB 导出。
- 验证：`npm test` 120/120 通过（含新增 3 项棕榈测试 + 穿地/LOD 覆盖），`npm run build` 通过，浏览器零报错；截图见 `evidence/palm/`。

## 2026-11-19 新增最外层花朵装饰（flowers）
- 新建模块 `src/tree/flowers.ts`：直接采样当前植物的实际叶面（阔叶/灌木直接读取 `LeafCard[]` 的位置、法线与尺寸，其余植物从叶面网格提取），按树冠包络径向分位数 + 向阳偏好筛选出最外层叶面；支持最远点采样生成自然花簇（`clumping` / `clusterCount`）或均匀散点，沿外法线微幅外推贴合在最表层。
- 尺寸严格跟随宿主叶面尺寸（`叶片尺寸 × sizeRatio`），自动适配灌木、大树与草丛；支持自定义 Alpha 花朵贴图（占位图 `textures/flower_cluster_placeholder.png`，白色花瓣便于自由染色）、图集行列、单片（默认，面片法线严格与树冠外法线一致、如球面法线始终朝外）/ 碗形微弯 / 十字立体、朝向相机、裸枝区自动避让、LOD 减面与 GLB 导出。
- 新增展示预设 `灌木 · 开花宽丛`（`shrub-flower`），右侧面板顶部新增「花朵装饰（最外层）」，所有树种均可一键启用。
- 验证：`npm test` 126/126 通过（新增 `tests/flowers.test.ts` 3 项：最外层验证、尺寸跟随叶面比例验证、全树种/裸枝/LOD/JSON 往返），`npm run build` 通过，浏览器零报错；截图见 `evidence/flowers/`。

## 2026-11-19 新增独立花丛模板（flowerbed：有植物杆 / 纯花版本）
- 新建独立生成器 `src/tree/flowerbed.ts` + 单朵雏菊占位贴图 `textures/flower_single_placeholder.png`（12 瓣纯白雏菊 + 暖金花心，方便自由染色成金黄、珊瑚红、浅粉、天蓝等风格化草地花丛）。
- 新增树种分类「花丛模板」与两个预设：
  - `花丛 · 有植物杆`（`flowerbed-stemmed`，默认 1,456 面）：弯曲绿色植物杆 + 底部/中段双面风格化绿色茎叶（合批为 1 个木质网格）+ 顶部单朵花面片，共 2 个几何体；支持自由切换花瓣主色、暗部色、茎叶色、花茎粗细/弯曲/茎叶数。
  - `花丛 · 纯花版本`（`flowerbed-pure`，默认 68 面，仅 1 个花朵网格）：无植物杆与茎叶，仅生成自然错落、沿半球微外倾的单朵花面片，适合直接撒布在现有草地或地形表面。
- 面板支持「显示植物杆」一键切换带杆/纯花模式，同时完整兼容「编辑树冠」（拖控制点改高低起伏、裸枝区挖空）、「面数优化 · LOD」（1,456 → 210 面）、自定义单花 Alpha 贴图与图集、JSON 读写和 GLB 导出。
- 验证：`npm test` 137/137 通过（`tests/flowers.test.ts` 新增 3 项 + 全预设/LOD 覆盖），`npm run build` 通过；Chrome Playwright 实测零报错，GLB 导出正常；截图见 `evidence/flowerbed/`。

## 2026-11-19 新增 AI 模式（空白工程 · 丢图自动生成全参数植物）
- 新增独立空白工程入口 `ai.html`（经典工作台顶部栏新增 `✦ AI 模式` 入口，`vite.config.ts` 已纳入构建）：打开为空白 3D 画布，直接把任意植物图片拖入/上传即可调用全部底层参数算法生成对应的可编辑三维植物。
- **核心架构与全部暴露能力**（`src/ai/scene.ts`、`src/ai/main.ts`、`src/ai/ai.css`）：
  - 支持多部件组合场景 `AiSceneSpec`（单植物 JSON 也可直接兼容导入），每个部件完整暴露 6 大植物生成器（阔叶/针叶/棕榈/草丛/蕨类/花丛）、全部参数面板、LOD 面数优化、外层花朵装饰、自定义贴图槽、叶面贴图源切换（含自由染色中性草叶 `grassTint` 与花簇 `flower`）、部件位姿（位置/旋转/缩放）、选中部件「编辑树冠」控制点与裸枝区。
  - 提供「AI 能力 Schema & JSON 接口」抽屉：一键复制全部参数能力 Schema、直接粘贴/编辑场景 JSON、可选接入兼容 OpenAI 的视觉大模型，同时暴露 `window.__aiStudio` 编程接口。
  - 底层增强（向后兼容）：`TrunkSpec` 新增 `barkColor`（自定义树皮基色）与 `leanAngle`（可控树干倾角方向），`textures.ts` 新增中性可染色草叶 `makeNeutralGrassTexture`。
- **内置零依赖图像解析与参数合成引擎**（`src/ai/analyze.ts`）：自动去背景与封闭空腔剔除、木质/叶面/根部草地语义分割、花瓣冠层/绿叶/秋叶与点缀花朵色系提取、树种结构分类、多冠分干拆解（主干 + 卫星分干与副冠）、树干弯曲/倾斜与非对称树冠 `CrownHandle` 轮廓拟合。
- **实测验证**：`npm test` 143/143 通过（新增 `tests/ai-mode.test.ts` 6 项），`npm run build` 通过；Chrome Playwright 实测上传用户多干樱花盆景参考图：空白工程启动 → 64 ms 自动拆解出 5 个可调部件（主干与主冠 + 左侧分干与副冠 + 右侧分干与副冠 + 粉色根部草丛基底 + 根部点缀小花，40,692 面 / LOD 可压至 23,986 面，GLB 导出 1.76 MB），控制台零报错；对比与界面截图见 `evidence/ai-mode/`。

## 2026-11-19 分阶段审美与算法升级（阶段 A + B + C-1 全部自验通过）
- **阶段 A（风格化光影透光着色器 + 氛围灯光）**：
  - `src/broadleaf/leaf-material.ts`：注入次表面背光透光（SSS）、暗部冷暖色相偏移（自动从 `tintInner` 推导冷青/柔紫阴影，拒绝灰暗发脏）、受光边缘轮廓光、三段垂直受光暖色阶，以及可选柔化叶卡自阴影（保留投射到树干与地面的阴影，消除交叉卡片间的黑色三角噪点）；导出 GLB 保持标准 PBR 兼容。
  - `src/viewport.ts`：开启 `ACESFilmicToneMapping`，去掉原先污染粉/红/蓝植物的偏绿底光，新增 4 套氛围光预设（`清透画室` / `暖阳吉卜力` / `樱花柔光` / `森林冷影`），经典工作台与 AI 模式顶部均可随时切换（AI 模式按图像风格自动匹配）。
  - `src/tree/spec.ts` & `panel.ts`：新增 `ShadingSpec` 并在面板暴露「风格化光影 · 质感」参数组。
- **阶段 B（造型与构图美学重构）**：
  - `src/tree/skeleton.ts` & `assemble.ts`：新增 `crown.canopyLift`（底冠露枝负空间，清晰托出下方暗色分叉主枝）、`crown.padFlatten`（大中小错落云片冠层并收敛刺出冠外的细梢）、`trunk.gnarl`（非对称生长拐点与木节隆起）。
  - `src/tree/wood.ts`：新增 `trunk.surfaceRoots`（从根部膨大处沿 `y >= 0` 贴地爬出的苍劲露根）。
  - `src/tree/flowers.ts`：新增 `buildAmbientPetals`（`shading.petals`，轻量 4 面微弯飘落花瓣/叶屑）。
- **阶段 C-1（AI 模式真实树干样条复刻）**：
  - `src/tree/spec.ts` & `skeleton.ts`：新增 `trunk.spine?: XYZ[]` 自定义三维中心线样条支持（与全树高度/分叉高度滑块联动缩放，支持一键切回参数化树干）。
  - `src/ai/analyze.ts`：新增 2D Chamfer 距离变换 + **自顶向下中轴脊线追踪器**（`extractTrunkSpine`），从每组树冠底部的独立入冠点向下追踪真实木质中轴脊线至根部，避免多干根部混粘，直接 1:1 复刻每根主干与分干的弯曲弧度。
- **验证**：`npm test` **8 个测试文件 / 145 项全部通过**（`tests/ai-mode.test.ts` 新增 Stage B 与 Stage C-1 回归测试），`npm run build` 退出码 `0`；三阶段 Chrome Playwright 实测均零报错、零 Shader 警告；樱花图最终生成 5 部件 / 3 条真树干样条复刻（59 ms，39,409 面，GLB 2.46 MB），全阶段验收截图见 `evidence/aesthetic-abc1/`。

## 2026-11-19 C-2 多叶型贴图库 + 樱花成品入驻 + 抠图修补画笔 + 全场景 LOD + 微风动画
- **多叶型程序贴图库与自动匹配**（`src/tree/textures.ts`、`spec.ts`、`assemble.ts`、`ai/analyze.ts`）：
  - 新增 4 套 512×512 风格化叶型 Alpha 贴图（同步导出至 `textures/`）：缺口 5 瓣樱花柔瓣簇（`sakura`）、吉卜力厚涂圆云叶（`cloud`）、日式五角红枫簇（`maple`）、垂柳细长丝（`willow`），在面板「阔叶内置叶型」与 AI 模式「叶面贴图源」中均可自由切换（切换时自动匹配协调色板）。
  - AI 图像解析器新增 C-2 自动叶型匹配（同时修正红橙秋枫与粉白樱花的色相边界），支持 `sakura` / `maple` / `willow` / `cloud` / `default` 自动选型。
- **樱花成品案例与新品种预设入驻**：
  - 经典工作台（`broadleaf.html`）新增 3 个高完成度预设：`樱花 · 盆景古树`（`broadleaf-sakura`）、`红枫 · 绯秋`（`broadleaf-maple`）、`垂柳 · 轻丝`（`broadleaf-willow`）。
  - AI 模式（`ai.html`）新建 `src/ai/showcase.ts`，在空白欢迎页与顶部栏提供 **「✿ 樱花盆景案例」** 一键加载实测成品（5 个独立可调部件、3 条真树干样条、贴地盘根、缺口樱花柔瓣簇、粉色草地与落瓣，亦支持 `?showcase=sakura` 直达）。
- **复杂实景抠图画笔 + 全场景一键 LOD + 实时微风动画**：
  - `src/ai/analyze.ts` 新增 `computeScribbleMask`（色板聚类 + 空间约束快速 GrabCut-lite），AI 模式参考图卡片新增 **「✎ 抠图画笔」** 弹窗（绿笔保留植物、红笔擦除杂乱背景、实时叠加预览并一键重生成 3D）。
  - AI 模式部件栏新增 **「全场景一键减面 · LOD」**（5 部件樱花盆景实测 43,937 → 10,150 标准游戏 −77% → 5,446 手游轻量 −88%，GLB 导出 2.81 MB）。
  - `leaf-material.ts` + `viewport.ts` 新增全局柔和微风顶点动画与顶栏 **「🍃 微风」** 开关（经典工作台与 AI 模式共用）；`wood.ts` 进一步增强贴地露根延伸与盘根扭转。
- **最终验收**：`npm test` **8 个测试文件 / 158 项全部通过**，`npm run build` 退出码 `0`；Chrome Playwright 全流程实测零控制台错误、零 Shader/WebGL 警告；全套验收截图见 `evidence/final-c2/`。
- **Alpha 细白边修复**：`leaf-material.ts` 关闭易在亮背景重叠叶卡边缘产生白边的 `alphaToCoverage`，并新增 `dilateAlphaCanvas`（6 轮不透明内色外扩，对全部内置贴图及用户上传 PNG/WebP 同步生效），同时柔化樱花/花朵/枫叶贴图外缘高反差并提高裁切阈值至 `0.42–0.46`；特写对比见 `evidence/final-c2/halo_fix_comparison.png`。

## 2026-11-19 技术审查第 1 批落地（P0 缺陷修复 + GLB 导出瘦身）
- **P0-1 & P0-2（`src/studio/editor.ts`、`src/ai/main.ts`）**：
  - `syncEditorTransform()` 同步完整位姿（`position` + `rotationY` + `scale`）；`CrownEditor` 的 `onDown`/`onMove`/`screenPosition` 统一进行 `worldToLocal` / `localToWorld` 坐标变换，修复 AI 模式非原点/旋转/缩放部件的树冠控制点错位与跳变；快捷键 `Delete/Backspace` 增加对 `TEXTAREA`/`SELECT` 的屏蔽。
  - `CrownEditor` 改为复用 6 个静态辅助材质与 2 个单位球几何体（消除 `refresh()` 60 Hz 拖拽时的 WebGL 材质泄漏）并补全 `dispose()` 资源与事件监听清理。
- **P0-3 & P0-4（`src/ai/main.ts`）**：
  - AI 模式上传自定义贴图后自动同步切回当前部件的 `shading.leafStyle = 'default'` 与对应 `leafTexture` 槽位，避免被内置叶型/覆写槽静默屏蔽。
  - 部件列表渲染对 `part.label` / `id` / `kind` 做 `escapeHtml()` 转义，消除导入外部 JSON/LLM 响应的 HTML 注入与 DOM 破坏风险。
- **P1-2（`src/export-glb.ts`、`tests/export-glb.test.ts`）**：
  - 新增只读导出预处理 `prepareGlbScene()`：剥离预览专用属性（`leafCenter`、`leafCorner`、`shadeWeight`）与材质 `leafUniforms`；将线性顶点色 `COLOR_0` 无损量化为核心 glTF 2.0 归一化 `UNSIGNED_SHORT`（误差 `< 1e-4`）；按 PBR 签名合并跨部件重复材质；省略多部件场景子节点的重复 `userData.spec`。
- **实测验证**：`npm test` **9 个测试文件 / 161 项全部通过**，`npm run build` 退出码 `0`；Chrome Playwright 实测：AI 偏移旋转缩放副干手柄真实鼠标拖拽屏幕误差 `0.0 px`、25 次 `refresh()` 零新增材质、`part.label` XSS 零触发、自定义叶贴图自动生效、经典工作台手柄拖拽无回归（`minX: -2.59 → -3.266`）、单樱花 GLB `1.50 → 1.09 MB`（`−27.3%`）、5 部件樱花 GLB `2.70 → 2.03 MB`（`−24.9%`，材质 `12 → 6`）且 `GLTFLoader` 往返解析三角面 100% 一致，零控制台报错；截图见 `evidence/batch1_verify.png`。

## 2026-11-19 技术审查第 2 批落地（交互性能直通 + 贴图懒加载 + BFS 扩边加速 + 共享贴图槽）
- **P1-3 & P2-1（`src/broadleaf/leaf-material.ts`、`src/studio/texture-slots.ts`、`src/studio/main.ts`、`src/ai/main.ts`）**：
  - `dilateAlphaCanvas` 改为边界波前多源 BFS（`dilateAlphaRgba`，单测验证与原 6 轮全图算法逐字节 100% 一致）：512×512 扩边 `16.4 → 6.5 ms`（2.5×），2048×2048 实测仅 `26.6 ms`，全部 13 张贴图总耗时 `188.4 → 75.6 ms`。
  - 新增共享模块 `src/studio/texture-slots.ts`（`createTextureRegistry` + `bindTextureSlots`），两端共用贴图上传、旧贴图释放、恢复默认与可见区缩略图按需绘制；`ai/scene.ts` `texturesForPart` 改用 `Object.create(base)` + `Object.defineProperty` 保持懒加载不被展开触发。
- **P1-1（`src/studio/panel.ts`、`src/tree/assemble.ts`、`src/ai/scene.ts`、`src/studio/main.ts`、`src/ai/main.ts`）**：
  - `panel.ts` 区分 `oninput`（`final=false` 走自适应节流并同步配对数值框）与 `onchange`（`final=true` 落盘提交）。
  - `assemble.ts` 新增 `applyLiveParam`：纯材质/Shader 参数（`translucency`、`rimLight`、`shadowShift`、`topWarmth`、`softSelfShadow`、`alphaCutoff`、`cameraFacing`）直接热更新 GPU Uniform / `alphaTest`，`0 ms` 重建。
  - `ai/scene.ts` 新增 `updatePartTransform`（位姿改写零重建）、`applyPartLiveParam`、`rebuildPart`（单部件增量替换与统计累加）；`ai/main.ts` JSON 文本框改为折叠时不序列化、展开时惰性刷新。
  - `studio/main.ts` 开启 LOD 后拖动非 LOD 滑块跳过同步高模基准重算，松手（或短防抖后）精确结算对比百分比。
- **实测验证**：`npm test` **10 个测试文件 / 165 项全部通过**（新增 `tests/batch2-perf.test.ts` 4 项），`npm run build` 退出码 `0`；Chrome Playwright 实测（零控制台错误，批次 1 全项复测无回归）：
  - 空白 `ai.html` 启动贴图 `13 → 0` 张，`loadEventEnd` `450 → 146 ms`（3.1×）；`broadleaf.html?preset=broadleaf-round` 首屏仅加载 `['leaf']`（1/12 张）；5 部件樱花案例仅加载 4 张。
  - 5 部件樱花案例位姿调整 `52 → 0.1 ms`（0 重建）、3 项 Shader/Alpha 滑块连调 `~156 → 0.4 ms`（0 重建）、单部件草丛增量重建 `52 → 1 ms`（`fullBuildsDelta=0, partBuildsDelta=1`）；经典页 LOD 拖动防抖基准结算正常；截图见 `evidence/batch2_ai_verify.png`、`evidence/batch2_classic_verify.png`。

## 2026-11-19 垂柳叶子算法专项修复（零影响其他树种）+ Windows 启动脚本升级
- **启动脚本**（`start.cmd`）：升级为 UTF-8 无 BOM + CRLF，双击直接启动经典工作台 `/broadleaf.html`，支持 `ai` / `sakura` / `broadleaf` / `legacy` / `v1` 模式及可选端口（默认优先 `5869`，占用自动分配空闲端口）。
- **垂柳独立「垂帘下挂」算法**（`src/broadleaf/leaves.ts`、`src/tree/textures.ts`、`src/tree/spec.ts`、`src/tree/assemble.ts`、`src/studio/main.ts`、`src/ai/analyze.ts`）：
  - 新增严格隔离的 `cardType: 'drape'`（`buildDrapeCurtains`）：挂点沿外拱主枝、细枝梢端与团块上半球分布，每束生成 `~71°` 交错双垂帘，顶部柔和拱肩过渡、严格沿 `-Y` 垂直下垂、外圈长内圈短自然分层、尾梢距地钳制 `>= 0.08 m` 不穿地，并自动关闭 `cameraFacing`；非 `'drape'` 的全部其他树种与预设代码路径零改动。
  - 重绘 `makeWillowTexture(512)`（同步更新 `textures/willow_strands_placeholder.png`）：图顶 `v=1` 为拱形挂点、图底 `v=0` 为纤细柳梢，5 缕自然错落的弯拱细长柳叶消除平齐顶边与远景碎点噪点；更新 `broadleaf-willow` 预设与 AI 垂柳分支。
  - 验证：`npm test` **10 个测试文件 / 166 项全部通过**（`tests/plants.test.ts` 新增垂柳每束严格向下、离地与法线回归测试），`npm run build` 退出码 `0`；Chrome Playwright 实测零报错：垂柳高模 497 束 / 17,722 面，标准游戏 LOD 5,022 面（−72%），樱花/阔叶等其他预设面数与结构 100% 无变化；截图见 `evidence/willow-fix/`。

## 2026-11-19 实体 3D 草叶建模系统（移植用户 Blender Grass Blade Generator）
- **核心算法**（`src/tree/ground.ts`、`src/tree/spec.ts`、`src/tree/assemble.ts`、`src/broadleaf/leaf-material.ts`、`src/studio/panel.ts`、`src/studio/main.ts`）：
  - 在 `GroundSpec` 新增 `mode: 'blade' | 'card'`（草丛默认 `'blade'` 实体建模草叶；`'card'` 保留兼容旧贴图模式、蕨类与 AI 樱花根部粉草基底）。
  - 完整移植用户 Blender 脚本的数学模型至 Y-up：`bladeProfileWidth(t, fullness)` 根窄中饱尖锐轮廓、黄金角放射分布与外圈渐增外张角、三次方 `lean + arch(bend) + droop` 弯垂骨架、横截面抛物拱度 `cup` + 横向分段 `across`、轴向扭转 `twist`、偏转旋向 `sideSwirl`、三色深浅层次 `colorTones`，并接入 `CrownEnvelope` 树冠编辑/裸枝区、风格化 SSS/微风着色器（支持无贴图实体 PBR 材质 `stylized-blade-v3`）与四档单调 LOD。
  - 修复曲面平滑法线与 `spherize` 混合时的中段翻向硬边（对齐 `envN` 至 `nTmp` 保持整叶法线连续）。
  - 新增并更新 4 套低矮植物草丛预设：`草丛 · 宽叶放射`（`grass-clump`，308 面，17 KB 纯几何 GLB）、`草丛 · 尖长弯叶`（`grass-narrow`，480 面）、`草丛 · 密集窄叶`（`grass-dense`，1,144 面）、`高草 · 芦苇丛`（`grass-tall`，1,536 面）。
  - 面板完整暴露全部实体草叶参数，上传自定义草贴图时自动切至 `'card'` 模式；蕨类与全部其他树种零影响。
- **验证**：`npm test` **10 个测试文件 / 175 项全部通过**（`tests/plants.test.ts`、`tests/optimize.test.ts`、`tests/tree-v2.test.ts` 同步覆盖 4 套预设、无贴图验证、`blade/card` 切换、单位法线与 LOD 单调性），`npm run build` 退出码 `0`；Chrome Playwright 实机多角度渲染与 GLB 验证零报错（`grass-clump` GLB 17.0 KB、0 张嵌入图、0 贴图懒加载），截图见 `evidence/grass-blades/`。

## 2026-11-20 可视化预设库与悬停实时 3D 预览（经典工作台 + AI 模式共用）
- **实时预览保存 + 右侧非模态预设库**（`src/studio/preset-store.ts`、`src/studio/preset-library.ts`、`src/studio/presets.css`、`src/studio/main.ts`、`src/ai/main.ts`）：
  - 顶栏新增 **「★ 保存预设」** 与 **「预设库」** 按钮（AI 模式空白工程卡片也提供「★ 打开我的预设库」入口）；展开时右侧平滑停靠替换检视器列，**零遮挡** 3D 画布与视口工具栏，左侧视口自动居中。
  - **实时 3D 封面截取**：打开面板/切换品种/调节参数自动刷新 320×220 实时 3D 封面缩略图（自动隐藏编辑控制点），左侧旋转好角度后也可点「🔄 刷新封面」随时重拍；支持保存为新预设、一键「覆盖当前预设」/ 任意卡片「更新」、行内「改名」、防误触二次确认「删除」、搜索、预设合集导入/导出。
  - **悬停实时 3D 预览**（默认开启，可开关）：鼠标移入预设卡片（85 ms 防抖）自动快照当前工作模型并在左侧 3D 视口直接实时渲染该预设与对应灯光氛围；移开鼠标无缝还原正在编辑的模型，单击即永久应用。
  - **经典工作台联动**：已保存的单植物预设自动同步到右侧 `#preset` 下拉菜单顶部的 `★ 我的预设` 分组，且「重置当前预设」在选中自定义预设时自动还原至该预设状态。
- **双通道本地持久化**（`scripts/presets-plugin.mjs`、`scripts/presets-plugin.d.mts`、`vite.config.ts`）：
  - Vite dev/preview 中间件提供 `/api/presets`（GET/PUT），原子写入项目目录下 `<project>/user-presets/presets.json`（跨端口、换浏览器、清缓存不丢失），同时镜像缓存到 `localStorage`，静态离线部署时自动回退至 `localStorage`。
- **验证**：`npm test` **12 个测试文件 / 180 项全部通过**（新增 `tests/presets.test.ts` 4 项与 `tests/presets-plugin.test.mjs` 1 项），`npm run build` 退出码 `0`；Chrome Playwright 实测双端（`broadleaf.html` 与 `ai.html`）保存带缩略图预设、刷新封面、悬停实时 3D 预览与移开还原、单击应用、覆盖更新、行内改名、整页刷新落盘复原、二次确认删除及双作用域共享落盘全流程，零控制台/页面报错；截图见 `evidence/presets/`。

## 2026-11-20 可扩展 AI 案例库 + 新增「盘曲古樱」（`sakura-twist`）
- **可扩展内置 AI 案例库**（`src/ai/showcase.ts`、`src/studio/preset-library.ts`、`src/studio/presets.css`、`src/ai/main.ts`、`public/showcases/*.jpg`）：
  - `src/ai/showcase.ts` 升级为结构化案例注册表 `aiShowcases` + `getAiShowcase(id)`，以后每次制作的 AI 模板树均永久沉淀入库（支持 `?showcase=<id>` 直达、`window.__aiStudio.showcases()` 与 `loadShowcase(id)`）。
  - AI 模式顶栏新增 **「✿ 案例库」** 入口（带数量徽章），右侧面板升级为双标签（**`✿ 案例库`** | **`★ 我的预设`**）；空白欢迎页同步生成各案例快捷按钮。案例卡片附带真实 3D 封面图，支持与我的预设一致的 **悬停实时 3D 预览 / 单击载入全参数编辑 / 一键 `★ 收藏` 到我的预设**。
- **新增案例「盘曲古樱」**（`twistedSakuraShowcase`，`id: 'sakura-twist'`，6 部件全可调）：
  - 紫褐扭棱 S 形盘曲主干（自定义 9 点平滑样条 + 6 条贴地盘根 + 顶冠露枝负空间）+ 右侧悬弧大枝与分层樱花云（与主干形成通透拱窗留白）+ 左上长拱花枝云团 + 左下肘部探出小花枝 + 两处实体 3D 嫩绿根草（`mode: 'blade'`）与飘落花瓣。
  - 全场景实测 52,464 面（92 ms 生成），全场景一键 LOD 可压至 6,938 面（−87%）；封面缩略图已落盘至 `public/showcases/sakura-twist.jpg` 与 `public/showcases/sakura.jpg`。
- **验证**：`npm test` **12 个测试文件 / 181 项全部通过**（`tests/ai-mode.test.ts` 新增案例库与 `盘曲古樱` 6 部件 / 4 样条 / 实体草 / LOD / JSON 往返测试），`npm run build` 退出码 `0`；Chrome Playwright 多角度实机渲染（正面 / 骨架 / 45° / 侧面）、案例库悬停实时 3D 预览、全场景 LOD 与既有预设库全项回归均零报错；截图见 `evidence/showcase-sakura-twist/`。

## 2026-11-20 树干几何算法修复 + 树皮贴图导入 + 全材质 3D 程序化（无 UV 平铺）
- **树干与分叉几何修复**（`src/tree/wood.ts`、`src/tree/skeleton.ts`）：
  - **彻底消除子枝根环穿出父干对侧壁与空心管口锯齿**：取消原 `pts[0]` 沿枝条反推 `-0.7*parentR` 配 `1.35×` 膨大枝领的做法；改为沿父干向下切线内缩 `<=0.34*parentR` 生成闭口锥形内埋根塞（半径严格 `<=0.46*parentR`），严格限制主枝/子枝根径 `<=0.76*parentR`，在穿出父干表皮处形成柔和枝领（`+15%`，上限 `0.84*parentR`）并烘焙微暗分叉 AO。
  - **平滑树干顶端与分叉过渡**：阔叶主干增至 22 采样点、主枝出射切线与父干切线平滑融合，粗顶主干追加 3 环余弦半球封顶圆穹（消除平切烟囱口）；新增基于离散曲率向量的内弯抗折叠钳制，消除大曲率 S 弯内侧环面交叉折痕。
- **全材质 3D 程序化（不走正常 UV 平铺）与树皮贴图导入**（`src/tree/bark-material.ts`、`src/broadleaf/leaf-material.ts`、`src/tree/assemble.ts`、`src/studio/texture-slots.ts`、`src/studio/panel.ts`、`src/export-glb.ts`）：
  - 新建 `makeBarkMaterial`（树干/主枝/细枝/棕榈干共用，木质网格零 UV 平铺）：默认采用纯 GPU 3D 对象空间域扭曲 fBM 竖向树皮纹理 + 细微樱木皮孔 + 屏幕空间偏导凹凸法线（`dFdx`/`dFdy`）与程序化粗糙度。
  - 新增「树干材质 · 程序化贴图」面板与 `'bark'` 贴图槽（经典工作台与 AI 模式共用，保持懒加载不增首屏开销）：导入任意 PNG/JPG/WebP 树皮图片后，通过 **3D 对象空间三平面投影 + Voronoi 随机防重复抗平铺采样（`textureGrad` + 双频混合 + 域扭曲）** 映射到全树枝干，零 UV 接缝、零粗细拉伸、零壁纸平铺重复，并自动提取亮度凹凸法线；提供 `trunk.barkScale`（纹理密度）、`trunk.barkDetail`（凹凸与肌理强度）、`trunk.barkTint`（树皮色融合）三项 **0 ms 零重建 GPU 实时滑块**。
  - `makeStemMaterial`（花茎）、`makePetalMaterial`（落瓣）与 `makeLeafMaterial`（叶卡与实体 3D 草叶）同步接入对象空间 3D 程序化色阶/纤维/粗糙度调制；`export-glb.ts` 导出时清理预览用 Uniform 并在含自定义树皮贴图时为外部 PBR 查看器自动补齐兼容三平面 UV。
- **验证**：`npm test` **13 个测试文件 / 184 项全部通过**（新增 `tests/wood-procedural.test.ts` 3 项：全树种半径收敛/圆顶/单位法线、纯程序化/导入三平面/0 ms 滑块/GLB 导出、花茎落瓣与懒加载），`npm run build` 退出码 `0`；Chrome Playwright 对红圈分叉区域原位特写复核（纯程序化与导入非无缝树皮图双测）、经典工作台/棕榈/实体草/花丛全品类实测均零控制台错误、零 Shader 警告；截图见 `evidence/wood-procedural/`。
- **AI 模式「面数优化 · LOD」整树同步升级**（`src/ai/scene.ts`、`src/ai/main.ts`、`src/ai/ai.css`）：新增全场景二分目标预算求解 `solveSceneForTriangleBudget`，AI 模式「面数优化 · LOD」面板默认作用范围切换为 **「整棵树（全部部件）」**（四档预设、目标面数自动优化、五项细调滑块/复选框均联动全树所有部件），同时保留顶部切换按钮「仅当前部件」供单部件精调；Chrome Playwright 实测 `盘曲古樱`（6 部件 58,326 面）自动求解 8,000 面预算直达 `7,918` 面、3,000 面压至 `4,064` 面（−93%），零报错；截图见 `evidence/whole-tree-lod/ai_whole_tree_lod.png`。

## 2026-11-20 导出 GLB 三项可选功能 + 案例库新增「繁花绿灌木丛」
- **导出 GLB 选项弹窗与底层合批/过滤**（`src/export-glb.ts`、`src/studio/glb-export-ui.ts`、`src/studio/presets.css`、`src/studio/main.ts`、`src/ai/main.ts`）：
  - 经典工作台与 AI 模式点击「导出 GLB」均弹出带实时统计预览的设置面板，提供 3 个勾选选项：
    1. **整体合并导出（材质分明，默认）**：烘焙所有部件与子网格变换并合并为 **1 个单网格多材质对象**，自动按语义分离命名材质槽（如 `Mat_Tree_Bark`、`Mat_Foliage_Sakura`、`Mat_Foliage_Bush`、`Mat_Flowers_Wild_Rose`、`Mat_Grass`、`Mat_Other_*`），导入 Blender / Unity / UE 材质槽清晰独立。
    2. **不合并**：保留原始独立多部件与子网格层级结构（与选项 1 互斥切换）。
    3. **去除装饰类网格体**：一键剔除树下根部草丛/花丛、石头、飘落花瓣与粒子等非主体装饰网格（独立草丛/花灌木主场景仅剔除粒子/落瓣/石头，防止误清空主体）。
- **新增 AI 案例库作品「繁花绿灌木丛」**（`floweringBushShowcase`，`id: 'flowering-bush'`，4 部件全可调）：
  - 新增两套 512×512 风格化程序贴图：`makeBushSprigTexture`（`bush` 翠绿尖叶灌木枝簇，3 层错落尖叶带暗绿叠影，避免星形粘连）与 `makeWildRoseTexture`（`wildrose` 独立五瓣纯白野蔷薇，栗棕金蕊）；经典工作台「阔叶内置叶型 / 内置花型」与 AI 模式贴图源同步开放。
  - 4 组阶梯高低灌木丘（主冠左丘 + 主冠右丘 + 左右低蓬肩丘）贴地无缝拼接，顶亮黄绿 → 中翠绿 → 底墨绿青影，表层点缀 205 朵微碗形五瓣白野蔷薇（零侧视发虚、无粗棕树干露出）；封面图已落盘至 `public/showcases/flowering-bush.jpg`。
- **验证**：`npm test` **13 个测试文件 / 185 项全部通过**（`tests/export-glb.test.ts` 新增 3 项 GLB 选项 + 二进制 glTF JSON 单网格多材质槽断言，`tests/ai-mode.test.ts` 新增繁花绿灌木丛测试），`npm run build` 退出码 `0`；Chrome Playwright 实测下载并解析真实 `.glb` 文件（`盘曲古樱` 合并去装饰 1 网格 2 材质槽 / 不合并 18 网格；`繁花绿灌木丛` 合并 1 网格 3 材质槽；经典工作台去落瓣装饰），零控制台错误；截图见 `evidence/glb-and-bush/`。

## 2026-11-20 SpeedTree 风格枝干节点编辑模式（经典工作台 + AI 模式共用）
- **非破坏性枝干节点覆盖引擎**（`src/tree/spec.ts`、`src/tree/skeleton.ts`、`src/tree/wood.ts`、`src/tree/assemble.ts`、`src/tree/fronds.ts`）：
  - `TreeSpec` 新增可序列化的 `branchEdits?: BranchEdit[]`（支持 JSON 与可视化预设库完整往返）：单枝 `lengthScale`（长度）、`radiusScale`（粗细）、`pitchDelta`（仰角）、`yawDelta`（水平旋转）、`gravityDelta`（弯曲/重力）、`spineOffsets`（4 点 3D 样条手绘塑形）、`bare`（单枝去叶）、`pruned`（级联修剪，树干受保护）。
  - 在 `buildSkeleton` 中按拓扑父→子顺序应用：编辑主干或一级主枝时，所有附属子枝自动沿父枝挂点位移与切线旋转跟随（零悬空脱离），阔叶/针叶/棕榈全兼容，并同步防止外拉延长枝条的叶片被旧静态包络误裁切；修复 `buildWood` 按 `branch.id` 索引父枝（避免修剪后索引错位）并导出精确单枝面数计算 `estimateBranchTriangles`。
- **SpeedTree 风格三维视口交互与弧形 Gizmo**（`src/studio/editor.ts`、`src/studio/editor-ui.ts`、`src/studio/studio.css`、`src/viewport.ts`、`src/studio/main.ts`、`src/ai/main.ts`）：
  - 点击顶部「✎ 节点编辑」默认进入 **「❖ 枝干节点」**（SpeedTree 模式，去掉旧版杂乱悬浮橙球与密绿色网格球），同时保留并清爽升级 **「◎ 树冠塑形」** 标签页（草/花/蕨自动切至树冠塑形）。
  - 支持在 3D 视口直接点选任意树干、一级主枝、二级侧枝或枯枝（AI 模式支持跨部件点选直切对应部件）；选中后高亮 3D 枝干中心线、柔光包络管与 4 个可拖拽 3D 样条曲线白点，并在枝干节点处锁定 **SpeedTree 标志性同心白弧 + 金色「长度 (绝对量)」红箭头操控柄**（随相机 60fps 同步与枝干切线对齐，悬停/拖拽亮金并弹出暗色实时参数浮标）。
  - 左上角新增 SpeedTree 风格深色 **「多边形 - 已选」HUD**（精确显示单枝 `tris`、节点层级、长度/粗细与骨骼子枝数），配双向联动微调滑块、`🍃 去叶/恢复长叶`、`✂ 修剪 (Delete)`、`↩ 撤销 (Ctrl+Z，30 步历史)` 与骨架参考线开关。
- **验证**：`npm test` **14 个测试文件 / 195 项全部通过**（新增 `tests/node-edit.test.ts` 10 项：父子联动不脱离、长度/仰角/旋转/重力/粗细/4点样条、级联修剪、阔叶与针叶单枝去叶、棕榈树干编辑、单枝精确面数一致与 JSON 往返），`npm run build` 退出码 `0`；Chrome Playwright 实测（`broadleaf.html` 红枫/舒展阔叶骨架 + `ai.html` 盘曲古樱）：真实鼠标 3D 点选主枝、拖拽金色长度柄（`1.58×`）、白色仰角弯弧（`+21.6°`）、3D 样条节点（红枫与盘曲古樱）、单枝去叶（`1993→1592`）、修剪（`29→24`）与键盘 `Ctrl+Z` 撤销还原（`24→29`）全部通过，零控制台/页面错误；截图见 `evidence/speedtree-edit/`。

## 2026-11-20 AI 多部件资产默认全参数整体同步 + 编辑模式解锁单体独立调整
- **整体同步引擎（默认）与单体隔离模式**（`src/ai/scene.ts`、`src/ai/main.ts`、`src/ai/ai.css`、`src/studio/texture-slots.ts`、`src/studio/editor.ts`、`src/studio/editor-ui.ts`）：
  - 默认非编辑状态下进入 **`🌐 整体同步`** 模式：所有颜色（叶片内外色调、花朵色调、树皮色调）、材质与贴图（`barkScale`/`barkDetail`/`barkTint`、叶面贴图源、自定义上传贴图、`shading.leafStyle` 自动清空旧贴图覆写并联动叶型色板）、光影（SSS/轮廓光/暗部色偏/暖阳/落瓣防重复）、花朵、LOD 减面、种子与整体缩放全部同步到整体；尺寸/密度类参数（`height`/`width`/`leafSize`/`flowers.count` 等）按各部件原有比例缩放，角度/偏移类参数按同增量偏移，完整保留多部件层次比例。
  - 开启 **「✎ 节点编辑」**（或点击图层行 `✎` / 顶部「✎ 单体编辑」）后解锁 **「✎ 单体调整」** 模式：自动展开单体专属名称、算法类型与独立位姿（X/Y/Z/旋转/复制），支持在 3D 视口直接点击任意枝干或树冠/灌木丘网格切换单体（SpeedTree HUD 同步显示部件名），并支持**单部件独立颜色、独立参数、独立 LOD 与独立自定义上传贴图覆写**（`PartCustomTextures`，不影响同株其他部件）；退出编辑模式自动回到整体同步模式。
- **验证**：`npm test` **14 个测试文件 / 196 项全部通过**（`tests/ai-mode.test.ts` 新增整体同步/比例缩放/混类隔离/单体隔离/单部件自定义贴图覆写回归测试），`npm run build` 退出码 `0`；Chrome Playwright 实测 `繁花绿灌木丛`（默认调红 4 丘全红 → 进编辑模式 3D 点击右丘单独改绿叶粉花，其余 3 丘保持深红）与 `盘曲古樱`（默认秋金+银灰树干 4 枝干同步而根草保持嫩绿 → 进编辑模式单独将右侧悬弧大枝改粉樱），零控制台/页面错误；截图见 `evidence/whole-vs-single/`。

## 2026-11-20 节点编辑后叶面发黑 / 树冠包络与法线同步修复
- **根因定位与四处同步修复**（`src/tree/envelope.ts`、`src/tree/skeleton.ts`、`src/tree/assemble.ts`、`src/broadleaf/leaves.ts`、`src/broadleaf/leaf-material.ts`、`src/studio/editor.ts`、`src/studio/main.ts`、`src/ai/main.ts`）：
  1. **编辑后动态重拟合 `CrownEnvelope`**：`buildSkeleton` 在应用 `branchEdits` 后按新枝干包围盒重算 `envelope`（`axis` / `y0` / `y1` / `width`），使阔叶 `canopyLift`、松针、棕榈、外层花朵、落瓣与树冠塑形笼线均跟随编辑后的枝干移动，不再滞留在编辑前原点。
  2. **阔叶 AO / 外层色改用实时拟合包络 + 局域叶团表层曝光**：`assemble.ts` 在存在节点几何编辑时不再把旧 `env.rho` 覆盖进 `generateLeafCards`，改用 `leaves.ts` 实时拟合的 `fittedEnv`；`buildCardGeometry` 结合局域叶团表层距离（`minClumpR`）与 `occlusion >= 0.44` 保底，消除非对称/弯干树冠外凸叶团被误判为内层深阴影发黑的问题。
  3. **消除分团凹缝法线反折**：`envelopeNormal(..., 'clumps')` 剔除与树冠外法线反向的凹槽分量并采用 `0.45*crown + 0.55*clump` 融合，彻底杜绝相邻叶团交界处法线向内反折成黑斑。
  4. **保亮度冷影着色**：`leaf-material.ts` 将 `deriveShadowTint` 归一化至感知亮度 `0.94` 并移除线性空间过暗乘数 `* 1.55`，让背光叶团保持清透冷青/柔紫阴影而不发黑发脏。
- **验证**：`npm test` **14 个测试文件 / 197 项全部通过**（`tests/node-edit.test.ts` 新增 S 弯节点编辑后包络重拟合、全叶团法线零反折、叶卡顶点亮度底线回归测试），`npm run build` 退出码 `0`；Chrome Playwright 实机多角度渲染（正面 / 45° / 侧面 + 舒展阔叶对照组）零控制台错误，叶团过渡清透柔和无黑块；截图见 `evidence/leaf-shading-fix/`。

## 2026-11-23 同步 GitHub 远端最新提交（`origin/main` @ `eac1c3c`）
- **仓库关联与同步**：已在本地工作区关联 `https://github.com/koerye/foliage-mass-prototype.git`（分支 `main` 跟踪 `origin/main`），并切换同步至最新提交 `eac1c3c`（`feat: add Rock Studio, TexGraph v2, Wood Sculpting v3, HSL recolor, flowerbed layouts, 6-option GLB export, and built-in user presets/textures`），同步前代码已完整备份至会话 scratch 目录，本地未跟踪个人素材（如 `vegetation_studio_intro.mp4`、`evidence/`）均完整保留。
- **同步新增核心模块**：Rock Studio（`rock.html`、`src/rock/*`）、贴图节点工坊 v2（`src/texgraph/*`、`scripts/textures-plugin.mjs`、`scripts/texgraph-cli.mjs`）、树干雕刻 v3 与单流形焊接（`src/tree/wood-sculpt.ts`、`wood-weld.ts`）、感知 HSL 换色（`color-recolor.ts`）、自定义叶法线编辑（`leaf-normals.ts`）、祈愿古树案例（`wishing-accents.ts`）、内置默认预设覆盖与程序贴图库（`user-presets/default-overrides.json`、`user-textures/library.json`）。
- **验证**：`git status` 干净（`main` 与 `origin/main` 一致）；`npm test` **21 个测试文件 / 257 项全部通过**；`npm run build`（`tsc --noEmit && vite build`）退出码 `0`。

## 2026-11-24 拉取 GitHub 最新提交（`origin/main` @ `1dddc22`）
- **Fast-forward 更新**：`eac1c3c..1dddc22`（35 个文件变更，`+8,242 / -22` 行），`git status` 干净。
- **新增核心功能**：
  - **Scene Studio 场景组装工作台**（`scene.html`、`src/assembly/*`）：支持多资产场景组装、地形地面、参考图对照与 2 套微景案例（白桦林草地 `birch-meadow`、林间巨石小径 `boulder-trail`）。
  - **跨工作台操作与导出诊断日志系统**（`src/studio/activity-log*.ts/css`、`scripts/presets-plugin.mjs`、`src/export-glb.ts`）：统一接入经典树木工作台、AI 模式、石头工作台与场景组装工作台。
- **验证**：`npm test` **23 个测试文件 / 265 项全部通过**；`npm run build`（`tsc --noEmit && vite build`）退出码 `0`。

## 2026-11-24 场景组装工作台三大升级（植物往返实时编辑 / 参考图对比与 Agent 自动注入 / UE 风格刷草笔刷）
- **1. 组装工作台 ↔ 树木工作台 植物往返实时编辑**（`src/assembly/studio-bridge.ts`、`src/assembly/main.ts`、`src/studio/main.ts`、`src/studio/studio.css`）：
  - 选中任意植物资产（`kind === 'tree'`）时，属性卡片与层级列表均提供 **「✎ 在树木工作台编辑（完成后实时更新）」** 按钮，自动保存完整组装场景草稿（含未保存摆位、地面、参考图与刷草）并携带该植物 `TreeSpec` 及自定义贴图跳转 `./broadleaf.html?sceneEdit=<sessionId>`。
  - 树木工作台识别 `?sceneEdit=` 后自动屏蔽默认预设覆盖并展示醒目顶部联调栏（**`✓ 完成并返回组装工作台`** / **`✕ 取消返回`**）；点击返回后实时更新对应资产（同时支持多标签页 `BroadcastChannel` + `storage` 实时同步）并保持 1:1 WYSIWYG 还原与撤销栈。
- **2. 组装工作台 参考图对比与 Agent 自动注入**（`src/assembly/ref-compare-ui.ts`、`src/assembly/spec.ts`、`src/assembly/showcases.ts`、`src/assembly/main.ts`）：
  - 顶部新增 **`🖼 参考图对比`** 开关，支持本地上传、拖放到画布、`Ctrl+V` 粘贴；提供 **隐藏 / 浮窗 / 卷帘拖拽 / 半透明叠图（穿透可操作 3D）/ 左右 50/50 并排** 5 种模式，支持透明度、缩放、XY 微调与轮廓 IoU 比对，内置案例 1/2 已自动预挂参考图。
  - **Agent 自动注入规范**：当用户直接向 Agent 提供参考图用于组装场景对照时，Agent 必须自动把图片存入 `public/showcases/<name>.(jpg|png|webp)`（或转 DataURL）并写入 `sceneSpec.reference`（或调用 `window.__sceneStudio.setReferenceImage(src, name, { mode: 'wipe' })` / URL 参数 `?ref=<url>&refMode=wipe`），无需用户手动再上传。
- **3. UE 风格高性能刷草笔刷**（`src/assembly/grass-brush.ts`、`src/assembly/ground.ts`、`src/assembly/viewport.ts`、`src/broadleaf/leaf-material.ts`、`src/export-glb.ts`）：
  - 顶栏 **`🌿 刷草笔刷 B`** 与右侧专属笔刷面板：采用 `THREE.InstancedMesh` 按草种合批（5 种实体建模 3D 草簇：`宽叶嫩草 / 尖长野草 / 密集草丛 / 高草芦苇 / 花点草簇`，全场景 500–10,000 簇仅 ≤5 Draw Calls，复用风格化背光透光/微风着色器并补齐 `USE_INSTANCING` 支持）。
  - 视口提供贴地 3D 圆形笔刷环（绿 = 绘制、红 = 擦除），UE 风格操作（左键拖拽泊松间距刷草、Shift+左键擦除、右键旋转视角、滚轮缩放、`[ / ]` 调半径），支持笔刷半径/密度/最小间距/缩放区间/随机倾角/草叶色调与色差、**避开沙土小径 (`avoidPath`)**、**✨ 一键铺满草地**、**🗑 清空刷草**、笔画级 `Ctrl+Z/Y` 撤销重做、`grassPaint` JSON 持久化，以及 `export-glb.ts` 完整烘焙 `InstancedMesh`（合并/分体均无损导出）。
- **验证**：`npm test` **23 个测试文件 / 268 项全部通过**（`tests/assembly.test.ts` 新增 3 项覆盖 `studio-bridge` 往返、参考图校验与安全过滤、UE 刷草泊松间距/避径/擦除/JSON 往返/GLB InstancedMesh 烘焙）；`npm run build` 退出码 `0`；Chrome Playwright 实机 E2E 全流程验证（植物往返修改金秋色实时同步 + 4 模式参考图对比与 `?ref=` 注入 + 真实鼠标拖拽刷草 132 簇 / 一键铺满 541 簇仅 4 Draw Calls / Shift 擦除 / `Ctrl+Z` 撤销），控制台与页面零报错；截图验收见 `evidence/scene-upgrades/`。

## 2026-11-24 组装工作台联调 1:1 对齐 / 笔刷快捷键毫秒级响应 / UE RVT 草地地表融合
- **1. 组装工作台 ↔ 树木工作台 1:1 资产外观完全对齐**（`src/assembly/builder.ts`、`studio-bridge.ts`、`src/assembly/main.ts`、`src/studio/main.ts`）：
  - 抽取双端共用的 `buildAssemblyTreeAsset()`，并在 `SceneEditBridgeSession` 中完整透传并回写 `barkStyle`、`crownStyle`、`treeForm`、`leafTexture`、`category` 与 `lighting`，确保白桦手绘冠/白桦树皮/古木树皮/灌木叶型进入树木工作台后与组装工作台 100% 一致（实测 `birch-hero-tree` 双端均为 `47,772` 面 + 暖阳吉卜力光效）。
  - 联调顶栏内置「树冠 / 树皮 / 形态」快捷切换下拉，编辑骨架或叶型时智能自动解锁自由参数并同步回写，同时隐藏误导性「已改默认」标题与默认覆盖条。
- **2. 刷草笔刷快捷键毫秒级响应与增量 GPU 合批**（`src/assembly/main.ts`、`viewport.ts`、`grass-brush.ts`、`spec.ts`）：
  - 全部快捷键改为优先识别物理键码 `ev.code`（`KeyB`/`BracketLeft`/`BracketRight`/`KeyW`/`KeyE`/`KeyR`/`KeyG`），彻底解决 Windows 中文输入法拦截延迟；新增 `Shift + 滚轮` 调半径、按住/松开 `Shift` 即时切换绿/红 3D 笔刷环及顶部半径浮标，去掉按键同步双渲染，实测 `KeyB` 响应降至 `2.8 ms`；同时修复退出笔刷时未选中状态下误显原点 XYZ Gizmo 的问题。
  - `PaintedGrassLayer.paintAt()` 升级为 `O(added)` 增量 GPU `InstancedMesh` 追加写入，`cloneJson()` 升级为原生 `structuredClone`，520+ 草簇基础上连续 20 次刷草耗时仅 `13.9 ms`（`0.70 ms/笔`）。
- **3. 草地 RVT（Runtime Virtual Texture）地表融合算法**（`src/broadleaf/leaf-material.ts`、`src/assembly/ground.ts`、`grass-brush.ts`、`spec.ts`、`main.ts`）：
  - `buildAssemblyGround()` 输出世界空间对齐的 `rvtTexture`、`rvtSize` 及 CPU 采样器 `sampleRvtColor()`；`leaf-material.ts` 新增全局 `foliageRvt` Uniform 与着色器融合路径（严格按 `uRvtChannel` 隔离，不影响树木/花朵，并自动保护花点草簇顶端的白黄野花瓣）。
  - 面板提供 4 种可选算法：**`根部融合 (UE RVT)`**（默认，消除根部暗缝并与地表像素级过渡）、**`全株跟随地表 (油画草海)`**（整片草丛随地块受光面/树影暗区/沙土路缘自然变色）、**`仅法线无缝融合`**、**`关闭`**，支持融合强度、过渡高度、法线贴地权重、同步融合已摆放草丛开关及 JSON 持久化（`sceneSpec.rvt`）。
- **验证**：`npm run build` 退出码 `0`；`npm test` **23/23 测试文件 / 269 项全部通过**（`tests/assembly.test.ts` 新增双端 1:1 三角面一致性 + RVT 解析/采样/Uniform 绑定测试）；Chrome Playwright 实机 E2E 零报错零 Shader 警告，截图对比见 `evidence/scene-rvt-parity/`。

## 2026-11-24 联调全参数化调参 / 笔刷防误触锁定 / 清理隐藏草绒 / UE 地形材质绘制笔刷
- **1. 树木工作台联调全参数可调与贴图预览同步（根治「一改就原形毕露」）**（`src/assembly/birch-structure.ts`、`birch-foliage.ts`、`birch-bark.ts`、`src/studio/main.ts`）：
  - 移除滑块改参时自动清掉 `treeForm` / `crownStyle` / `barkStyle` 的强制重置；将白桦预设骨架、实体手绘叶冠、白桦手绘树皮升级为全参数实时响应（支持高度/倾角/扭曲/枝条伸展/仰角/下垂/弯曲/粗细/方位/SpeedTree 3D 节点编辑、叶簇密度/每枝叶数/尺寸/LOD 减面、树皮基色/苔藓覆盖与色相/白桦起止高度），默认值 1:1 保持不变、任意调参平滑过渡不跳变。
  - 在 `bindTextureSlots` 中接入 `resolveSceneEditSlot` 与 `makeBirchPreviewTexture`，树皮与叶片贴图槽实时显示当前真实生效的手绘树皮/场景叶型缩略图与说明；手动导入自定义贴图或切换内置叶型才退出手绘模式。
- **2. 笔刷模式严格锁定其他场景模型**（`src/assembly/viewport.ts`）：
  - 开启刷草笔刷（`B`）或地形材质笔刷（`T`）时彻底执行 `transform.enabled = false` + `transform.detach()` + 屏蔽视口点击选物体，从根源杜绝画笔划过树干/Gizmo 时误拖移动模型；退出笔刷自动恢复原选中状态与 Gizmo。
- **3. 清除地形隐藏自带草绒**（`src/assembly/spec.ts`、`ground.ts`、`main.ts`）：
  - `AssemblyGroundSpec.builtInTurf` 默认设为 `false`（地块设置区提供可选勾选「地块附带预设草绒」），清空层级列表与刷草后地块底座 100% 干净无残留草。
- **4. UE 风格地形材质绘制笔刷（与 RVT 草地同帧实时联动）**（`src/assembly/terrain-brush.ts`、`ground.ts`、`main.ts`、`assembly.css`）：
  - 新增顶栏 **`🎨 地形笔刷 T`** 与右侧手绘面板：内置 **翠绿草地 / 暖阳浅草 / 林下暗苔 / 沙土小径 / 青灰碎岩 / 金秋落叶 / 自定义色** 7 种风格化手绘地表材质 + `Shift` 还原基底橡皮擦，支持笔刷半径、强度、边缘硬度、`[ / ]` 与 `Shift + 滚轮` 调半径、**绘制沙土/碎岩时自动清理重叠草丛**、一键清除手绘层、`Ctrl+Z/Y` 撤销重做及 `sceneSpec.groundPaint` PNG DataURL 持久化。
  - 绘制地表直接更新地块 `CanvasTexture`（即 `foliageRvt.uRvtMap`），实现绘制地形材质时上方 RVT 草丛同帧实时变色融合。
- **验证**：`npm run build` 退出码 `0`（2.02s）；`npm test` **23/23 测试文件 / 270 项全部通过**（`tests/assembly.test.ts` 新增干净裸地块校验、地形笔刷绘制/采样/清除测试及白桦全参数/LOD 响应测试）；Chrome Playwright 实机 E2E 验证全 4 项均通过且零报错，截图验收见 `evidence/scene-four-fixes/`。

## 2026-11-24 白桦全树干树枝参数联动 / 刷草密度上限 3×+ / 组装工作台微风实效修复
- **1. 树木工作台联调全树干/树枝/树皮/光影滑块全面生效**（`src/assembly/birch-structure.ts`、`birch-bark.ts`、`birch-foliage.ts`、`src/studio/main.ts`）：
  - 重构 `buildMeadowBirchStructure` 为围绕基准值的全参数连续驱动模型：除主干高度/半径/收细/倾角/倾角方向/弯曲/扭曲/分叉高度、树冠底/顶/宽/深/顶部偏置/不规则度/抬升/扁平化/轮廓曲线外，现已完整响应**主枝数量（1–24 动态增减主枝与云团）**、起始高度、高度跨度、方位偏移、底/顶仰角、伸展、长度随机、弯曲、下垂、粗细比、**子枝数量（0–10 动态增减二级枝与叶团）**、子枝起点/夹角/长度/下垂、**枯枝数量（动态生成枯枝桩）**、整体偏移及 3D 节点编辑。
  - 修复 `src/studio/main.ts` 中 `applyLiveParam` 在 `barkStyle === 'birch'` 或 `crownStyle === 'painted'` 时拦截提前返回、跳过 `rebuild()` 导致 `trunk.bark*` 与 `shading.*` 滑块失效的根因；同时在 `birch-bark.ts` 接入 `barkDetail` 与 `barkRootAO`、`birch-foliage.ts` 接入 `translucency` 与 `softSelfShadow`。
- **2. 刷草笔刷密度上限提升 3.75× 并优化 60fps 空间哈希**（`src/assembly/grass-brush.ts`、`spec.ts`、`main.ts`）：
  - 绘制密度滑块上限从 `32` 提至 **`120`**（3.75×），最小间距下限从 `0.10m` 降至 **`0.04m`**，单场景最大草簇上限从 `10,000` 提至 **`30,000`**；`paintAt()` 改为局部 `O(1)` 空间哈希网格去重（单笔尝试数上限 420），「一键铺满草地」按密度与最小间距动态扩展（高密模式单次铺满 `3,840 簇` 仅占 `3 Draw Calls`）。
- **3. 组装工作台「🍃 微风」全场景真实摇曳**（`src/assembly/birch-foliage.ts`、`viewport.ts`、`main.ts`、`assembly.css`、`src/broadleaf/leaf-material.ts`）：
  - 为 `buildBirchFoliage`（案例 1 白桦孤树与手绘灌木的 `MeshStandardMaterial`）接入全局 `foliageWind` GPU 顶点微风着色器（此前该材质未接微风着色器，导致点击微风毫无变化）；将组装视口风幅由 `0.026` 提升至 `0.078`、实例化草尖摇曳系数提至 `1.55`，并升级顶部微风按钮明确显示 **`🍃 微风 开`**（深绿高亮）/ **`🍃 微风 关`** 与开启提示。
- **验证**：`npm run build` 退出码 `0`（2.47s）；`npm test` **23/23 测试文件 / 271 项全部通过**（`tests/assembly.test.ts` 新增白桦全参数增枝/高度/倾斜响应、手绘叶微风着色器校验与 3×+ 高密刷草回归测试）；Chrome Playwright 实机 E2E 零报错零 Shader 警告：白桦调参 `9 枝条 / 49,060 面 → 51 枝条 / 142,090 面`（RMS 差异 `41.47`）并实时同步回组装工作台，高密刷草单次铺满 `3,840 簇`（3 Draw Calls），微风关静态 RMS `0.000` vs 微风开实时摇曳 RMS `full=14.66 / canopy=23.90 / grass=12.38`；截图与运动差分图见 `evidence/scene-wind-density-params/`。

## 2026-11-24 全面废除 3D 建模树叶 + 纯 Alpha 叶卡分布核心算法重构（解决镂空/裸枝/拥挤）
- **硬性架构准则确立**：彻底删除所有树木与灌木的 3D 实体建模叶片方案（删除 `src/tree/modeled-foliage.ts`、`src/assembly/birch-foliage.ts`、`cardType='blades'` 及 `crownStyle='painted'` 旁路，仅保留旧 JSON 向后兼容迁移 `'blades' → 'cross'`），全项目所有阔叶树与灌木 100% 走游戏工业标准的 **Alpha 透明叶片卡（`quad / cross / tri / fan / strip / drape`）+ 法线转移 + 统一风格化材质**单管线。
- **三大分布缺陷根因修复（`src/broadleaf/leaves.ts`、`src/tree/assemble.ts`、`src/assembly/showcases.ts`）**：
  - **消除「树枝没有树叶 + 裸细枝刺出」**：`assemble.ts` 对带枝团骨架始终启用 `preserveClumpShells: true` 并为定制骨架使用实时拟合包络（外伸主枝如白桦右下分叉枝不再被中心椭球外包络误裁光），同时在 `showcases.ts` 移除压在右下分叉上的错误裸枝区并降低 `canopyLift`；`generateLeafCards` 仅保留实际承载叶片的细枝（`activeTwigIds`），彻底杜绝死枝刺。
  - **消除「局部镂空严重」**：废除相邻枝团间粗暴挖洞的 `clumpRadius < 0.82` 硬剔除；在 `uniformDensity` 模式下升级为**双层斐波那契球面填充**（72% 蓬松外轮廓壳 + 28% 柔和内核体积）与 `pruneInner = 0`，切换任意叶型/贴图均无穿帮空洞。
  - **消除「枝条交汇处拥挤成团」**：在 `distributeLeaves` 中引入 **O(1) 三维空间哈希占格器（`LeafOccupancyGrid`）**，跨枝团/细枝/主枝统一做蓝噪声最小间距排重（`0.18–0.26 × leafSize`），交汇区域不再叠厚发脏；同时将 `normalSource='clumps'` 分团法线权重由 `0.55` 提至 `0.70`，并修正 `stylePalettes.default / bush` 过白过艳的色板偏移。
- **性能与面数收益**：纯 Alpha 叶卡方案使白桦孤树从 `49,060` 面直降至 **`15,160` 面**（`677` 张叶卡，−69%），案例 1 全场景 13 资产仅 `56,360` 面，案例 2 全场景 18 资产仅 `38,469` 面。
- **验证**：`npm run build` 退出码 `0`（1.89s）；`npm test` **23/23 测试文件 / 271 项全部通过**（`tests/assembly.test.ts` 新增纯叶卡材质校验、`< 25k` 游戏面数预算、右下分叉枝丰满叶顶点断言、`blades → cross` 旧 JSON 迁移与自定义法线/树干重建全回归）；Chrome Playwright 实机验证 6 种内置叶型（`bush / cloud / default / oak / sakura`）与 `cross / fan + dome 法线` 全部丰满均衡无空洞无裸枝、控制台零报错；截图验收见 `evidence/pure-leafcards-fix/`。

## 2026-11-24 将手绘大色块叶簇方案沉淀至通用底层引擎（彻底消除白桦专属旁路）
- **核心架构统一（100% 纯 Alpha 叶卡，零专项分支、零反向依赖）**：
  - 彻底删除 `src/assembly/painted-crown.ts` 及 `src/tree/assemble.ts → src/assembly/painted-crown` 的反向跨层依赖与白桦专属分支；将 GPT 案例验证有效的 4 项手绘大色块机制完整提炼为**全树种、全预设、全贴图通用的底层核心能力**：
    1. **手绘相连核 + 零散叶尖中性贴图**（`src/tree/textures.ts` → `makePaintedClusterTexture(256)` + `src/studio/texture-slots.ts`）：沉淀为标准内置叶型 `'painted'`（256×256 连笔实心核 + 47 枚零散外缘叶尖 + RGB=246 预填抗 Mipmap 黑边），同时升级缩略图渲染器直接支持 `DataTexture`，用户上传自定义叶贴图时自动优先覆写贴图而保留色块光影。
    2. **枝团局部双色水粉大块面着色 + `shading.colorMass` 一等滑块**（`src/tree/spec.ts`、`src/studio/panel.ts`、`src/broadleaf/leaves.ts`）：在 `ShadingSpec` 与右侧面板新增 `shading.colorMass`（`色块聚合 · 手绘大块面`，`0..1`）；`buildCardGeometry` 按所属枝团（`clumpIndex` / 最近枝团）的局部定向受光 + 云纹扰动 + 陡峭明暗交界线（`smoothstep(0.08, 0.26)`）连续混合至 `tintInner → tintOuter`，并对普通阔叶树、樱花、灌木及任意自定义贴图均原生生效。
    3. **风格化平涂光照融合 + 高频噪点自适应衰减**（`src/broadleaf/leaf-material.ts`、`src/tree/assemble.ts`）：由 `effectiveColorMass` 连续驱动 `uPaintedLight`（`0..0.86`）与哑光 `roughness`（`0.80..0.98`），并在着色器中随 `uPaintedLight` 同步衰减 3D 高频程序噪点 `leafProcNoise`，既保持大块青绿暗面干净不脏，又完整保留场景灯光、微风动画、自定义法线（Normal Transfer）与 LOD。
    4. **枝团椭球壳均匀分布 + 单向深叠剔除 + 3D 空间哈希去重**（`src/broadleaf/leaves.ts` → `distributeClumpMassLeaves`）：`CrownCluster` 原生扩展可选 `density` / `shade`；高色块聚合模式下沿各枝团椭球壳分布叶卡并保留枝间呼吸留空，同时引入 `LeafOccupancyGrid` 3D 空间哈希与严格单向（`j < index`）深度重叠剔除（防止多叶团标准树双向互剔挖洞或重叠面数爆炸）。
- **验证**：`npm run build`（`tsc --noEmit && vite build`）退出码 `0`（2.08s）；`npm test` **23/23 测试文件 / 271/271 项全部通过**（`tests/assembly.test.ts` 新增标准圆冠阔叶树与樱花树通用 `colorMass` 渲染、Uniform 与 `< 30k` 面数预算测试）；Chrome Playwright 实机两轮可视化对比验收零报错：
  - 案例 1 白桦孤树（全统一核心管线，`15,480` 面 / `715` 叶卡 / `43 ms`，全场景 `61,690` 面）与参考图及树木工作台 1:1 匹配；
  - 标准 `broadleaf-round` 开启 `painted + colorMass=0.92`（RMS `25.39`）无空洞、呈现饱满吉卜力色块云团；
  - 标准 `broadleaf-sakura` 保留樱花贴图仅拉高 `colorMass=0.85`（RMS `12.87`）呈现立体动画粉云块面；对比截图见 `evidence/color-mass-core/`。

## 2026-11-24 新增竹子（写实 / Q版）与荷花（有杆挺水 / 无杆浮水）两大植物体系与 4 套预设
- **新增两大独立程序化植物生成器与 3 套专属手绘程序贴图**（`src/tree/bamboo.ts`、`src/tree/lotus.ts`、`src/tree/textures.ts`、`src/tree/spec.ts`、`src/tree/assemble.ts`）：
  1. **竹子（`kind: 'bamboo'`，2 套预设，100% 纯 Alpha 竹叶簇叶卡）**：
     - **`竹子 · 写实修长`（`bamboo-realistic`，3,226 面 / 197 叶卡 / 42 ms）**：修长分节绿竹竿 + 浅黄竹节凸环 + 中下段露竿与交替纤细竹枝 + 上段 3 层错落伞状竹叶云团（深翠暗底 + 暖黄绿受光顶）。
     - **`竹子 · Q版卡通`（`bamboo-chibi`，2,356 面 / 107 叶卡 / 5 ms）**：一大一小 V 形错开双株粗短折节竹竿 + 突出亮绿节环 + 顶部斜切**镂空竹口（带浅黄竹壁与深色中空竹腔）** + 聚拢垂落宝石翠青叶簇。
     - 专属 512×512 贴图 `makeBambooLeafTexture()`（顶部叶柄挂点 + 6 片弯垂细长尖竹叶扇簇），可自定义上传替换。
  2. **荷花（`kind: 'lotus'`，2 套预设，3D 卷边凹杯荷叶 + 多层立体莲花/花苞）**：
     - **`荷花 · 有杆挺水`（`lotus-stemmed`，4,179 面 / 17 荷茎 / 12 荷叶 / 5 荷花与花苞 / 7 ms）**：自然散开的弯曲绿荷茎与叶底喇叭花托 + 3D 漏斗杯凹波浪边放射脉荷叶（含低矮小幼叶与 V 形裂口）+ 高挺盛开多层粉荷花与饱满花苞 + 金色莲蓬花蕊。
     - **`荷花 · 无杆浮水`（`lotus-floating`，3,644 面 / 0 杆 / 34 浮水荷叶 / 6 荷花与花苞 / 6 ms）**：无杆平贴水面的有机聚落式 V 形缺口睡莲叶（微阶防 Z-fighting）+ 嵌套叶间与叶缘的浮水多层莲花与饱满花苞。
     - 专属 512×512 贴图 `makeLotusLeafTexture()`（手绘放射脉荷叶 + 水珠高光）与 `makeLotusPetalTexture()`（丝绒尖瓣荷花瓣），均可自定义替换；支持「挺水花杆」一键切换有杆/无杆、自由改色（粉荷/白莲/青莲）。
- **全工作台与导出打通**（`src/studio/panel.ts`、`main.ts`、`texture-slots.ts`、`editor.ts`、`src/ai/*`、`src/assembly/*`、`src/export-glb.ts`）：
  - 树木工作台、AI 模式与场景组装工作台（`🌳 树木` 栏收录 2 套竹子，`🌿 灌花草` 栏收录 2 套荷花）全部同步开放，支持树冠编辑/裸枝区、四档单调 LOD、微风、JSON 往返及语义化 GLB 材质槽（`Mat_Bamboo_Culm` / `Mat_Foliage_Bamboo` / `Mat_Lotus_Stems` / `Mat_Lotus_Leaves` / `Mat_Lotus_Petals` / `Mat_Lotus_Center`）。
- **验证**：`npm run build` 退出码 `0`（2.06s）；`npm test` **23/23 测试文件 / 291/291 项全部通过**（`tests/plants.test.ts` 与 `tests/optimize.test.ts` 新增 20 项竹子/荷花几何、镂空顶、有杆/无杆、LOD 单调、JSON 往返与 GLB 材质槽回归测试）；Chrome Playwright 两轮多角度实机视觉与场景目录放置验收零报错，截图见 `evidence/bamboo-lotus/`。

## 2026-11-24 节点编辑载入当前贴图 + 贴图库双击应用并返回编辑界面
- **节点编辑精确还原当前贴图**（`src/texgraph/types.ts`、`library-ui.ts`、`editor-ui.ts`、`src/studio/texture-serialize.ts`、`src/studio/main.ts`、`src/ai/main.ts`）：
  - 新增 `TextureGraphSource`（`tex.userData.texGraphSource`）并通过 `attachTextureGraphSource` / `readTextureGraphSource` / `resolveSlotEditorOptions` 贯通实时贴图库、节点工坊与默认预设持久化（`SavedSlotTexture` 同步序列化 `savedId` / `templateId` / `graph`）。
  - 无论在槽位点击 **`◆ 节点编辑`** 还是顶栏点击 **`◈ 贴图编辑`**（经典工作台与 AI 模式双端生效），均严格按优先级还原当前生效贴图：已绑定实时节点图 / 贴图库 `savedId`（同步点亮「覆盖保存」） → 旧存档按名称回查贴图库/模板 → 当前树种内置叶型/树皮风格模板 → 槽位默认模板；不再每次重置回默认节点。
- **贴图库双击直接应用并返回编辑器界面**（`src/texgraph/library-ui.ts`）：
  - 将应用高亮切换改为原地 `syncActiveCards()`（不销毁卡片 DOM，彻底杜绝首击重绘吞掉双击事件），并对首击与双击共享去重 `pendingApply` / `lastApplied` 防抖；在「★ 我的贴图」与「◈ 内置模板」两页双击任意卡片均直接应用到 3D 并立即关闭贴图库返回编辑界面。
- **附带修复**：修复 `src/studio/panel.ts` 中 `fieldByPath` 未按 `kind` 隔离导致阔叶树 `trunk.height` 标签显示为「竹竿高度 m」的问题。
- **验证**：`npm run build` 退出码 `0`（2.21s）；`npm test` **23/23 测试文件 / 294/294 项全部通过**（`tests/texgraph.test.ts` 新增贴图来源解析与 `SavedTextureMap` 往返测试）；Chrome Playwright 全流程实测零报错（模板双击关闭返回 → `#leaf-edit` 载入当前红枫图 → 改名应用重开仍保留修改图 → 我的贴图双击关闭并顶栏重开还原精确 `savedId` 与「覆盖保存」按钮），截图见 `evidence/tex-ux/`。

## 2026-11-24 接入 Electron 双模薄壳桌面端 + 完整内置 MCP 操控服务（23 个工具已注册）
- **双模 Electron 桌面薄壳（零破坏 Web 开发与测试链路）**：
  - `electron/app-server.mjs`：内置 `127.0.0.1` 回环服务，直接复用 `scripts/presets-plugin.mjs`（`attachPresetsMiddleware`）与 `scripts/textures-plugin.mjs`（`attachTexturesMiddleware`）磁盘持久化 API，打包态直接读取 `app.asar` 内 `dist/`（ASAR 安全 `readFileSync`），并承载 Bearer 鉴权桥接 `/mcp-bridge/health`（含 `tokenValid` 校验）、`/mcp-bridge/command` 及 Streamable HTTP `POST /mcp`。
  - `electron/main.mjs` & `electron/preload.cjs` & `electron/dev-runner.mjs`：支持 `npm run electron:dev`（加载 Vite 热更新）与打包 `.exe` 离线模式；首启自动将内置 `user-presets/` 与 `user-textures/` 播种至同级便携 `data/` 目录；中文原生菜单（4 大工作台快捷键 `Ctrl+1..4`、副屏多开、一键复制 MCP 配置、打开本地数据目录）；支持 `--headless` / `VEG_HEADLESS=1` 离屏渲染模式；`src/studio/desktop-bridge.ts` 接入原生 OS 保存框与顶栏 **`⚡ MCP 已就绪`** 徽标。
  - 打包产物（`npm run dist:win`）：解压直跑目录 `release/win-unpacked/Vegetation Studio.exe`（238 MB）与单文件便携版 `release/Vegetation-Studio-1.0.0-portable.exe`（115 MB），内置自定义图标 `electron/icon.ico` 及 `resources/mcp/`。
- **零依赖 Stdio + Streamable HTTP MCP 服务端与全局注册**：
  - `mcp/tools.mjs` & `mcp/server.mjs`：提供 **23 个结构化 MCP 工具**，覆盖全部 4 大工作台（`studio_status / studio_switch / studio_screenshot / studio_eval`、`tree_list_presets / tree_load_preset / tree_get_spec / tree_set_params / tree_set_camera_lighting / tree_optimize_lod / tree_export_glb`、`texture_list / texture_apply / texture_editor_open / texture_graph_patch`、`scene_load_case / scene_inspect / scene_add_item / scene_update_item / scene_set_reference / scene_grass_and_terrain / scene_export_glb`、`rock_control`），兼容换行 JSON 与 `Content-Length` 双帧协议，并在未启动桌面端时按需自动拉起 `Vegetation Studio.exe`。
  - 已直接注入 Antigravity 全局 MCP 配置 `C:/Users/ronal/.gemini/config/mcp_config.json`（保留原有 `photocraft` 配置不动），并已热加载生效为 `vegetation-studio` 服务端。
- **验证**：
  - `npm test` **24/24 测试文件 / 296/296 项全部通过**（新增 `tests/mcp-electron.test.mjs` 验证本地服务、磁盘 API、`tokenValid` 与 `401` 鉴权、Streamable HTTP `/mcp` 及 Stdio `mcp/server.mjs` 子进程）。
  - `npm run dist:win` 退出码 `0`（`tsc --noEmit && vite build` 2.24s + 产出目录版与便携单文件 `.exe`）。
  - 实机打包 `.exe`（`packaged: true`）通过真实 Stdio `mcp/server.mjs` 全链路 E2E 通过：自动拉起 `Vegetation Studio.exe` → `initialize` / `tools/list`（23 工具） → `tree_load_preset('bamboo-chibi')` + `tree_set_params({ 'bamboo.culmCount': 3 })`（10,050 面 / 2ms） → `studio_screenshot`（窗口 + 画布双截图） → `tree_export_glb`（575 KB 有效 `glTF` 二进制） → `scene_load_case('birch-meadow')` + `scene_add_item('lotus-floating', [1.8,0,1.4], scale=1.35)` → `scene_inspect` 校验 `scale=[1.35,1.35,1.35]` 与 17 资产并截屏视觉复核通过；验收截图与导出 GLB 见 `evidence/electron-mcp/`。

## 已知问题 / 限制
- 全树尺度下，各插片方式之间的差别主要体现在密度和体积上；单看贴图效果需要用户自己的贴图验证。
- 针叶灌木·刺柏 的主枝上扬，部分枝条会露在垂片上方（可调 枝条仰角 / 垂片长度）。
- 松树和参考图仍有差距：参考图里每片针叶更长、更分离，「手指」状更明显；目前是层叠较实的效果（可调 宽度/扭转/子枝数）。只看过占位贴图下的效果。
- 「朝向相机」只在预览里生效（同上一轮）；GLB 里是几何朝向。
- 控制点的锚点是世界坐标：大幅修改树冠尺寸后控制点不会跟着移动（「重置控制点」可以重建）。
- 正面机位下，前后两个控制点在屏幕上重叠，需要转一下视角再选。

## 下一步
1. 用户放入真实针叶 / 叶片贴图后定默认值。
2. 可加：枝条级别的直接拖拽（单根主枝）、包络截面曲线编辑器、风动顶点数据。

## 约束
- 旧版 `src/broadleaf/*`（薄片模式）和 `legacy.html` 保留，作为回退；`leaves.ts` 修改后向后兼容（旧版 41 项测试仍通过）。
- 改动前的源码备份在会话 scratch 目录 `backup-before-leafcards`。
