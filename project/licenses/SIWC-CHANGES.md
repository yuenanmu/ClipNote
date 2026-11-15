# Sign-in with ChatGPT DevKit 修改说明

基于 OpenAI Sign-in with ChatGPT DevKit 源码版本 `0a36fefeb913055c8c7a1a29b63d82b96b2e841a` 的 `packages/local/src`。

- `errors.ts`：将订阅网络调用接到应用提供的受限传输接口。
- `responses.ts`：将订阅响应请求接到同一受限传输接口。
- `transport.ts`：新增传输接口，供应用可信主进程注入 Electron 系统网络实现。

以上修改用于 ClipNote；候选中的 `siwc-modified-source/` 保留本项目使用的 DevKit 源码，修改或新增的文件开头有对应标记。原始许可证和第三方声明随本候选同时提供；本项目拥有或有权许可的修改随修改作品按该 DevKit 许可证提供。DevKit 许可只授予其规定的非商业用途，其他依赖许可和分发条件仍需分别核实。
