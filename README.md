# 训练助手

私人训练记录 App：练完用一句话或一张照片告诉它，它自动整理成训练记录、饮食和身体数据，帮你看力量有没有进步、减脂或增肌的速度合不合适。数据只存在你自己的 Cloudflare 账号里，免费部署，iPhone 上可以像普通 App 一样添加到主屏幕。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Kaixin336/training-assistant)

## 能做什么

- **一句话或拍照记录**：“卧推 40kg 3x10 最后一组吃力”“体重 55.2”，或拍一张饭菜、手表运动截图、器械屏幕，AI 自动整理。
- **固定饮食计划**：把你的饮食计划（图片或文字）发给 AI，它整理成训练日和休息日的三餐。之后每天默认按计划算，吃了别的再告诉它，只替换那一餐。
- **今天页**：左上角一键切换训练日/休息日，显示当天的三餐和热量、蛋白质目标；每个动作显示上次成绩和“今天的目标”；破纪录会提醒。
- **力量**：每个动作的进步曲线、力量水平（按体重对比常见标准）、平台期提醒。
- **周报**：训练日历、各肌群每周组数、训练负荷、什么时候该减载，AI 点评。
- **身体**：体重 7 日均值、腰围、减脂/增肌速度、按体重变化反推的真实消耗、14 天饮食复盘。
- **Apple 健康 / Apple Watch**：用 iPhone 自带的“快捷指令”每晚自动同步步数、体重、腰围、心率识别的运动、HRV、静息心率、睡眠（App 里有逐步说明）。
- **浅色 / 深色**、离线待发送、每周自动备份到 iCloud。

## 部署（大约 10 分钟，只需要做一次）

1. 注册一个免费的 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)。
2. 点上面的 **Deploy to Cloudflare** 按钮，用 GitHub 登录并授权。
   - 仓库名可以不改，建议选 **Private（私有）**。
   - **OWNER_ACCESS_KEY**：自己设一个访问口令，至少 20 个字符（字母和数字），记下来。
   - **DEEPSEEK_API_KEY**：DeepSeek 的 API key（`sk-` 开头）。没有的话可以先留空，之后在 App 的“设置 › AI 助手”里填。
   - 其他选项保持默认，点部署，等几分钟。
3. 部署完成后打开页面上显示的地址（类似 `https://training-assistant.你的名字.workers.dev`），输入访问口令。
4. iPhone 上用 Safari 打开这个地址 → 分享 → **添加到主屏幕**，以后从桌面图标打开。

## 开始使用

1. **设置 › 训练阶段**：选减脂、维持或增肌，以及开始日期。
2. **设置 › 个人目标**：选“力量水平参考”（女性/男性标准），其余目标可以不填。
3. **今天页**：把你的饮食计划发给 AI，说“这是我的饮食计划”。
4. **设置 › Apple 健康**：按页面上的步骤做一个“同步健康”快捷指令，每晚自动同步。

## 费用和隐私

- Cloudflare 免费额度对个人使用绰绰有余，不需要绑卡。DeepSeek 按调用量付费，个人使用一个月通常只要几块钱。
- 所有记录、照片和健康数据只保存在你自己的 Cloudflare 账号里。访问口令和 API key 以加密的 Secret 保存在 Cloudflare，不在代码里。
- 照片只有在你主动发给 AI 识别时才会发送给 DeepSeek。

## 开发者

```bash
npm install
npm run dev          # 本地运行（自动生成本地口令，保存在 data/access-key.txt）
npm run test:core    # 纯逻辑测试
npm run test:runtime # 服务端集成测试
npm run deploy       # 手动部署（需先 wrangler login，并在 wrangler.json 填入自己的 D1 database_id）
```

技术栈：React + Vite 前端，Cloudflare Workers + D1（SQLite）后端，DeepSeek 负责理解文字和照片。
