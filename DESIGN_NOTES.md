# 银昼 / 蓝夜视觉设计

本次以用户提供的银白发人物和深蓝发人物为主题依据，保留「清蒸排班」原有名称及排班功能。

## 布局

- 顶部改为一整幅插画手札封面：左侧保留标题与说明，右侧以人物、独立绘制的 SVG 场景和主题题签组成画面。桌面场景约 215–235 像素高；手机约 185 像素高。
- 当前方案、保存方案和编辑排班集中在封面下方的独立工具栏，始终有实色背景。
- 今日班次、周期进度、下次工作和上下班倒计时放入一条横向信息栏。手机上转换为两列，减少顶部纵向堆叠。
- 月历是主区域，桌面宽度约占主体的四分之三；统计与近期安排在右侧。窄屏按阅读顺序转为单列。
- 月度计数、计划工时和工作日占比合为一个统计面板。
- 未来七天与日期详情共享侧栏位置；点击日期时保持月历网格不重建。
- 年度总览默认折叠，需要时展开。仍可点击月份或其中的日期跳转。

## 人物与主题

- 银昼「银翼手札」：珍珠白、灰紫与冰蓝，搭配银翼、双层拱廊、银饰圆环和切面冰晶，对应银白人物。
- 蓝夜「深蓝夜航」：深海蓝、雾蓝与黄铜，搭配弦月、星图、轨道、波浪和尾鳍，对应深蓝人物。
- 人物集中在顶部独立的装饰区；不覆盖日历、信息栏、统计、按钮或输入区域。插画不接受鼠标事件，装饰图对屏幕阅读器隐藏。
- 默认跟随设备本地时间：07:00–19:00 为银昼，其余时间为蓝夜。旧的手动主题偏好优先保留；时钟按钮可重新启用自动模式。
- 两张插画在切换主题时柔和交替。前台使用透明 WebP，合计约 245 KiB；保留透明通道和不透明的白色服饰，避免深色主题出现白底矩形。

## 从服饰延伸的界面元素

两套主题分别绘制了原生 SVG 纹样与饰扣，应用在背景边缘、卡片边框、分隔线、进度条和日期徽章中。

| 部位 | 银昼 | 蓝夜 |
| --- | --- | --- |
| 顶部人物衬景 | 银翼、双层拱廊、银饰圆环、切面冰晶 | 弦月、星图、轨道、海浪和尾鳍 |
| 页面边缘 | 淡鳞片纹、局部银翼轮廓 | 淡金色枝叶刺绣和页脚水波 |
| 月历与侧栏卡片 | 局部珠链、银结、菱形吊坠、压印式角饰 | 连续蕾丝滚边、蝴蝶结、黄铜缝线、尾鳍角饰 |
| 今日概览 | 银紫织带、局部鳞纹 | 雾蓝缎面、黄铜织带与局部刺绣 |
| 周期进度 | 银结饰扣 | 尾鳍形饰扣 |
| 今日与选中日期 | 银紫胸针式圆章、菱形标记 | 带黄铜边的缎面方章、金色纽扣标记 |
| 操作按钮 | 银紫描边与不对称圆角 | 黄铜描边与深蓝缎面 |

装饰层不接受指针事件，独立图形对屏幕阅读器隐藏。主内容使用实色底，纹样集中在边框和空白区域；小屏会缩小边饰，保留日期、班次及按钮的空间。主题样式集中在 `assets/themes.css`，纹样文件为 `silver-scales.svg`、`silver-pearl-trim.svg`、`night-lace.svg` 与 `night-embroidery.svg`；结饰、蝴蝶结、翼形和尾鳍符号以内联 SVG 保存，直接打开 HTML 时也能使用。

新增的 `silver-atrium.svg` 和 `tidal-observatory.svg` 为手工绘制的本地矢量场景。标题和月份采用本地楷体 / 衬线字体，功能文字保持原有字体。切换主题会同步改变场景、饰环、浮动粒子、纹样、材质与日期选择状态。

## 动效

- 内容分组进入：约 600 ms，轻微上移，分组错开出现。
- 切换月份：约 260 ms，方向随前进、后退变化。
- 日期详情与七天列表：约 330 ms，短距离淡入。
- 设置与年月弹窗：约 280 ms，轻微缩放及淡入。
- 人物缓慢上下移动 3 像素，周期 8 秒；星点和周期进度条使用低频光效。
- 顶部饰环 90 秒旋转一周；银昼冰晶与蓝夜气泡以 8 秒为周期上下移动，彼此错开相位。
- 蓝夜背景水波缓慢往复移动，周期 18 秒；正文和日期格不随装饰运动。
- 遵守 `prefers-reduced-motion`。开启减少动态效果后，CSS 装饰动画和 JavaScript 过渡都不运行。

## 素材来源与处理

输入为用户在本聊天中提供的两张人物图。使用内置 imagegen 的透明背景编辑模式处理，随后仅做网页尺寸缩小和 WebP 编码；原始处理结果另存在本机 `.backup/character-cutouts/`，不作为站点资源发布。

实际使用文件：

- `assets/character-day.webp`，503 × 900。
- `assets/character-night.webp`，506 × 900。

使用的提示词原文如下。

### 银昼人物

> Use case: background-extraction. Edit target: attached white-haired fantasy character. Remove ONLY the plain white background, producing a clean fully transparent RGBA PNG cutout. Preserve the original entire character exactly: face, eyes, white/silver hair, lilac horns, dress, wings, dragon tail, feet, small blue floating creature, all line art, original pose and original colours. Do not redraw, redesign, add details, crop, or add ground/shadows/text. Keep white clothing and white hair opaque. Maintain the same full-body vertical composition. Intended use: a small decorative character illustration in a functional schedule/calendar web app. Output actual alpha transparency, no checkerboard.

### 蓝夜人物

> Use case: background-extraction. Edit target: attached blue-haired anime maid character in navy dress. Remove ONLY the plain white background, producing a clean fully transparent RGBA PNG cutout. Preserve the original full character exactly: face, eyes, blue hair and strands, headband, navy dress, opaque white apron and lace, hands, fluked tail, legs and shoes, original pose and original colours. Do not redraw, redesign, crop, add objects, ground, shadows, text or a checkerboard. Keep the white apron and all white clothing opaque. Maintain the same full-body vertical composition. Intended use: a restrained decorative illustration for a dark navy calendar website. Output actual alpha transparency.

## 验证

自动回归检查共 30 项，包含新增的未来七天跨月跳转、侧栏详情切换、自动昼夜边界、手动偏好保留和减少动态效果。

本轮在真实浏览器中检查了 320、390、768、1024、1440 像素宽度下的两套主题：没有页面横向溢出、图片加载失败、标题与人物区域冲突或装饰遮挡控件；设置、日期详情、切月和年度展开均可操作；减少动态效果时没有持续运行的动画。预览和布局报告保存在本机 `.qa/`，不作为网页资源发布。

本次不修改排班算法、历法数据及已有配置格式。新增 `qingzheng-theme-mode` 用于保存自动或手动主题选择。
