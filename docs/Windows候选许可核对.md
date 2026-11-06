# Windows 候选版依赖许可核对

- 本表为工程核对记录，不代表已完成全部分发条件审查。候选包不得因仅有许可证类别字段而认定声明齐全。
- Sign-in with ChatGPT DevKit：项目内 `project/vendor/siwc/LICENSE` 为非商业许可；分发需同时满足其重分发条件并保留第三方声明。商业用途未获该许可授权。
- Electron：候选运行目录含上游 LICENSE 和 LICENSES.chromium.html。
- `@earendil-works/pi-ai` 与 `@earendil-works/pi-telemetry` 1.4.0：包元数据声明 MIT，包内未见独立许可证；上游相同版本仓库根目录有 MIT 许可，见 https://github.com/earendil-works/pi/blob/v1.4.0/LICENSE 。已在 `project/licenses/pi-1.4.0-MIT.txt` 留存原文，组装脚本会附入候选；适用范围仍需完整核对。
- `standardwebhooks` 1.1.1：包元数据声明 MIT，独立许可证缺失；上游仓库当前根许可证与包声明不一致，须定位对应发布版本及子目录许可，暂不认定完整。
- `proxy-agent-negotiate` 1.1.0、`format` 0.2.2：元数据声明 MIT（format 使用旧字段），未发现独立许可证，仍须核对相应声明。`data-uri-to-buffer` 4.0.1 虽无独立许可证文件，但其随包 README 包含版权和完整许可，见下方版本核对。
- `@aws-sdk/credential-provider-http` 3.972.78、`@aws-sdk/nested-clients` 3.997.50、`@aws-sdk/credential-provider-login` 3.972.83：元数据声明 Apache-2.0；已从随包 AWS SDK 依赖保留 Apache 2.0 全文并纳入组装，但仍须核对这三个具体版本的版权和 NOTICE。
- 其余包存在可识别许可或 NOTICE 文件，但仍需确认实际分发内容与声明覆盖范围；依赖清单不是完整法律审核。

- 关联路径核对：standardwebhooks 由 pi-ai 的 Anthropic SDK 引入，proxy-agent-negotiate 由 pi-ai 的代理依赖引入，AWS 包由其 Bedrock 相关依赖引入；不能仅因当前界面未使用对应服务就直接排除。Standard Webhooks 上游 JavaScript package.json 当前仍声明版本 1.1.1 和 MIT（https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/package.json），但根许可为 Apache-2.0；版本对应的完整声明仍待核查。

## 引入关系与内容核对（2026-11-06）

