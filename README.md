# GameStudio

参考 LibTV 的深色创作网站与节点工作台，用本机 Codex CLI 的 `gpt-6.1-sol` 生成可玩的浏览器游戏。项目、素材、工作流、生成日志和历史版本保存在本机；游戏可以预览、继续修改、编辑源码并导出。

## 运行

需要 Node.js 24 或更新版本，以及已经登录、可以访问 `gpt-6.1-sol` 的 Codex 账号。

```sh
cd /Users/amiao/Project/gamestudio
npm install
npm exec -- codex login status
```

如果没有登录：

```sh
npm exec -- codex login
```

项目依赖包含 Codex CLI，后端优先使用项目内安装的版本。开发时运行：

```sh
npm run dev
```

开发界面为 `http://127.0.0.1:5173`，API 为 `http://127.0.0.1:4100`。正式运行时先构建：

```sh
npm run build
npm start
```

然后打开 `http://127.0.0.1:4100`。服务默认只允许本机访问。

macOS 也可以在 Finder 中双击 `scripts/start.command` 启动开发工作台，然后打开 `http://127.0.0.1:5173`。

## 创作流程

1. 从首页新建项目，或选择模板建立游戏需求。
2. 在工作台编辑玩法需求、添加素材与连接节点；调整画面比例、画面风格、难度和声音。
3. 在 AI 导演中提交需求。后端排队调用真实 Codex CLI；任务状态和日志会同步到页面。
4. 生成完成后，在沙箱预览中试玩。修改需求后选择迭代，原版本会保留。
5. 在版本历史中切换结果，或编辑源码保存一个新版本。
6. 导出独立 HTML 或 ZIP，继续在浏览器运行。

内置可玩项目明确标为示例；只有实际 CLI 成功且返回有效游戏代码后，任务才会显示生成成功。模型固定为 `gpt-6.1-sol`，不会在失败时静默切换模型。

## 配置与数据

复制 `.env.example` 到 `.env` 可配置端口。生成参数与项目设置通过工作台保存；登录状态沿用本机 Codex CLI 的登录。

| 环境变量 | 用途 |
| --- | --- |
| `PORT` | API/正式网站端口，默认 `4100` |
| `GAMESTUDIO_DATA_DIR` | 本机数据目录，默认项目下的 `data/` |
| `GAMESTUDIO_CODEX_BIN` | 可选 CLI 可执行文件路径；省略时使用项目内 Codex |
| `GAMESTUDIO_JOB_TIMEOUT_MS` | 可选单次生成超时，单位毫秒 |

备份时先停止服务，再复制整个 `data/`，包括状态文件、项目素材、版本源码和任务记录。不要只复制单独的状态 JSON。

## 验证

```sh
npm run check
npm test
npm run build
```

HTTP 集成测试使用临时数据目录和受控 CLI 夹具，覆盖传输、状态、文件与失败处理，不会调用真实模型或修改个人项目。真实模型与浏览器操作验收单独记录于 [验证记录](docs/verification.md)。

服务运行后，可执行 `npm run test:live` 创建一个验收项目，实际调用模型完成初始生成和一次修改。证据保存于 `work/live-verification/`；浏览器中的玩法与界面仍需实测。使用其他 API 端口时设置 `GAMESTUDIO_TEST_ORIGIN`。

更多细节见 [架构说明](docs/architecture.md) 与 [验收标准](docs/acceptance.md)。

## 故障处理

CLI 不可用时检查项目安装是否完成，或设置正确的 `GAMESTUDIO_CODEX_BIN`。未登录时运行 `npm exec -- codex login`。模型访问失败时检查账号权限及 CLI 版本；不要将模型换成其他名称以掩盖错误。

生成失败或取消后，已保存的项目与历史版本仍保留。修正需求或环境后提交新任务。重启中断的运行任务会显示中断原因，不会伪装为成功。

游戏预览使用不授予同源访问权限的 iframe；导出是用户生成的可执行 HTML。网站采用本机单用户存储，并未实现公网多用户服务、计费或账户系统。
