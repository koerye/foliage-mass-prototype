# Rock Studio 路线 B 最小原型 — 两道门实测验收报告

> **范围严格克制**：完全遵循定案建议，未改动 `src/rock/main.ts` 与 `src/assembly/builder.ts` 生产入口（仅在 `src/export-glb.ts` 的 `mergeEntries()` 补齐了 4 分量 `TANGENT` 透传以支持合并 GLB 导出）；原型代码完全隔离在 `src/rock-v2/` 与 `rock-proto.html`。

---

## 一、第一道门（Gate 1）：受控隐式雕刻灰模与两档分辨率拓扑

### 1.1 算法实现（`src/rock-v2/sdf.ts` + `src/rock-v2/surface-nets.ts`）
- **受控主切面与局部切刀**：
  - 共用实心基体：`smoothMin` 连接粗岩体块；
  - 宽阔主斜面与侧崖：`warpedPlane = dot(n, p) - h + boundedLowFreqInPlaneWarp(u, v)`（保留宽主面、少量清晰转折面与微弱有机曲率）；
  - 阶梯肩台 / 斜向 V 断层：`carved = smoothMax(withCut, -finiteNotch, kRim)`，槽深、槽口宽度与转角半径与体块并集解耦；
  - 局部崩角：用少量平面切角削去指定外棱角，不切碎正面宽主面；
  - 底部有机接地：中心稳定接触区 + 外圈非对称微内扣与底踵切面，整体平移至 `minY = 0`。
- **规则网格 Surface Nets + 拓扑实测**：
  - 采样域外补 2 格正值边界壳；
  - 网格提取前消解 `2×2` 棋盘鞍面与 `2×2×2` 体对角捏点，避免 Surface Nets 4 四边形共边；
  - 仅在 `|F(v)| > 0.08 * voxelSize` 处执行单次限幅投影，且严格限制在所属体素盒内（零全局拉普拉斯、零跨壁自交）。

### 1.2 两块挑战石型实测拓扑与耗时

| 石型 | 档位 | 三角面 | 连通壳数 | 开边 / 非流形 / 绕序错 / 退化面 / 自交 | `minY` | 离面误差（最大 / 均值） | 总耗时 |
| :--- | :--- | ---: | ---: | :---: | ---: | :---: | ---: |
| **阶梯方巨岩** (`block-bluff`) | LOW (`N=30`) | **4,304** | **1** | `0 / 0 / 0 / 0 / 0` | `0.0000` | `0.0302 / 0.0009 m` | **45.6 ms** |
| **阶梯方巨岩** (`block-bluff`) | HIGH (`N=64`) | **19,664** | **1** | `0 / 0 / 0 / 0 / 0` | `0.0000` | `0.0116 / 0.0002 m` | **350.0 ms** |
| **双叠断层岩** (`twin-slab`) | LOW (`N=30`) | **3,436** | **1** | `0 / 0 / 0 / 0 / 0` | `0.0000` | `0.0323 / 0.0015 m` | **53.2 ms** |
| **双叠断层岩** (`twin-slab`) | HIGH (`N=64`) | **15,924** | **1** | `0 / 0 / 0 / 0 / 0` | `0.0000` | `0.0133 / 0.0003 m` | **157.1 ms** |

### 1.3 灰模多视角对照证据（旧版 vs 新版 HIGH vs 新版 LOW + 线框）
- **阶梯方巨岩 3×5 同机位同灯灰模对照**：`C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_g1_v4_gate1_block-bluff.png`
  - 正面 / 斜前 45° / 侧后 / 低机位底脚 / 游戏视距全部清晰读出「一体雕出的左上阶梯肩台 + 完整宽主面 + 硬朗右侧崖 + 自然底脚」，彻底消除旧版「正面切碎 + 左侧像插薄板」。
- **双叠断层岩 3×5 同机位同灯灰模对照**：`C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_g1_v4_gate1_twin-slab.png`
  - 宽阔左侧主斜面完整保留，斜向 V 断层缝深邃清晰、底部一体连续、高低两档稳定不封槽。

**第一道门判定：PASS（零否决项触发）**。

---

## 二、第二道门（Gate 2）：`block-bluff` 低模 512 标准 PBR 烘焙与 GLB 闭环

