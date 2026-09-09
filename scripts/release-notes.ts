/**
 * Hand-written, per-version release notes for dsh-session-notification. The
 * GitHub release body is built from these (see release-body.ts): 新特性 and
 * 修复 & 改进 sections come from here verbatim; What's Changed is derived
 * mechanically from the commit range.
 *
 * Every entry is a complete markdown bullet (`- **<scope>**: ...`) so the
 * body builder can splice the arrays in directly.
 * @module dsh-session-notification/release-notes
 */

export interface ReleaseNotes {
  features: readonly string[]
  fixes: readonly string[]
}

/**
 * Version -> hand-written notes, keyed without the `v` prefix.
 * A version missing from this map cannot be released: release.ts and
 * backfill-releases.ts both fail loudly.
 */
export const RELEASE_NOTES: Record<string, ReleaseNotes> = {
  '0.1.0': {
    features: [
      '- **通知功能**: 会话完成/出错/提问/权限请求四类事件,浏览器本地偏好(设置 → 通知),零宿主改动',
      '- **浏览器通知**: 离开标签页时弹系统通知,含诚实的权限状态(已授权/已拒绝/不支持/暂停)与一键授权按钮',
      '- **测试通道**: 通知行内「测试通知」按钮,授权后立即验证系统通知通道',
      '- **网页图标**: 通知使用网页自身的 favicon(apple-touch-icon → rel=icon 回退)',
      '- **提示音**: 四种内置音效(叮咚/低鸣/轻响/警示)Web Audio 实时合成,零音频文件;每种类型可独立开关与选音',
      '- **安装方式**: 支持 npm / npx dsh / git 仓库 / dsh plugin 多种安装,补齐前后对比截图',
    ],
    fixes: [
      '- **通知权限**: 通知权限被拒或浏览器不支持时如实展示状态,不再静默失败',
    ],
  },
  '0.1.1': {
    features: [
      '- **音量范围**: 音量支持 0–200%,可放大内置提示音',
    ],
    fixes: [
      '- **发布名**: 改用完整包名做模块 id 与 bundle patch,插件可被 profile 正确加载',
      '- **文档**: README 拆分中英单语,截图移到安装说明前并排展示',
    ],
  },
  '0.1.2': {
    features: [],
    fixes: [
      '- **依赖升级**: 依赖迁移至 dsh 0.1.1-rc.2,移除已删除的 web-react,类型自包含',
    ],
  },
  '0.1.3': {
    features: [
      '- **响度增益**: 撤销 0–200% 音量方案——改用固定响度增益(约 +6 dB)加软限幅器,音量刻度回到 0–100%,声音更响且不削波',
    ],
    fixes: [],
  },
  '0.1.4': {
    features: [],
    fixes: [
      '- **harness 大更新适配**: 适配 dsh 0.1.2-alpha.1(客户端运行时拆分、会话绑定/uiConversation 重构等数据模型迁移)',
    ],
  },
  '0.1.5': {
    features: [],
    fixes: [
      '- **模块表**: 按 alpha 平台模块表加载——移除过时的 runtime/client external,bundle 只要求平台种子模块',
    ],
  },
  '0.1.6': {
    features: [],
    fixes: [
      '- **类型来源**: 全部 @deepseek-ai 类型改从 npm 解析(不再指向本地源码路径),与 0.1.2-alpha.2 一致',
    ],
  },
  '0.1.7': {
    features: [
      '- **官方控件**: 通知设置采用官方单选下拉(Selector pill)与官方 Button 组件,行布局对齐通用设置的 Setting-Cell 规范',
    ],
    fixes: [
      '- **完成通知复活**: 适配 0.1.2-alpha.2 数据模型——会话快照不再携带 chat 视图与 pendingInteraction,改读 uiConversation chat target 与 uiSession pending map;此前对话完成不再提醒的问题修复',
      '- **依赖升级**: @deepseek-ai 依赖升至 0.1.2-alpha.5',
    ],
  },
  '0.1.8': {
    features: [
      '- **只提醒主会话**: 默认只提醒主会话,并行展开的一堆子会话(subagent)不再每个都响一次;设置 → 通知 →「只提醒主会话」开关可随时关闭,关闭后所有子会话也提醒',
    ],
    fixes: [],
  },
  '0.1.9': {
    features: [],
    fixes: [
      '- **harness 0.1.3-alpha.1 适配**: dsh-client-runtime 已解散——会话/对话/待交互类型改从 api-session-controller、ui-conversation、ui-session 客户端解析;客户端注入种子更新(按实际消费的服务列 provider 包、移除 runtime),删除失效的 dshClient 旧键',
      '- **设置作用域契约**: SettingsScope 契约迁至 dsh-client-ui-settings(client 面新增 mutate);本地偏好作用域补齐 mutate(路径化 set/unset),新增相应单测;宿主半区 settings.register 在 0.1.3-alpha.1 类型下原样通过',
    ],
  },
  '0.1.10': {
    features: [],
    fixes: [
      '- **依赖升级至 0.1.3-alpha.2**: @deepseek-ai/dsh-* 依赖升到 ^0.1.3-alpha.2(npm 已发布);tsconfig 的本地检出路径映射全部移除,类型恢复从 node_modules 解析;alpha.1→alpha.2 的差异(连接恢复配置、会话事件校验等)不影响本插件的 API 面,代码零改动',
    ],
  },
  '0.1.11': {
    features: [],
    fixes: [
      '- **依赖升级至 0.1.5-alpha.2**: @deepseek-ai/dsh-* 依赖升到 ^0.1.5-alpha.2(alpha 通道最新);0.1.3-alpha.2→0.1.5-alpha.2 跨度虽大(约 774 提交),但插件消费的 API 面保持稳定——平台模块表仅新增 dockkit 种子(插件未用),settings.section 席位与 inject/external 语义均无变化,代码零改动,typecheck/96 specs/build 全绿',
    ],
  },
  '0.1.12': {
    features: [
      '- **多标签页只响一次**: 同一次完成/提问/权限事件在所有同源标签页之间只提醒一次——标签页通过 BroadcastChannel 仲裁,先到者得;你正在看的那个标签页优先,后台标签页让位,不再因为开着多个 dsh 页面而每个页面各响一遍(不同事件仍各自提醒;不同端口/实例的页面互不影响)',
    ],
    fixes: [],
  },
}
