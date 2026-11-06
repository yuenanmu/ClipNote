# Windows 候选版依赖许可核对

- 本表为工程核对记录，不代表已完成全部分发条件审查。候选包不得因仅有许可证类别字段而认定声明齐全。
- Sign-in with ChatGPT DevKit：项目内 `project/vendor/siwc/LICENSE` 为非商业许可；分发需同时满足其重分发条件并保留第三方声明。商业用途未获该许可授权。
- Electron：候选运行目录含上游 LICENSE 和 LICENSES.chromium.html。
- `@earendil-works/pi-ai` 与 `@earendil-works/pi-telemetry` 1.4.0：包元数据声明 MIT，包内未见独立许可证；上游相同版本仓库根目录有 MIT 许可，见 https://github.com/earendil-works/pi/blob/v1.4.0/LICENSE 。已在 `project/licenses/pi-1.4.0-MIT.txt` 留存原文，组装脚本会附入候选；适用范围仍需完整核对。
- `standardwebhooks` 1.1.1：包元数据声明 MIT，独立许可证缺失；上游仓库当前根许可证与包声明不一致，须定位对应发布版本及子目录许可，暂不认定完整。
- `proxy-agent-negotiate` 1.1.0、`format` 0.2.2、`data-uri-to-buffer` 4.0.1：元数据声明 MIT（format 使用旧字段），未发现独立许可证，须核对对应版本及版权声明。
- `@aws-sdk/credential-provider-http` 3.972.78、`@aws-sdk/nested-clients` 3.997.50、`@aws-sdk/credential-provider-login` 3.972.83：元数据声明 Apache-2.0，须核对对应版本的许可和 NOTICE。
- 其余包存在可识别许可或 NOTICE 文件，但仍需确认实际分发内容与声明覆盖范围；依赖清单不是完整法律审核。

- 关联路径核对：standardwebhooks 由 pi-ai 的 Anthropic SDK 引入，proxy-agent-negotiate 由 pi-ai 的代理依赖引入，AWS 包由其 Bedrock 相关依赖引入；不能仅因当前界面未使用对应服务就直接排除。Standard Webhooks 上游 JavaScript package.json 当前仍声明版本 1.1.1 和 MIT（https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/package.json），但根许可为 Apache-2.0；版本对应的完整声明仍待核查。