### 2.1 UV、锁定切线与解析烘焙实现（`src/rock-v2/uv-charts.ts` + `src/rock-v2/bake.ts`）
- **邻接生长局部平面图表**：按法向一致性、正面积拉伸阈值与 2D 三角形严格无重叠约束生长分片，统一像素密度装箱 + `12 px` 槽距；拆点前保留焊接平滑法线，拆点后在锁定三角化与 UV 上计算 Terathon / MikkTSpace 4 分量切线（`B = normalize(cross(N, T) * tangent.w)`）。
- **结构有限裂纹曲线**：1 条主缝（自阶梯肩台内角出发斜向延伸至主面收尖归零）+ 1 条短分叉，逐段投影贴合零等值面，按面法线与法向偏距严格门控防背面串面，横截面采用略不对称 V 槽（裂纹处启用 `2×2` 子像素超采样抗锯齿）。
- **安全双侧区间寻根 + 平面对齐归一化 AO + 分片隔离扩边**：
  - 预采 `48³` 宏观 SDF 缓存做 O(1) 粗寻根、曲率与 8×4 半球 AO（平面归一化 `(dist * rz - f) / (dist * rz)`，保证开阔大面 AO = 1.0 不发灰），再对每个命中 texel 做精确解析二分细化 + 4 点四面体解析梯度编码切线法线；
  - `10 pass` 按 `chartId` 隔离扩边，杜绝跨图块渗色与 Mip 漏缝；
  - **弱处理 BaseColor**：仅含暖砂岩基色、少量层理与宽笔触色差、石脚沉积色差、指定崩角微提亮与缝芯微暗，**零烘焙方向阴影**。

### 2.2 实测指标与分段耗时（`block-bluff` `N=30` `4,304` 面 + `512×512` 纯 CPU 单线程）

| 阶段 | 实测指标 / 耗时 | 预算对照 |
| :--- | :--- | :--- |
| 宏观体场 + Surface Nets (`N=30`) | **45.6 ms**（采场 `24.0` / 提取 `8.1` / 投影 `4.1` / 法线 `0.7`） | `< 100 ms` 交互预算 ✅ |
| 自动 UV 分片 + 锁定 4 分量切线 | **33.3 ms**（`17` 图表、覆盖率 `37.5%`、翻面 `0`、重叠 `0`、无效切线 `0`） | — |
| 512×512 烘焙总计 | **884.9 ms**（48³ 缓存 `55.6` / 光栅化+寻根+法线 `720.9` / 半球 AO `47.7` / BaseColor `20.8` / 隔离扩边 `34.7`） | — |
| 纹理上传 GPU | **2.5 ms** | — |
| **松手精雕端到端合计（纯 CPU）** | **966.3 ms**（**< 1.0 s**） | `< 1.5 s` 精雕预算 ✅ |
| 真实 `exportGlb()` 合并导出 | **36.2 ms**，`509.6 KB`（`521,796 B`） | 导出耗时另计 ✅ |
| 烘焙投影诊断（512，98,425 覆盖纹素） | 干净命中 **`98,425`（`100.00%`）** · 掠角 `0` · 跨壁拒绝 `0` · 漏投 `0` · 法线翻转回退 `0` | 零跨壁/零漏投 ✅ |
| 独立 `GLTFLoader` 重载核验 | `meshCount=1`, `tris=4,304`, `hasTangent=true (vec4)`, `hasMap=true`, `hasNormalMap=true`, `hasAoMap=true (channel=0, intensity=0.85)`, `metalness=0`, `roughness=0.9` | 完整保留全部语义 ✅ |

### 2.3 烘焙贴图、旋转光与 GLB 独立重载证据
- **512 四联贴图与投影诊断**：`C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_g2_v2_gate2_maps.png`
- **纯标准 `MeshStandardMaterial`（零自定义 Shader）四方向旋转光 + 低机位 + Mip 缩远 + 重载 GLB**：`C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_g2_v2_gate2_pbr_and_glb.png`
- **Live PBR vs `exportGlb()` → `GLTFLoader` 独立重载近景 1:1 对照**：`C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_g2_v2_gate2_glb_parity.png`

**第二道门判定：PASS（零否决项触发，且纯 CPU 单线程即跑进 `1.0 s` 内）**。

---

## 三、待拍板的下一阶段投入决策

