# 题库来源与修改说明

## TurtleBench

- 上游：Duguce/TurtleBench1.5k（TurtleBench 数据集）
- 来源：https://huggingface.co/datasets/Duguce/TurtleBench1.5k
- 固定版本：`b8fb15b4246755902c5f9562afcbc0e37a68703e`
- 文件：`chinese/staging/stories.json`，32 道中文故事；未导入用户猜测记录。
- 取得日期：2026-09-22。
- 上游版权声明：Copyright 2023-2024 IAAR, Shanghai
- 上游 LICENSE 和数据卡均为 Apache License 2.0；许可证原文保存在 `../licenses/TurtleBench-LICENSE`。
- 数据集论文作者：Qingchen Yu、Shichao Song、Ke Fang、Yunfeng Shi、Zifan Zheng、Hanyu Wang、Simin Niu、Zhiyu Li。
- 论文：TurtleBench: Evaluating Top Language Models via Real-World Yes/No Puzzles，arXiv:2410.05262（2024）。

本项目根据上述发布许可导入，未独立核实每个流传故事的原始作者或完整授权链；不声明这些故事为本项目原创。如发现权属问题，请通过仓库 Issue 提供题目 ID 和证据。

## 修改范围

`data/turtlebench.json` 是衍生数据，继续按 Apache-2.0 提供，不适用根目录 MIT 对项目自有代码的许可声明。

- 将 `bottom` 重命名为 `truth`，增加稳定 ID、来源索引和来源说明。
- 逐题补充三个关键事实、三级提示、推荐问题、无剧透简介、内容标签、类型和难度。
- 类型、难度、预计用时、提示及评分要点由本项目整理，非原数据集官方标注或经过实测的评分。
- `tb-04`《日记》：删除原文现实人物、作品、事件和具体日期，改成明确标注的虚构故事；不传播原文中的现实人物指控。
- `tb-05`《粉色连衣裙的女人》：保留身份误认的结构，移除把穿衣偏好病理化及作为独居必然原因的措辞。
- `tb-08`《四岁的妈妈》：保留成年人被误认成孩子的设定，移除未经说明的疾病判断及外貌污名措辞。
- 其余 29 道保留原始汤面和汤底文本。每道题的 `adaptation` 字段记录修改，在揭晓页面显示。

故事仅用于虚构推理游戏。可能包含死亡、自伤、暴力、囚禁等敏感内容，不应作为现实事件解释或行为指引。列表显示内容标签，可选择「只看无敏感标签」；标签不等于正式年龄分级。

## 项目自带故事

`data/originals.json` 保存原有三道题目，随本项目按 MIT License 提供。导入外部题库不改变其授权。
