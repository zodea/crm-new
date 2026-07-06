# OCR 识别策略：能用哪些 · 省钱 · 是否必联网 · 是否泄漏

> 调研+定案日期：2026-07-05（2026-07-05 依"用 PaddleOCR-VL 解决"修订为单模型方案）
> 关联：移植方案 `invoice-recognition-app-port-plan.md`、UX 基准 `ocr-ux-benchmark.md`、决策 `docs/adr/0006-ocr-paddleocr-vl-single-model.md`
> 背景：用户成本敏感 + 隐私敏感（真实发票/送货单含税号/金额/公司名）+ 要打磨质量；环境 macOS Apple Silicon。

> **架构收敛**：本版把初版的"三层多引擎（PP-OCRv6 + 本地文本LLM + 独立视觉LLM）"收敛为**单一 PaddleOCR-VL（0.9B）+ 规则正则**。一个模型全包 OCR+表格+手写+版面，"多模型互相干扰"问题消失。

---

## 0. 直接回答你的四个问题

**① 能用哪些？** —— **一个模型搞定：PaddleOCR-VL-1.6（0.9B 多模态）**。图 → OCR + 表格 + 公式 + 手写 + 版面结构（Markdown + 版面区域），再用**规则正则**（现成 `vl-parse.js`/`invoice-parse.js`）抽出字段。文档解析质量 **> GPT-4o**（OmniDocBench 1.5 达 94.5%）。
- **本地自托管**（主）：Apple Silicon 上 **MLX-VLM**（最快）或 `llama.cpp`，Apache-2.0、离线、零泄漏。0.9B 极轻。
- **云端 aistudio**（仅开发期）：登录免费不限次，但数据到百度云 + 浏览器 CORS —— 只跑脱敏/样例图。

**② 用了 LLM 是否一定要联网？** —— **不必。** PaddleOCR-VL 本地自托管：**首次下模型权重联网一次，之后推理 100% 离线、拔网线照跑**。只有"用云端 aistudio 兜底"才需联网，且仅开发期。

**③ 这个 LLM 是否有泄漏可能？** —— **本地自托管 = 无泄漏面**（数据不出机器、无第三方留存/训练风险，Apache-2.0 全本地）。**云端 aistudio = 数据到百度云**（有泄漏面，真实财务数据别走）。故：**真实发票默认全走本地，零泄漏**；云端只在开发期用脱敏图。

**④ 省钱到什么程度？** —— 本地自托管**开源免费、推理边际成本 0**，唯一成本是你 Mac（0.9B 极轻，门槛低）。
> ⚠**反转澄清**：即便云端视觉大模型也**很便宜**（§5：Qwen-VL-Max ≈ $0.0003/张、aistudio PaddleOCR-VL 登录后免费不限次）。所以"是否收费"不是真障碍——**默认留本地的理由是隐私（数据出机器），不是钱。**

---

## 1. 推荐管线（单模型，默认本地离线）

```
┌─ 引擎（一个模型全包）────────────────────────────────────────┐
│  PaddleOCR-VL-1.6（0.9B 多模态）                                │
│    图 → OCR + 表格 + 公式 + 手写 + 版面区域 → 结构化 Markdown    │
│                                                                │
│  部署（主）本地自托管：MLX-VLM（最快）/ llama.cpp（兼容广、可纯CPU）│
│           → 离线、零泄漏、Apache-2.0、0.9B 极轻                  │
│  部署（仅开发期）云端 aistudio：登录免费不限次，仅脱敏/样例图      │
└────────────────────────────────────────────────────────────────┘
                          ↓ Markdown + 版面区域
┌─ 结构化（规则为主）──────────────────────────────────────────┐
│  规则正则(A)  现成 vl-parse.js / invoice-parse.js：              │
│              Markdown(含HTML表格) → 发票号/金额/税号/明细行      │
│  可选兜底(B)  极个别怪版式才用本地 Ollama qwen2.5，默认不启用     │
│  校验        金额=单价×数量、税号位数/校验位，输出置信度         │
└────────────────────────────────────────────────────────────────┘
                          ↓ 结构化字段 + 版面区域
       校对界面：点字段↔高亮原图（用 VL 版面区域，块级）
```

**"多模型互相干扰"问题消失**：稳态就一个 0.9B 模型常驻，轻、无需 Ollama 内存调度/模型切换。手写送货单同一个 VL 模型识别（手写仍是分水岭，保留人工复核）。

---

## 2. 引擎选型：PaddleOCR-VL 版本与后端

**版本（全系 0.9B，无尺寸取舍）**：

| 版本 | 时间 | 要点 |
|---|---|---|
| PaddleOCR-VL-0.9B | 2025 | 首发，OmniDocBench SOTA、> GPT-4o |
| PaddleOCR-VL-1.5 | 2026-01 | OmniDocBench 94.5%；训练 29M→46M 对；强化复杂表格/公式/边框表/发票/生僻字；手写中文 0.895/英文 0.916 |
| **PaddleOCR-VL-1.6** | 2026-06 | **最新**，补 1.5 残余短板；**源项目 `ocr-vl.js` 已用此版** |

→ **默认用 1.6**（与源码对齐），1.5 为稳定回退。

**Apple Silicon 后端**（VL 支持 vLLM/SGLang/FastDeploy/MLX-VLM/llama.cpp）：

| 后端 | 适用 |
|---|---|
| **MLX-VLM**（推荐） | Apple Silicon 首选，<14B 比 llama.cpp 快 20–87%，0.9B 极快；单用户本地服务 |
| **llama.cpp** | 兼容最广、可纯 CPU、无 CUDA；边缘/老机回退 |
| FastDeploy / vLLM / SGLang | 服务端/多并发（本项目单用户用不上） |