基于两道门实测数据，下一阶段建议按以下优先级推进：
1. **接入 Rock Studio 与场景组装（高优先）**：把 `src/rock-v2/` 封装为异步 Worker 管线（拖拽用 `N=26~30` 实时灰模/快览 `< 50 ms`，松手后台 Worker 跑 `512` 烘焙 `< 1.0 s`，导出时可选 `1024`），并补齐其余参考图石型（斜棱厚岩、层裂卧石、尖峰孤岩、简面立石、底座碎石）及独立验证拆分 glTF+TEX / FBX+TEX。
2. **手绘大面质感增强（C1 轻量对照，按需投入）**：从 `g2_v2` 实测可见，标准 PBR 下的形体、肩台、立体裂纹与动态受光已经扎实，但主面内部仍偏干净均质；适合在 `BaseColor` 合成层加一版**可开关对照的定向宽笔触 / 局部崩口亮边**（C1），直接做 A/B 对比决定强度。
3. **1024 / GPU / QEM 是否必要**：当前纯 CPU `512` 烘焙仅 `885 ms`，`N=30` 低模 `3,400–4,300` 面已落在 `1,000–5,000` 目标区间且零拓扑缺陷；若需导出 `1024`（预计纯 CPU ~3.2s）或更低面数（`< 1,500` 面）同时保棱，再按实测决定是否引入 WebGL2 FBO 烘焙或保槽 QEM。

---

## 六、第二轮生产前收口与实机验证（2026-11-26）

按定案评审意见，本轮严格聚焦 **3 项交付**（暂缓接入 `src/assembly/builder.ts`、暂缓 `1024` / GPU 烘焙 / 通用 QEM）：

### 6.1 两处生产阻塞缺陷修复 + 跨引擎切线/UV 互通修正

1. **GLB 合并器切线变换与混合输入修复（`src/export-glb.ts`）**：
   - `mergeEntriesIntoSingleMesh()` 现改用模型矩阵线性 3×3 部分（`linearMat.setFromMatrix4(e.matrix)`）变换切线 `T` 与副切线 `B = cross(N, T) * w`，再相对变换后法线 `n` 做 Gram–Schmidt 正交化，并由 `dot(cross(n, T), B')` 精确计算镜像手性 `w'`。
   - 混合网格中缺少 `tangent` 的子网格改由 `computeFallbackEntryTangents()` 基于 UV 实时合成 Terathon 切线（无 UV 则构造严格正交切线），彻底消除退化的硬编码 `(1, 0, 0, 1)`。
   - 回归单测（`tests/rock-v2-proto.test.ts`）覆盖非均匀缩放 `(2.2, 0.65, 1.35) + 旋转`、镜像 `(-1, 1, 1)` 手性翻转、混合有/无切线与无 UV 子网格合并，全部通过（`|dot(T, N)| < 1e-4`）。
2. **投影求根诊断诚实拆分与残差统计 + 双叠断层岩 512 验证（`src/rock-v2/bake.ts`）**：
   - 严格区分 **纯解析夹根命中（绿/黄）** 与 **仅缓存回退（橙色）**，禁止将缓存近似计入绿色命中，并输出解析场零面残差 `|evalMacro(P_hit)|`（Max / Mean / P95）。
   - **512×512 实测结果**：
     | 样石 | 覆盖纹素 | 解析命中率（绿+黄） | 缓存回退（橙） | 跨壁拒绝（紫） | 漏投（红） | 残差 Mean / P95 / Max (m) |
     | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
     | `block-bluff`（阶梯方巨岩） | 95,538 | **99.93%**（95,464+6） | **0.07%**（68） | 0（0.00%） | 0 | `0.00018 / 0.00033 / 0.02428` |
     | `twin-slab`（双叠断层岩·窄 V 槽） | 76,640 | **99.56%**（76,226+75） | **0.43%**（329） | 9（0.01%） | 1（0.00%） | `0.00026 / 0.00034 / 0.03019` |
   - **双叠断层岩 512 贴图与窄 V 槽 PBR 渲染**：[rock_proto_r2_v3_twin_maps.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_r2_v3_twin_maps.png) · [rock_proto_r2_v3_twin_pbr.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_r2_v3_twin_pbr.png)（橙色缓存回退仅集中在深槽底部极少数尖角碎块边界，未见面积性失效）。
