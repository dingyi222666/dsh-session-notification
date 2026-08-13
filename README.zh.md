# dsh-session-notification

[![npm version](https://img.shields.io/npm/v/@dingyi222666/dsh-session-notification.svg)](https://www.npmjs.com/package/@dingyi222666/dsh-session-notification)

**中文** | [English](./README.md)

一个给 dsh Web GUI 的通知插件：会话跑完、出错、想问你问题、或需要你授权时，都有提示音提醒；离开当前标签页时，还会弹一条系统通知，让你不用一直盯着。

## 截图

| 设置面板——侧边栏里的「**通知**」入口与栏目内容 | 每种类型的音效选择器（官方下拉菜单） |
| --- | --- |
| ![通知设置栏目](screenshots/01-notifications-section.png) | ![音效选择器](screenshots/02-sound-menu-open.png) |

## 安装

```sh
# 从 npm 安装（需要 dsh >= 0.1.0-rc.6）
dsh plugin --profile web add @dingyi222666/dsh-session-notification
# 重启 dsh web 后生效
dsh web
```

一切都在插件自身实现——不依赖 harness（宿主）的任何改动：

- 设置栏目通过客户端 slot 系统（`settings.section`）注册，与官方栏目做法一致。
- 偏好存在浏览器本地（localStorage）并跨标签页同步；不需要宿主的 `WEB_SETTINGS_NAMESPACES` 或任何其他宿主包改动。（Node 半区仍通过 settings 服务在宿主侧保留 `dsh-session-notification` 命名空间，未放行时它只是占位、无副作用。）
- 设置外壳只给它自己认识的栏目 id 配导航图标，所以「通知」导航行显示的是外壳默认的齿轮。

## 四种通知类型

| 类型 | 触发时机 | 默认音效 |
| --- | --- | --- |
| 会话完成 | 一轮会话正常结束（`turn/end` completed） | 叮咚 |
| 会话失败 | 一轮会话出错中断，或宿主上报 agent 错误 | 低鸣 |
| 问问题 | Agent 正在等你回答（`question/requested`） | 轻响 |
| 权限请求 | Agent 请求执行需要授权的操作（`approval/requested`） | 警示 |

每种类型都可以单独开关，也可以把提示音换成四种内置音效中的任意一种（或静音）。四种音效全部用 Web Audio 实时合成——不携带任何音频文件——整体音量用官方风格的滑块调节。

## 自定义音频

除了四种内置音效，每种类型还可以**上传你自己的音频文件**（mp3/ogg/wav，最大 1 MB）：在对应类型那一行点「自定义音频」上传，之后该类型就用它代替内置音效——支持「更换」和移除，并显示「已使用自定义音频」标签。自定义音频存在浏览器本地（音频属于设备资源，不放进共享偏好）。

## 浏览器通知与「不打扰」默认

浏览器（系统级）通知**默认关闭**；打开开关时会先向浏览器申请授权（需要一次点击手势）。授权后，当事件所属的会话不是当前正在读的会话、或标签页在后台时，才会弹系统通知。**通知使用网页自身的图标**（harness 提供的 favicon）。**完成的会话，通知正文会带上它的最终回复文本**（最后一条 assistant 消息）；「测试通知」按钮可以在授权后立即验证系统通知通道。**默认不打扰你正在读的会话**——它的动静不会打断你；想要它也有提示的话，打开「当前会话也提醒」开关即可。

## 通知设置栏

插件在设置面板注册了一个「**通知**」栏目（设置 ⚙ → 通知）：

- **浏览器通知**总开关（含授权状态与「授权」按钮），
- **当前会话也提醒**开关（开启后正在看的会话完成、出错时也会响），
- **提示音**总开关，
- **音量**滑块，
- 每种通知类型一行：启用开关、自定义音频上传、音效选择（官方下拉菜单）、以及「试听」按钮，
- 浏览器通知行上的「测试通知」按钮（授权后一键验证系统通知通道）。

偏好保存在**浏览器本地**（localStorage）的 `dsh-session-notification` 键下——无需宿主放行任何设置命名空间——跨会话持久化、跨标签页同步，完全不依赖宿主改动。

## 工作原理

浏览器端监听会话列表快照和每个会话的对话快照——无需轮询、无需新增链路：

- 会话 `running` 由 true→false 表示一轮运行结束；运行期间若出现了新的 `turn-error` 节点或宿主 `agent-error`，判定为**失败**，否则为**完成**（被重试挽回的失败按完成处理）。
- 待交互边沿出现 `question` / `approval` 时，触发问问题 / 权限请求通知，正文带问题文本或工具名+原因。
- 插件加载时已经空闲（或已经在等待交互）的会话不会触发任何通知。

## 开发

- `yarn run build` —— 构建浏览器包（`lib/client.js`）与 Node 半区（`lib/index.js` / `lib/invariant.js`）。
- `src/client/notification-service.ts` —— 引擎（事件判定）与分发器（开关/音效/通知门控）；`src/client/settings-store.ts` —— 设置栏桥接；`src/client/NotificationsSection.tsx` —— 设置栏 UI；`src/client/sounds.ts` 与 `src/client/custom-audio.ts` —— 内置与自定义音效。
- `yarn test` —— 行为测试；`yarn run typecheck` —— 类型门禁。
- Node 半区改动需要重启 `dsh web`；浏览器包改动重新 `yarn run build` 即可（`--dev` 模式会自动热更新）。

## 已知限制

- 失败判定读取会话的对话快照，而客户端只为「打开过」的会话维护快照；从未打开过的会话若运行失败，会按「完成」通知。
- 浏览器通知需要授权，声音播放需要页面获得用户激活（浏览器自动播放策略）——浏览器应用的常态，用户与界面交互一次即可解决。
- 自定义音频存在浏览器本地（localStorage），不会跨浏览器或跨 profile 同步。
- 浏览器端是基于会话列表快照的事件驱动，不直接读原始事件流；理论上两次快照之间开始又结束的运行可能漏报（宿主对每个边沿都会下发状态帧，实际不会发生）。

## 模型体验

无。插件是纯客户端观察者，只读已记录的会话状态，不会进入任何模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。