**云端 vs 本地对照**：

| | 云端 aistudio | 本地自托管 |
|---|---|---|
| 数据 | 到百度云（有泄漏面） | 不出机器（零泄漏） |
| 联网 | 必须 | 首次下模型后可离线 |
| 浏览器 dev | 有 CORS（需代理） | 无 CORS（localhost） |
| 成本 | 登录免费不限次（额度可变） | 开源免费、零边际成本 |
| 上手 | 一键最快 | 需装一次（0.9B 轻） |
| 用途定位 | **仅开发期脱敏图** | **交付/真实财务数据** |

---

## 3. 硬件门槛（0.9B 极轻，门槛大降）

> ⚠**待你确认**：你的 Mac 是哪款、多少内存？定 MLX vs llama.cpp 及是否量化。

- PaddleOCR-VL 仅 **0.9B**，远小于 7B 级模型，Apple Silicon **M4 已官方验证**；MLX-VLM 后端最快。
- 相比初版三层方案要 16GB 跑 7B，**本方案硬件门槛大幅降低**——0.9B 单模型，普通 M 系 Mac 即可，无需为多个 7B 模型留内存。
- 单张单据结构化耗时量级：小模型，视图像分辨率而定（分辨率对精度/耗时都敏感，需调参）。
- 参考实现 [`CHEN010325/paddleocr-local`](https://github.com/CHEN010325/paddleocr-local)：PaddleOCR-VL + PP-OCRv6、Docker、按需切换、**带原图对齐可视化**（可借鉴其部署与高亮对齐）。

---

## 4. 云端 aistudio 用于开发期时的注意

1. **仅脱敏/样例图**：开发期用云端 aistudio（登录免费、一键）跑通交互，**禁止喂真实发票**（数据到百度云）。
2. **凭证安全**：aistudio token 只 localStorage，不进库/代码/git。
3. **CORS**：浏览器 dev 直连云端会被 CORS 挡（源项目靠 vite 代理/Tauri Rust）；本地自托管无此问题。
4. **切换零成本**：`ocr-vl.js` 只需把 base 在 云端端点 ↔ 本地 MLX/llama.cpp server 间切换，协议一致。
5. 若确需云端处理真实数据（不建议）：避免免费层（可能用于改进），优先企业零留存端点，先出文本只传文本、脱敏。

---

## 5. 云端视觉大模型定价（2026-07，参考；本方案本地为主，云端仅开发期）

> 结论：云端很便宜，**成本不是选型障碍**；本地优先是隐私驱动。

- **aistudio PaddleOCR-VL**：登录后免费不限次（未登录试 3 次），可申请提额；企业级 API 另有服务。
- 通用视觉大模型 per-image（约1MP）：**Qwen-VL-Max ≈ $0.0003**、**Gemini Flash 最便宜**（$0.075/M 输入·$0.30/M 输出含图）、**GPT-4o ≈ $0.002–0.01**、**Claude Sonnet ≈ $0.0040**。每月 500–2000 张走便宜档仅几毛到几块钱。
- **免费额度**：DashScope 新账号送 1M 输入+1M 输出 token；⚠**Google 免费 AI Studio 会用于训练+人工审阅，财务数据绝不能走**。
- 各家图像 tokenization 差 5×（同图 Gemini 258 vs Claude 1334 token）。

---

## 6. 开放项 / 待补（保留供检查）

1. **你的 Mac 机型 / 内存**（§3）：定后端与量化。
2. **本地 PaddleOCR-VL 手写实测**：中文潦草手写送货单质量需抽样验证；手写是全行业分水岭，**保留人工复核**，金额/数量务必人工核。
3. **版面区域→字段级高亮粒度**：VL 输出块级 layout 区域，"点字段↔高亮原图"块级可行，字段级看 layout 细度，需实测（参考 paddleocr-local 的对齐）。
4. **本地部署一次性搭建**：装 MLX-VLM / llama.cpp + 下 PaddleOCR-VL-1.6 权重（首次联网），暴露本地 server 供 `ocr-vl.js` fetch；桌面态可 Tauri sidecar。

---

## 7. 三项前置决策的现状（对齐移植方案 §7）

1. **云VL CORS** → **已解**：改本地自托管 PaddleOCR-VL，走 localhost 无 CORS；云端 aistudio 仅开发期脱敏用。
2. **本地引擎选型** → **已定**：PaddleOCR-VL-1.6（单模型），MLX-VLM 后端；不再用 `@paddlejs-models/ocr`，也不需 PP-OCRv6+Ollama 三层。
3. **送货单工地名→project 绑定** → 仍待定（数据模型决策，与 OCR 引擎正交，见送货单 PRD）。

---

## 云端定价来源（2026-07 查询）

- [pricepertoken · Qwen VL Max](https://pricepertoken.com/pricing-page/model/qwen-qwen-vl-max) · [Gemini API pricing（官方）](https://ai.google.dev/gemini-api/docs/pricing) · [Alibaba Cloud Model Studio 定价（官方）](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [aistudio PaddleOCR 官方](https://aistudio.baidu.com/paddleocr) · [PaddleOCR-VL Apple Silicon 教程（官方）](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/PaddleOCR-VL-Apple-Silicon.html) · [PaddleOCR-VL-MLX](https://huggingface.co/gamhtoi/PaddleOCR-VL-MLX)

> 定价与政策随时变动，选型请以厂商官方页与你签署的 DPA 为准。