3. **跨引擎实测提前捕获并修复的 2 处底层兼容问题**：
   - **`uv-charts.ts` OpenGL `+Y` 切线手性**：`computeLockedTangents` 改用 `v_gl = 1 - v_gltf` 计算 `tangent.w`，确保法线贴图绿通道遵循 glTF 2.0 / OpenGL `+Y` 向上标准（Three.js Live、`GLTFLoader`、Blender Cycles、FBX 四端一致，不再因 Three.js 自相抵消而隐藏 Blender 上下反光问题）。
   - **`export-fbx.ts` `flipY=false` UV 翻转**：导出 FBX 时若材质主贴图携带 `flipY === false`（glTF 原生自顶向下 UV），自动写出 `v_fbx = 1 - v`，消除 FBX 在 Blender 中贴图上下颠倒。

### 6.2 第二引擎（Blender 4.2.0 Cycles）多格式独立重载验收

使用同一份施加了非均匀缩放 `scale(1.35, 0.82, 1.15) + rotY(0.18)` 的 `block-bluff` 资产，分别导出 **合并 GLB**、**拆分 glTF + 外部 PNG**、**FBX 7.4 + 外部 PNG**，在 **Blender 4.2.0** 无头 Cycles CPU（32 samples + Denoise，匹配左上 3/4 主光）中独立导入审计并渲染多视角与裂纹近景（完整审计 JSON：[blender42_audit.json](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_audit.json)）：

| 导出格式 | 网格与尺寸校验 | BaseColor / Normal / AO 节点链路 | 非均匀缩放裂纹唇边 / UV 接缝视觉 | 独立验收结论 |
| :--- | :--- | :--- | :--- | :--- |
| **合并 GLB** (`507.9 KB`) | `2,550` 顶 / `4,272` 面 / `2.4825×1.7051×1.1848 m` / `customNormals=true` | `BaseColor(sRGB)`→BSDF；`Normal(Non-Color, TANGENT, 1.0)`→BSDF；`AO(Non-Color)`→`SeparateColor.Red`→`Mix`→`glTF Material Output.Occlusion`；`Roughness=0.90, Metallic=0.0` | 左上主光下裂纹下唇受光、上内壁入影方向完全正确；正面/背面无接缝撕裂 | **PASS**（注：Blender 按 glTF 规范将 Occlusion 接入 `glTF Material Output` 供往返导出，Cycles 路径追踪直出不自动将其乘入直接光） |
| **拆分 glTF + PNG** (`5` 文件) | 与 GLB 逐比特一致（`2,550` 顶 / `4,272` 面 / 同尺寸） | 3 张外部 `textures/*.png` 路径与色彩空间（`sRGB` / `Non-Color` / `Non-Color`）及节点链路与 GLB **100% 一致** | 45° 主视角与裂纹近景与 GLB 完全一致 | **PASS** |
| **FBX 7.4 + PNG** (`4` 文件) | 与 GLB 一致（`2,550` 顶 / `4,272` 面 / `2.4825×1.7051×1.1848 m` / `customNormals=true`） | `BaseColor(sRGB)` 与 `Normal(Non-Color, TANGENT, 1.0)` 自动接入 BSDF；**限制①**：FBX Phong 协议无标准 PBR Occlusion 槽，外部 `AO.png` 随包保留但 Blender `io_scene_fbx` 不自动连线；**限制②**：Phong `ShininessExponent` 被映射为 `roughness=0.553`（非 `0.90`），且自动连接 `BaseColor.Alpha→BSDF.Alpha`（不透明图无视觉影响） | 得益于 `flipY=false` V 轴翻转修复，45° 主视角与裂纹唇边方向与 GLB/glTF 视觉一致 | **有条件 PASS（记录上述 2 项 FBX 格式固有局限）** |

- **Blender 4.2 实机渲染对比图**：
  - GLB：[blender42_glb_hero.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_glb_hero.png) · [blender42_glb_close.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_glb_close.png) · [blender42_glb_back.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_glb_back.png)
  - Split glTF：[blender42_split_gltf_hero.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_split_gltf_hero.png) · [blender42_split_gltf_close.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_split_gltf_close.png)
  - FBX：[blender42_fbx_hero.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_fbx_hero.png) · [blender42_fbx_close.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/blender42_fbx_close.png)

### 6.3 造型收硬 + 固定控制变量美术 A/B（低强度定向宽笔触）