- `standardwebhooks@1.1.1` 由 pi-ai 的 `@anthropic-ai/sdk` 引入；`proxy-agent-negotiate@1.1.0` 由 pi-ai 的 HTTP/HTTPS 代理依赖引入；AWS 包由 pi-ai 的 Bedrock 依赖树引入；`data-uri-to-buffer@4.0.1` 经 Google 认证依赖引入；`format@0.2.2` 经 Markdown 解析依赖引入。
- 对内部候选 aIJzoa 按 package.json 比对复制后的包路径和 npm 生产依赖路径，未发现额外包目录；该检查不代表每个许可证文件完整，也不等于法律结论。
- 固定版本 proxy-agent-negotiate 上游 package.json 声明 MIT（https://github.com/TooTallNate/proxy-agents/blob/proxy-agent-negotiate%401.1.0/packages/negotiate/package.json），该版本目录未找到独立许可文件；版权和完整声明仍待确认。
- `format@0.2.2` 的随包 `format.js` 自带 Sami Samhuri 2010–2013 版权声明及 MIT 标识；上游当前许可全文为 https://github.com/samsonjs/format/blob/main/License.md ，版权年份为 2010–2026。该当前版本原文留存于 `project/licenses/format-upstream-MIT.md` 并随候选附带；尚未定位 0.2.2 发布时的许可原文，不能仅凭此项宣布分发审核完成。
- `data-uri-to-buffer@4.0.1`：上游固定版本 README（https://github.com/TooTallNate/node-data-uri-to-buffer/blob/4.0.1/README.md）含 Nathan Rajlich 2014 版权声明及 MIT 全文；本地包中 README 的 Git blob 摘要为 `d0f2e05973586a9e863337877138fe0a600cd2ee`，与上游文件一致，候选 VwYfqn 对应 README 的 SHA-256 也与本地包一致。`unresolved-notices.json` 只按独立文件名检测，仍会列出该包，不表示 README 中没有许可。
- `format@0.2.2` 上游固定版本 README（https://github.com/samsonjs/format/blob/0.2.2/Readme.md）载有 2010–2014 年版权声明和 MIT 链接；同版本源码载 2010–2013 年声明。该历史版本目录未见独立许可全文，当前上游全文已附带，历史链接内容仍未直接核实。
- `proxy-agent-negotiate@1.1.0`：上游固定版本完整 Git 树（未截断）中无 `packages/negotiate` 许可文件；引入提交 https://github.com/TooTallNate/proxy-agents/commit/84e85ed393bc78fcad1d50cffc4e2640f3b933a0 说明它从 HTTP/HTTPS 代理包中抽取共享逻辑。该版本的两个来源包各自带有 2013 Nathan Rajlich MIT 声明，但不能仅据此确定新包的完整版权声明；包元数据的作者字段也不能代替版权声明。仍需上游确认或找到直接适用的声明后才能解除此项分发疑问。
- AWS SDK 上游发布提交 `7c2f08900ba6f6ea424ac488694de80356541402` 的 `packages-internal` 下三个包元数据版本分别与本地 http 3.972.78、login 3.972.83、nested-clients 3.997.50 一致；后者元数据中的仓库目录与该提交实际目录不同。分别递归检查三个源码子树，均未截断，未发现以 license、notice 或 copyright 命名的文件；仓库根目录无 NOTICE。该提交根目录 Apache 2.0 许可（https://github.com/aws/aws-sdk-js-v3/blob/7c2f08900ba6f6ea424ac488694de80356541402/LICENSE）已留存并纳入后续候选；此文件名检查不证明不存在源码内版权声明或其他分发义务。
- `standardwebhooks@1.1.1`：上游发布提交 `a7d19b4574ae62221042e76240648d0688a8c420` 的 JavaScript 包元数据声明 MIT，Git blob 摘要与本地 `package.json` 一致；同提交的仓库根 LICENSE 为 Apache 2.0，JavaScript 子树未截断且无许可/NOTICE 命名文件。该提交的根许可原文（https://github.com/standard-webhooks/standard-webhooks/blob/a7d19b4574ae62221042e76240648d0688a8c420/LICENSE）留存供后续候选附带；这不能消除 MIT 与 Apache 声明差异，版权与适用许可仍需上游确认。
- 上游公开问题 https://github.com/TooTallNate/proxy-agents/issues/479 专门询问 `proxy-agent-negotiate@1.1.0` 的版权与许可原文；2026-11-06 核查时问题仍开放，现有一条评论继续请求确认，未见维护者解答。可待上游答复后重新审查；不以相邻包的许可推断本包声明。
- 裁剪可行性初查：本项目 API 整理通过 pi-ai 根入口的 `createModels`、`createProvider` 和 `openai-completions.lazy` 使用 Pi；ChatGPT 订阅由独立 DevKit 实现。针对这三个导出的本机 esbuild 离线探针解析了 916 个输入文件，未包含 standardwebhooks、proxy-agent-negotiate、AWS、Anthropic SDK 或 Google GenAI 路径。此结果仅是打包工具的静态输入证据，不证明所有动态加载、网络代理及兼容服务行为可以裁剪，也不证明剩余许可已完备；现有候选未作依赖裁剪。
- Pi v1.4.0 上游 `packages/ai` 与 `packages/telemetry` 的 Git 子树分别含 413、23 项，递归结果均未截断，未发现以许可、NOTICE 或版权命名的文件；项目留存的根 MIT 许可与该版本上游 Git blob 正文一致（末尾换行除外）。随包 Pi JS 文件中按 copyright、SPDX 标识和 licensed under 检索未发现匹配；这是有限检查，不排除其他第三方内容或未使用这些措辞的声明，依赖树仍需分别核对。
- Pi 1.4.0 随包 README 的“Bundling and Tree Shaking”说明核心入口和单供应商按需导入，并提示某些动态导入对打包器不可见、Node ESM 单文件可能需要 require shim。故静态探针不能单独证明删去包可运行；若继续裁剪，应验证受影响的 API 路径、取消与错误处理、代理和打包后运行，并保留实际嵌入依赖的许可。
- 动态实验：在忽略目录 `.local/pi-bundle-spike` 用 esbuild 将现有 `tests/unit/api-provider.test.ts` 及依赖打成单个 Node CJS 文件，未修改产品代码；正常权限下运行该文件，25/25 合成测试通过，包含请求、取消、超时、错误映射和流式结果等。metafile 中无 standardwebhooks、proxy-agent-negotiate、AWS、Anthropic SDK 或 Google GenAI 输入，声明的外部导入为 Node 内置模块。此实验不覆盖 Electron 打包、真实服务或系统代理，尚不能证明正式候选可以裁剪；仍须按实际嵌入内容完成第三方声明。
- Electron 实验：复制 Electron 运行文件和应用构建到独立内部目录 `ClipNote-candidate-spike-bundle`，未复制 `node_modules`；以 esbuild 将六个主进程入口及其依赖打成 CJS，仅将 Electron 外置。构建输入不含上述五组包，正常桌面权限 `npm run test:packaged` 的合成窗口回归 6/6 通过。该实验已写入测试资料，携带的旧清单不代表实际嵌入依赖，不能分发；未验证动态路径、系统代理、真实服务或生成嵌入依赖完整许可，不能据此认定正式候选可交付。
- 继续核对实验构建：根据 esbuild metafile 的实际输出字节映射识别 71 个主进程 npm 包，其中 Pi AI、Pi telemetry、format 无独立许可文件；分别保留或核查的许可见上文。Vite 实验构建按实际渲染模块识别 21 个界面 npm 包，均有独立许可文件。实验重新构建的六个主进程 JS 文件及三个界面输出均与窗口测试副本 SHA-256 一致。清单位于忽略目录 `.local/pi-bundle-spike/embedded-*-inventory.json`，含开发机路径，仅供本机核查，不能直接作为交付声明。上述计数不覆盖 Electron 二进制、DevKit、外部资源或不透明动态加载，也未逐条审查许可文本及 NOTICE 的适用范围。
- 声明草稿实验：根据上述主进程与界面清单合并 92 个包，在忽略目录 `.local/pi-bundle-spike/notice-draft` 为各包复制独立许可/NOTICE；Pi AI、Pi telemetry 使用固定版本上游根许可，format 使用已留存的当前上游许可。92 份草稿文件与对应来源 SHA-256 一致，索引不含本机路径。该索引仅依据静态嵌入结果，不涵盖 Electron、DevKit、资源和动态加载；format 历史许可及各项适用性仍待核查，草稿不是完整或可分发的第三方声明。
- 对实验候选六个 `.cjs` 文件定向搜索 `import(`：除错误提示字符串外，可执行的变量导入来自 Pi 的 `defaultProviderAuthContext`，其两处调用分别传入 `node:fs/promises` 与 `node:os`；这不是所有动态代码路径的完整证明。六份源码映射中识别出 69 个 npm 包名，均已包含在主进程输出字节清单中；按包名比较不能区分同名多版本，也不能替代对其他资源和许可义务的审核。
- 进一步按源码映射中的相对来源路径解析本地包元数据：六份映射涉及 71 个包版本，均能解析且都存在于主进程输出清单；包括 `openai@7.19.0` 和 `openai@7.21.0` 两个版本。该检查使用构建机现有依赖，不能证明目标机动态模块、Electron 或其他资源的许可与运行完整。
- 实验声明工具 `project/tools/bundle-notice-draft.mjs` 可根据调用方提供的嵌入包清单生成内部草稿：核对包的真实路径、名称和版本；缺少声明或来源路径异常时停止；清单不写本机路径，且不覆盖已有输出目录。三项固定版本补充声明沿用上文材料，其中 format 仍有历史许可待确认。工具不生成构建清单，也不判定声明充分或授权分发，正式打包尚未采用。
- 复现入口：`project/` 下运行 `node tools/build-bundled-experiment.mjs`，在忽略目录新建内部实验构建，收集 esbuild 全部输入和 Vite 已渲染模块的 npm 归属并生成草稿。2026-11-06 实验 `OR8taq` 生成 96 项声明（比此前仅统计输出字节的清单多 4 个保守保留项），9 个非映射构建输出与此前通过窗口回归的实验副本 SHA-256 一致，清单不含本机路径。该构建不含 Electron 可执行文件，不覆盖所有可能的 CSS 资源或动态加载，不是分发产物；需要完整资产与许可审核、目标机及真实服务验证。
- 界面资产检查：2026-11-06 Vite 图中四个样式模块均来自项目源码，未发现 npm 样式或字体模块；项目 CSS 中未检出 `@import`、`url()` 或 `@font-face`。实验构建现额外收集 Vite 已知的第三方样式、字体及常见图片模块以生成声明；这不保证覆盖 Vite 模块图之外的所有资源。实验 `6wHjPb` 仍为 96 项，9 个非映射输出与 `OR8taq` 摘要一致。
