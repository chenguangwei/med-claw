# uniins-claw

uniins-claw is a desktop AI agent application that executes tasks through natural language. It provides real-time code generation, tool execution, and workspace management.

**Website:** [uniins-claw.ai](https://uniins-claw.ai)

![](./public/imgs/home.png)

## Previews

- Organize files

![](./public/imgs/files.png)

- Generate website

![](./public/imgs/web.png)

- Generate document

![](./public/imgs/doc.png)

- Generate data table

![](./public/imgs/excel.png)

- Generate slides

![](./public/imgs/ppt.png)

- Use custom model provider for Agent.

![](./public/imgs/settings.png)

## ❤️ Sponsor

<a href='https://302.ai/?utm_source=uniins-claw_github' target='_blank'>
  <img src="https://github.com/user-attachments/assets/a03edf82-2031-4f23-bdb8-bfc0bfd168a4" width="100%" alt="icon"/>
</a>

[302.AI](https://302.ai/?utm_source=uniins-claw_github) is a pay-as-you-go AI application platform that offers the most comprehensive AI APIs and online applications available.

> If you want to sponsor this project, please contact us via email: [hello@uniins-claw.ai](mailto:hello@uniins-claw.ai)

## Features

- **Task Execution** - Natural language task input with real-time streaming
- **Agent Runtime** - Powered by [@codeany/open-agent-sdk](https://github.com/codeany-ai/open-agent-sdk-typescript), runs entirely in-process with no external CLI dependency
- **30+ Built-in Tools** - File I/O, shell execution, web search, code editing, and more
- **Sandbox** - Isolated code execution environment
- **Artifact Preview** - Live preview for HTML/React/code files
- **MCP Support** - Model Context Protocol server integration (stdio/SSE/HTTP)
- **Skills Support** - Custom agent skills for extended capabilities
- **Multi-provider** - OpenRouter, Anthropic, OpenAI, and any compatible API endpoint

## Project Structure

```
uniins-claw/
├── src/                # Frontend (React + TypeScript)
├── src-api/            # Backend API (Hono + @codeany/open-agent-sdk)
└── src-tauri/          # Desktop app (Tauri + Rust)
```

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Backend | Hono, @codeany/open-agent-sdk, MCP SDK |
| Desktop | Tauri 2, SQLite |


## Architecture

![](/public/imgs/architecture.png)

## Development

### Requirements

- Node.js >= 20
- pnpm >= 9
- Rust >= 1.70

### Quick Start

```bash
# Install dependencies
pnpm install

# Start API server
pnpm dev:api

# Start Web and Desktop App (recommended)
pnpm dev:app

# Start Web only (Optional)
pnpm dev:web
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Community

- [Join Discord](https://discord.gg/rDSmZ8HS39)
- [Follow on X](https://x.com/uniins-clawai)

## ❤️ Contributors

<a href="https://github.com/uniins-claw-ai/uniins-claw/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=uniins-claw-ai/uniins-claw" />
</a>

## ⭐️ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=uniins-claw-ai/uniins-claw&type=Timeline)](https://star-history.com/#uniins-claw-ai/uniins-claw&Timeline)

## License

This project is licensed under the [uniins-claw Community License](LICENSE), based on Apache License 2.0 with additional conditions.

© 2026 ThinkAny, LLC. All rights reserved.