1. **灰模造型精修（`src/rock-v2/sdf.ts`）**：收紧阶梯方巨岩主面与肩台转折圆角半径（`kHero/kRim` 下调至 `~0.005`），新增下前斜角切面、底脚局部缺口与多瓣非对称底缘，打破此前偏圆润均匀的底脚弧线，同时保持 `0` 拓扑缺陷（`N=30: 4,272 tris / 54.3 ms`，`N=64: 19,584 tris / 328.2 ms`）：[rock_proto_r2_v3_clay_bluff.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_r2_v3_clay_bluff.png)。
2. **受控美术 A/B 对比（锁定同一网格、同一 Normal、同一 AO、同一相机与灯光，仅切换 `brushMode: 'off'` vs `'subtle'`）**：[rock_proto_r2_v3_art_ab.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_proto_r2_v3_art_ab.png)
   - **45° 主视角与近景**：`subtle` 顺斜向地层叠入暖赭/冷灰褐宽带笔触，主平面层理节奏明显丰富，且无颗粒噪点或伪光照方向冲突（额外 CPU 耗时仅 `+17 ms`：`37.1 ms` vs `20.0 ms`）。
   - **目标游戏视距**：大轮廓、肩台与主裂纹仍占约 90% 的可读性；`subtle` 在主斜面上带来温和的冷暖分层感，而 `off` 更接近极简清透块面。当前在 Rock Studio 实验入口默认设为 `off` 并提供一键切换 `低强度层理宽笔触`。

### 6.4 Rock Studio 单预设 Worker 实验入口接入与实测 P95

- **实现范围**：仅在 `src/rock/main.ts` + `src/rock/rock.css` 底部增加 `🧪 阶梯方巨岩 · SDF 实验` 入口，通过 Vite `?worker&inline` 加载 `src/rock-v2/rock-v2.worker.ts` 与 `RockV2WorkerClient`（拖拽 `input` 跑 `N=30` 预览、松手 `change` 跑 `N=30 / 512 PBR` 烘焙，点击任意 12 套既有预设自动 `cancelAll()` 并零回归退出；未改动 `src/assembly/builder.ts`）。
- **Electron 真实 `file://` (`dist/rock.html`) 自动化基准实测（[rock_worker_bench.json](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_worker_bench.json)）**：
  - **运行模式**：`usingWorker = true`（真实后台 Web Worker 线程，0 条控制台报错），实机全窗截图：[rock_studio_sdf_worker_live.png](file:///C:/Users/ronal/.gemini/antigravity/brain/5947f442-8aa4-425b-aff9-52be407a7a0c/scratch/rock_studio_sdf_worker_live.png)。
  - **连续拖拽首帧延迟（20 次 25 ms 间隔连续滑块拖动）**：首次上屏 **`82.3 ms`**；拖拽全程 `8` 帧真实上屏、合并跳过 `11` 次多余中间事件，**P50 = `81.0 ms` / P95 = `113.7 ms`**（热态最快 `57.9 ms`）→ **拖拽交互达标（`< 150 ms`）**。
  - **松手到 512 PBR 材质可见延迟（6 轮完整松手周期，含前序预览收尾 + 烘焙 + 贴图上传 + SwiftShader 上屏）**：样本 `[1691.3, 1777.1, 2108.9, 2218.5, 1954.1, 1920.1] ms`，**P50 = `1920.1 ms` / P95 = `2218.5 ms`**（其中纯 CPU `rasterAndProjectMs = 1436.6 ms`）→ **诚实记录：当前纯 CPU 512 烘焙在连续编辑松手场景下已超过 `1.0 s` 交互理想线，成为后续优先优化项（如 WebGL2 FBO 烘焙或平面内域快速收敛）的实测依据**。
  - **过期任务不覆盖验证**：提交慢烘焙 `jobA=35 (seed=1111)` 后 40 ms / 70 ms 依次提交 `jobB=36 (seed=2222)` 与 `jobC=37 (seed=3333)`，实测 `jobB` 被合并跳过（`coalescedDelta=1`）、`jobA` 完成后被严格丢弃（`staleDroppedDelta=1`），最终视口与历史记录仅落盘 `jobC=37 (seed=3333)`，过期任务零覆盖。
  - **导出与退出校验**：实验模式下直接 `exportGlb` 生成 `512.6 KB` 标准 GLB；切回 `handpainted-block-bluff` 后 `sdfActiveAfterExit=false`、旧预设面板与网格（`2,470 tris / 16.2 ms`）100% 恢复。
